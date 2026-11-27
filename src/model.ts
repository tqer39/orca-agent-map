// Orca の CLI が返す JSON を、パネルが描くスナップショットに変換する純粋関数。
// worker から呼ばれ、テストではダミーデータで直接呼ぶ。
import {
  itemTickets,
  type LinkedSlots,
  type RawItemLink,
  type Ticket,
  worktreeTickets,
} from "./tickets";

export type { Ticket };

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

/**
 * NEEDS YOU / IN FLIGHT / RECENT の行や図のノードを選んだときに Orca で開く先。
 * workspaceId は `orca worktree ps` の worktreeId。
 * paneKey はターミナルで動くエージェントだけに付け、そのペインまでフォーカスする
 * （チャットのタブを選ぶ API は無いので、チャットはワークスペースを開くところまで）。
 */
export interface NeedTarget {
  workspaceId: string;
  paneKey?: string;
}

export interface Need {
  id: string;
  node: string;
  reason: NeedReason;
  text: string;
  at: number;
  /** 開く先。ワークスペースが分からないときは無い（行を選べない）。 */
  target?: NeedTarget;
  /** reason が item のときの Item 番号。開けるのはボットのホームまでなので、行に出して探せるようにする。 */
  item?: number;
  /** 行に出すチケット。agent はその worktree の参照、Item は links にある PR。 */
  tickets?: Ticket[];
  /** Item に付いた PR などのリンク（http(s) だけ）。Orca で開く先が無いとき、ブラウザで開く。 */
  url?: string;
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
  /**
   * ノード ID ごとのチケット（無いノードは載せない）。エージェントと worker はその worktree の参照、
   * ボットはホームの worktree の参照だけ（全セッション分をまとめると多くなりすぎるため）。
   */
  tickets: Record<string, Ticket[]>;
  errors: string[];
  demo: boolean;
  /** ノード ID → Orca で開く先。図のノードと、IN FLIGHT / RECENT の行（受け手のノードを開く）が使う。 */
  targets: Record<string, NeedTarget>;
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
  liveness?: string;
  /**
   * `orca orchestration worker-show --dispatch <id> --full --json` の dispatch.assigneePaneKey。
   * worker-list には dispatch とエージェントを結ぶ情報が無いので、worker が足す。
   */
  assigneePaneKey?: string | null;
}

/**
 * dispatch を担当するエージェントを探す。coordinator や別の worker と同じ worktree に
 * 居ることがあるので、assigneePaneKey で見分ける（タブを移すと paneKey の後ろが変わるため、
 * 含まれるセッション ID でも照合する）。assigneePaneKey が無い dispatch は推測で結ばず、出さない
 * （ペインが閉じて worktree に残った別の worker に、誤って結ばないため）。
 */
