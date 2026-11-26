// Orca の CLI が返す JSON を、パネルが描くスナップショットに変換する純粋関数。
// worker から呼ばれ、テストではダミーデータで直接呼ぶ。

export type AgentState = "working" | "blocked" | "waiting" | "done" | "unknown";
export type NodeKind = "bot" | "agent" | "worker";

export interface MapNode {
  id: string;
  label: string;
  kind: NodeKind;
  state: AgentState;
  /** 人（オーナー）の対応を待っている。 */
  needsYou: boolean;
}

/** permission: 実行の許可待ち / input: 返事待ち / item: ボットの Item が Needs you / unread: 未読。 */
export type NeedReason = "permission" | "input" | "item" | "unread";

export interface Need {
  id: string;
  node: string;
  reason: NeedReason;
  text: string;
  at: number;
}

export interface Flow {
  id: string;
  from: string;
  to: string;
  /** handoff / question / status / worker / escalation / worker_done など、Orca の種類そのまま。 */
  type: string;
  subject: string;
  at: number;
  live: boolean;
}

export interface Snapshot {
  at: number;
  nodes: MapNode[];
  inFlight: Flow[];
  recent: Flow[];
  needsYou: Need[];
  errors: string[];
  demo: boolean;
}

/** `orca orchestration inbox --json --full` の 1 行（使う項目だけ）。 */
export interface RawMessage {
  id: string;
  type: string;
  from_handle?: string;
  to_handle?: string;
  subject?: string;
  created_at?: string;
  thread_id?: string | null;
  payload?: unknown;
}

/** `orca orchestration worker-list --json` の 1 行。 */
export interface RawWorker {
  dispatchId: string;
  taskId?: string;
  workspace?: string;
  outcome?: string;
}

/** `orca worktree ps --json` の worktrees[].agents[]。 */
export interface RawAgent {
  orcaSessionId?: string | null;
  activity?: { status?: string; unread?: boolean } | null;
  toolName?: string | null;
  lastAssistantMessage?: string | null;
  paneKey?: string | null;
  parentPaneKey?: string | null;
  displayName?: string | null;
  state?: string;
  stateStartedAt?: number;
  taskTitle?: string | null;
}

/** `orca worktree ps --json` の worktrees[]。 */
export interface RawWorktree {
  worktreeId?: string;
  bot?: string | null;
  displayName?: string | null;
  branch?: string | null;
  createdAt?: number;
  unread?: boolean;
  agents?: RawAgent[];
}

/** `orca bot item list --bot <名前> --status needs-you --json` の items[]。`bot` は呼んだ側で足す。 */
export interface RawItem {
  bot: string;
  number?: number;
  title?: string;
  status?: string;
  question?: { text?: string } | null;
  updatedAt?: number | string;
}

export interface RawSources {
  messages: RawMessage[];
  workers: RawWorker[];
  worktrees: RawWorktree[];
  /** `orca bot list --json` のボット名。動いていなくても待機中のノードとして描く。 */
  bots: string[];
  items: RawItem[];
}

/** 返事を待つ種類。これ以外（status など）は送った時点で完了扱い。 */
const AWAITS_REPLY = new Set(["handoff", "question", "escalation"]);
/** これより古い返事待ちは、放置されたものとして IN FLIGHT に出さない。 */
const STALE_MS = 12 * 60 * 60 * 1000;
/** 終わった worker を RECENT と図に残す時間。 */
const WORKER_LINGER_MS = 15 * 60 * 1000;
const RECENT_LIMIT = 20;
const NODE_LIMIT = 16;

export function sessionKey(handle: string | null | undefined): string {
  return (handle ?? "").replace(/^orca_session_id:/, "");
}

function toState(value: string | undefined): AgentState {
  return value === "working" ||
    value === "blocked" ||
    value === "waiting" ||
    value === "done"
    ? value
    : "unknown";
}