function assigneeOf(
  w: RawWorker,
  worktrees: RawWorktree[],
): { wt: RawWorktree; agent: RawAgent } | null {
  const wt = worktrees.find((t) => t.worktreeId === w.workspace);
  const agents = (wt?.agents ?? []).filter((a) => sessionKey(a.orcaSessionId));
  if (!wt || !agents.length) return null;
  const key = w.assigneePaneKey;
  if (!key) return null;
  const agent =
    agents.find((a) => a.paneKey === key) ??
    agents.find((a) => key.includes(sessionKey(a.orcaSessionId)));
  return agent ? { wt, agent } : null;
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
export interface RawWorktree extends LinkedSlots {
  worktreeId?: string;
  bot?: string | null;
  displayName?: string | null;
  branch?: string | null;
  createdAt?: number;
  unread?: boolean;
  /** ボットのホーム（Home Chat が開く folder ワークスペース）なら true。 */
  botHome?: boolean | null;
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
  links?: (RawItemLink & { kind?: string; url?: string })[] | null;
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

/** チャット（structured agent session）のペイン。ターミナルではないので terminal.focus の対象外。 */
const CHAT_PANE = /^structured-agent-session-/;

function agentTarget(wt: RawWorktree, agent: RawAgent): NeedTarget | undefined {
  if (!wt.worktreeId) return undefined;
  const pane = agent.paneKey;
  return pane && !CHAT_PANE.test(pane)
    ? { workspaceId: wt.worktreeId, paneKey: pane }
    : { workspaceId: wt.worktreeId };
}

/** Item に付いた最初の http(s) のリンク。ファイルなどのリンクはブラウザで開かない。 */
function linkUrl(item: RawItem): string | undefined {
  for (const link of item.links ?? []) {
    const url = link.pr?.url ?? link.url;
    if (typeof url === "string" && /^https?:\/\//.test(url)) return url;
  }
  return undefined;
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
  const assignees = raw.workers.map((w) => ({
    w,
    found: assigneeOf(w, raw.worktrees),
  }));
  const workerSessions = new Set(
    assignees.map((a) => sessionKey(a.found?.agent.orcaSessionId)),
  );
  const needs: Need[] = [];
  const tickets: Record<string, Ticket[]> = {};
  const targets: Record<string, NeedTarget> = {};
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
    const linked = worktreeTickets(wt);
    if (linked.length && wt.bot && wt.botHome === true)
      tickets[botNode(wt.bot)] = linked;
    for (const agent of wt.agents ?? []) {
      const session = sessionKey(agent.orcaSessionId);
      if (!session) continue;
      // worker の worktree にも依頼元のボット名が付くが、worker は自分のノードとして描く。
      // 同じ worktree の coordinator は worker 扱いしない。
      const isWorker = workerSessions.has(session);
      const bot = isWorker ? null : wt.bot;
      const id = bot ? botNode(bot) : session;
      nodeOfSession.set(session, id);
      if (linked.length && !bot) tickets[id] = linked;
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
      const target = agentTarget(wt, agent);
      // ボットは複数のチャットを 1 つのノードにまとめるので、下でホームを開く先にする。
      if (!bot && target) targets[id] = target;
      const need = agentNeed(agent, wt.unread === true);
      if (need) {
        needs.push({
          id: `agent:${session}`,
          node: id,
          ...need,
          ...(target ? { target } : {}),
          ...(linked.length ? { tickets: linked } : {}),
        });
      }
    }
  }

  // Item の画面を開く API は無いので、Item はボットのホームを開く。
  const homeOf = new Map<string, string>();
  for (const wt of raw.worktrees)
    if (wt.bot && wt.botHome === true && wt.worktreeId)
      homeOf.set(wt.bot, wt.worktreeId);
  for (const [bot, workspaceId] of homeOf)
    targets[botNode(bot)] = { workspaceId };

  for (const item of raw.items) {
    if (item.status !== "needs_you" && item.status !== "needs-you") continue;
    const node = botNode(item.bot);
    addNode(node, { label: item.bot, kind: "bot", state: "unknown" });
    const home = homeOf.get(item.bot);
    const prs = itemTickets(item.links);
    const url = linkUrl(item);
    needs.push({
      id: `item:${item.bot}:${item.number ?? item.title}`,
      node,
      reason: "item",
      text:
        firstLine(item.question?.text) || firstLine(item.title) || "Needs you",
      at: itemTime(item.updatedAt),
      ...(home ? { target: { workspaceId: home } } : {}),
      ...(typeof item.number === "number" ? { item: item.number } : {}),
      ...(prs.length ? { tickets: prs } : {}),
      ...(url ? { url } : {}),
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

  // 返事がどの依頼に付いたか（thread_id か payload.requestId）。
  const answered = new Set<string>();
  const linked = new Set<string>();
  for (const m of raw.messages) {
    const requestId = payloadOf(m)?.requestId;
    for (const link of [m.thread_id, requestId]) {
      if (typeof link !== "string" || !link) continue;
      answered.add(link);
      linked.add(m.id);
    }
  }
  // どの依頼にも結び付いていないメッセージだけ、相手から後で来たものを返事とみなす。
  // 別の依頼に結び付いた返事で、この依頼を閉じない。
  const repliedLater = (f: Flow) =>
    flows.some(
      (g) =>
        g.from === f.to &&
        g.to === f.from &&
        g.at >= f.at &&
        g.id !== f.id &&
        !linked.has(g.id),
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
  for (const { w, found } of assignees) {
    if (!found) continue;
    const { wt, agent } = found;
    const to = sessionKey(agent.orcaSessionId);
    const live = w.outcome === "in_progress";
    if (!live && now - (agent.stateStartedAt ?? 0) > WORKER_LINGER_MS) continue;
    const from =
      (agent.parentPaneKey && sessionByPane.get(agent.parentPaneKey)) ||
      "coordinator";
    workerFlows.push({
      id: w.dispatchId,
      from,
      to,
      type: "worker",
      subject: agent.taskTitle || w.taskId || "",
      at: wt.createdAt ?? agent.stateStartedAt ?? now,
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
    tickets,
    errors: [],
    demo: false,
    targets,
  };
}