function payloadOf(message: RawMessage): Record<string, unknown> | null {
  let value = message.payload;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

/** 未知のハンドル用の短い表示名。セッション ID を丸ごと出さない。 */
function fallbackLabel(id: string): string {
  if (/^[0-9a-f-]{16,}$/i.test(id)) return `session ${id.slice(0, 6)}`;
  return id.length > 24 ? `${id.slice(0, 23)}…` : id;
}

function firstLine(text: string | null | undefined, max = 140): string {
  const line = (text ?? "").trim().split("\n")[0].trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

const NEED_ORDER: NeedReason[] = ["permission", "input", "item", "unread"];

/** エージェントが人を待っているか。activity が無い古い Orca では state を見る。 */
function agentNeed(
  agent: RawAgent,
  unread: boolean,
): Omit<Need, "id" | "node"> | null {
  const status = agent.activity?.status ?? agent.state;
  const at = agent.stateStartedAt ?? 0;
  if (status === "blocked") {
    const text = agent.toolName
      ? `${agent.toolName} の実行許可を待っています`
      : "許可を待っています";
    return { reason: "permission", text, at };
  }
  if (status === "waiting") {
    return {
      reason: "input",
      text: firstLine(agent.lastAssistantMessage) || "返事を待っています",
      at,
    };
  }
  if (agent.activity?.unread ?? unread) {
    return {
      reason: "unread",
      text: firstLine(agent.lastAssistantMessage) || "未読の結果があります",
      at,
    };
  }
  return null;
}

function itemTime(value: number | string | undefined): number {
  if (typeof value === "number") return value;
  const at = Date.parse(value ?? "");
  return Number.isFinite(at) ? at : 0;
}

interface AgentInfo {
  label: string;
  kind: NodeKind;
  state: AgentState;
}

const STATE_RANK: AgentState[] = [
  "blocked",
  "waiting",
  "working",
  "done",
  "unknown",
];

/** 1 つのボットの複数のセッションをまとめるとき、いちばん目を引く状態を残す。 */
function stronger(a: AgentState, b: AgentState): AgentState {
  return STATE_RANK.indexOf(a) <= STATE_RANK.indexOf(b) ? a : b;
}

export const botNode = (name: string) => `bot:${name}`;

export function buildSnapshot(raw: RawSources, now: number): Snapshot {
  const nodesById = new Map<string, AgentInfo>();
  /** セッション ID → ノード ID。ボットのセッション（チャット）は 1 つのボットのノードにまとめる。 */
  const nodeOfSession = new Map<string, string>();
  const sessionByPane = new Map<string, string>();
  const workerWorktrees = new Set(
    raw.workers.map((w) => w.workspace).filter(Boolean),
  );
  const needs: Need[] = [];
  const nodeOf = (session: string) => nodeOfSession.get(session) ?? session;

  const addNode = (id: string, info: AgentInfo) => {
    const known = nodesById.get(id);
    nodesById.set(
      id,
      known ? { ...known, state: stronger(known.state, info.state) } : info,
    );
  };

  for (const name of raw.bots)
    addNode(botNode(name), { label: name, kind: "bot", state: "unknown" });

  for (const wt of raw.worktrees) {
    for (const agent of wt.agents ?? []) {
      const session = sessionKey(agent.orcaSessionId);
      if (!session) continue;
      // worker の worktree にも依頼元のボット名が付くが、worker は自分のノードとして描く。
      const isWorker = workerWorktrees.has(wt.worktreeId);
      const bot = isWorker ? null : wt.bot;
      const id = bot ? botNode(bot) : session;
      nodeOfSession.set(session, id);
      if (agent.paneKey) sessionByPane.set(agent.paneKey, session);
      addNode(id, {
        label:
          bot ||
          agent.displayName ||
          wt.displayName ||
          wt.branch ||
          fallbackLabel(session),
        kind: bot ? "bot" : isWorker ? "worker" : "agent",
        state: toState(agent.activity?.status ?? agent.state),
      });
      const need = agentNeed(agent, wt.unread === true);
      if (need) needs.push({ id: `agent:${session}`, node: id, ...need });
    }
  }

  for (const item of raw.items) {
    if (item.status !== "needs_you" && item.status !== "needs-you") continue;
    const node = botNode(item.bot);
    addNode(node, { label: item.bot, kind: "bot", state: "unknown" });
    needs.push({
      id: `item:${item.bot}:${item.number ?? item.title}`,
      node,
      reason: "item",
      text:
        firstLine(item.question?.text) || firstLine(item.title) || "Needs you",
      at: itemTime(item.updatedAt),
    });
  }
  needs.sort(
    (a, b) =>
      NEED_ORDER.indexOf(a.reason) - NEED_ORDER.indexOf(b.reason) ||
      b.at - a.at,
  );
  const needing = new Set(needs.map((n) => n.node));

  const flows: Flow[] = raw.messages.map((m) => {
    const from = sessionKey(m.from_handle);
    // ps に居ない送り手（終わったセッション）でも、ボットの依頼なら payload にボット名がある。
    const payload = payloadOf(m);
    const named = (payload?.botRequest ?? payload?.botAnswer) as
      | { from?: unknown }
      | undefined;
    if (
      !nodeOfSession.has(from) &&
      typeof named?.from === "string" &&
      named.from
    ) {
      nodeOfSession.set(from, botNode(named.from));
      addNode(botNode(named.from), {
        label: named.from,
        kind: "bot",
        state: "unknown",
      });
    }
    const at = Date.parse(m.created_at ?? "");
    return {
      id: m.id,
      from,
      to: sessionKey(m.to_handle),
      type: m.type,
      subject: m.subject ?? "",
      at: Number.isFinite(at) ? at : 0,
      live: false,
    };
  });

  const answered = new Set<string>();
  for (const m of raw.messages) {
    if (m.thread_id) answered.add(m.thread_id);
    const requestId = payloadOf(m)?.requestId;
    if (typeof requestId === "string") answered.add(requestId);
  }
  const repliedLater = (f: Flow) =>
    flows.some(
      (g) =>
        g.from === f.to && g.to === f.from && g.at >= f.at && g.id !== f.id,
    );

  for (const f of flows) {
    f.live =
      AWAITS_REPLY.has(f.type) &&
      !answered.has(f.id) &&
      !repliedLater(f) &&
      now - f.at < STALE_MS;
  }

  // worker は走っている間と、終わってから WORKER_LINGER_MS の間だけ出す。
  // 送り元は ps の parentPaneKey が指す coordinator。
  const workerFlows: Flow[] = [];
  for (const w of raw.workers) {
    const wt = raw.worktrees.find((t) => t.worktreeId === w.workspace);
    const agent = wt?.agents?.find((a) => sessionKey(a.orcaSessionId));
    const to = sessionKey(agent?.orcaSessionId);
    if (!to) continue;
    const live = w.outcome === "in_progress";
    if (!live && now - (agent?.stateStartedAt ?? 0) > WORKER_LINGER_MS)
      continue;
    const from =
      (agent?.parentPaneKey && sessionByPane.get(agent.parentPaneKey)) ||
      "coordinator";
    workerFlows.push({
      id: w.dispatchId,
      from,
      to,
      type: "worker",
      subject: agent?.taskTitle || w.taskId || "",
      at: wt?.createdAt ?? agent?.stateStartedAt ?? now,
      live,
    });
  }

  // 線と一覧はノード単位で描くので、セッション ID をノード ID に置き換える。
  const all = [...workerFlows, ...flows].map((f) => ({
    ...f,
    from: nodeOf(f.from),
    to: nodeOf(f.to),
  }));
  const byNewest = (a: Flow, b: Flow) => b.at - a.at;
  const inFlight = all.filter((f) => f.live).sort(byNewest);
  const recent = all
    .filter((f) => !f.live)
    .sort(byNewest)
    .slice(0, RECENT_LIMIT);

  // 人を待つノード、やりとりのあるノード、待機中のボットの順に並べ、上限を超えたら後ろから落とす。
  const nodeIds: string[] = [...needing];
  const push = (id: string) => {
    if (id && !nodeIds.includes(id)) nodeIds.push(id);
  };
  for (const f of [...inFlight, ...recent]) [f.from, f.to].forEach(push);
  for (const [id, info] of nodesById) if (info.kind === "bot") push(id);

  const nodes = nodeIds.slice(0, NODE_LIMIT).map(
    (id): MapNode => ({
      id,
      ...(nodesById.get(id) ?? {
        label: fallbackLabel(id),
        kind: "agent",
        state: "unknown",
      }),
      needsYou: needing.has(id),
    }),
  );

  return {
    at: now,
    nodes,
    inFlight,
    recent,
    needsYou: needs,
    errors: [],
    demo: false,
  };
}
