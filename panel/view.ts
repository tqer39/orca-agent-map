// スナップショットを HTML 文字列にする純粋関数。DOM に触らないので Node でテストできる。
import type { Flow, MapNode, Need, NeedReason, Snapshot } from "../src/model";
import { escapeHtml } from "./html";
import { BADGE_H, renderNodeTickets, renderTickets } from "./tickets";

export { escapeHtml };

const NODE_H = 26;
const ROW_GAP = 10;
const PAD = 8;

/** 色分け用の種類。表示は Orca の種類名そのまま。 */
export function kindClass(type: string): string {
  if (
    type === "handoff" ||
    type === "question" ||
    type === "worker" ||
    type === "escalation"
  )
    return type;
  return "status";
}

export function relativeTime(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

interface Placed {
  node: MapNode;
  x: number;
  y: number;
  side: "left" | "right";
}

/**
 * 送るほうが多いノードを左、受けるほうが多いノードを右に並べる。
 * `below` はノードの下に空ける高さ（チケットのバッジの段）。
 */
export function layout(
  nodes: MapNode[],
  flows: Flow[],
  width: number,
  below = 0,
) {
  const out = new Map<string, number>();
  const inn = new Map<string, number>();
  for (const f of flows) {
    out.set(f.from, (out.get(f.from) ?? 0) + 1);
    inn.set(f.to, (inn.get(f.to) ?? 0) + 1);
  }
  const nodeW = Math.max(
    84,
    Math.min(150, Math.floor((width - 2 * PAD - 80) / 2)),
  );
  const left: MapNode[] = [];
  const right: MapNode[] = [];
  for (const n of nodes)
    ((out.get(n.id) ?? 0) >= (inn.get(n.id) ?? 0) ? left : right).push(n);
  const rows = Math.max(left.length, right.length, 1);
  const pitch = NODE_H + below + ROW_GAP;
  const placed = new Map<string, Placed>();
  // 短いほうの列は縦の中央に寄せ、線が扇形に広がるようにする。
  const put = (column: MapNode[], side: "left" | "right") => {
    const top = PAD + ((rows - column.length) * pitch) / 2;
    column.forEach((node, i) => {
      placed.set(node.id, {
        node,
        side,
        x: side === "left" ? PAD : width - PAD - nodeW,
        y: top + i * pitch,
      });
    });
  };
  put(left, "left");
  put(right, "right");
  return {
    placed,
    nodeW,
    height: 2 * PAD + rows * pitch - ROW_GAP,
  };
}

interface Edge {
  from: string;
  to: string;
  kind: string;
  live: boolean;
}

/** 同じ送り元・送り先の組は 1 本にまとめる。進行中が 1 つでもあれば点線で流す。 */
export function edgesOf(flows: Flow[]): Edge[] {
  const edges = new Map<string, Edge>();
  for (const f of flows) {
    if (f.from === f.to) continue;
    const key = `${f.from}\u0000${f.to}`;
    const edge = edges.get(key);
    if (!edge)
      edges.set(key, {
        from: f.from,
        to: f.to,
        kind: kindClass(f.type),
        live: f.live,
      });
    else if (f.live && !edge.live)
      Object.assign(edge, { kind: kindClass(f.type), live: true });
  }
  return [...edges.values()];
}

/** `ay` / `by` は線の端点の高さ。1 つのノードに集まる線は高さを散らして重ならないようにする。 */
function edgePath(
  a: Placed,
  b: Placed,
  nodeW: number,
  ay: number,
  by: number,
): string {
  if (a.side !== b.side) {
    const ax = a.side === "left" ? a.x + nodeW : a.x;
    const bx = b.side === "left" ? b.x + nodeW + 4 : b.x - 4;
    const mid = (ax + bx) / 2;
    return `M${ax},${ay} C${mid},${ay} ${mid},${by} ${bx},${by}`;
  }
  // 同じ列どうしは内側へ膨らむ弧にする。
  const inner = a.side === "left" ? a.x + nodeW : a.x;
  const bulge = a.side === "left" ? 40 : -40;
  const end = inner + (a.side === "left" ? 4 : -4);
  return `M${inner},${ay} C${inner + bulge},${ay} ${inner + bulge},${by} ${end},${by}`;
}

/** 各ノードに付く線を相手の高さ順に並べ、端点をノードの高さの中で等間隔に配る。 */
function ports(edges: Edge[], placed: Map<string, Placed>) {
  const byNode = new Map<string, { edge: number; otherY: number }[]>();
  edges.forEach((e, i) => {
    for (const [self, other] of [
      [e.from, e.to],
      [e.to, e.from],
    ]) {
      const list = byNode.get(self) ?? [];
      list.push({ edge: i, otherY: (placed.get(other) as Placed).y });
      byNode.set(self, list);
    }
  });
  for (const list of byNode.values())
    list.sort((x, y) => x.otherY - y.otherY || x.edge - y.edge);
  return (nodeId: string, edge: number): number => {
    const list = byNode.get(nodeId) ?? [];
    const i = list.findIndex((p) => p.edge === edge);
    const step =
      list.length > 1 ? Math.min(5, (NODE_H - 8) / (list.length - 1)) : 0;
    return (
      (placed.get(nodeId) as Placed).y +
      NODE_H / 2 +
      (i - (list.length - 1) / 2) * step
    );
  };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function renderGraph(
  snapshot: Snapshot,
  width: number,
  masked = false,
): string {
  const flows = [...snapshot.inFlight, ...snapshot.recent];
  // バッジのあるノードが 1 つでもあれば、全部の行にバッジの段を空ける。
  const below = snapshot.nodes.some((n) => snapshot.tickets[n.id]?.length)
    ? BADGE_H + 3
    : 0;
  const { placed, nodeW, height } = layout(snapshot.nodes, flows, width, below);
  const maxChars = Math.max(6, Math.floor((nodeW - 24) / 6.5));
  const all = edgesOf(flows).filter(
    (e) => placed.has(e.from) && placed.has(e.to),
  );
  const portY = ports(all, placed);
  const edges = all
    .map((e, i) => {
      const a = placed.get(e.from) as Placed;
      const b = placed.get(e.to) as Placed;
      const d = edgePath(a, b, nodeW, portY(e.from, i), portY(e.to, i));
      return `<path class="edge ${e.kind}${e.live ? " live" : ""}" d="${d}" marker-end="url(#arrow-${e.kind})"/>`;
    })
    .join("");
  const cy = NODE_H / 2;
  const nodes = [...placed.values()]
    .map((p) => {
      // 人を待つノードは色だけでなく「!」の印と title の文言でもわかるようにする。
      const mark = p.node.needsYou
        ? `<circle class="needs-mark" cx="11" cy="${cy}" r="6"/><text class="needs-glyph" x="11" y="${cy + 3.5}" text-anchor="middle">!</text>`
        : `<circle class="dot ${p.node.state}" cx="11" cy="${cy}" r="4"/>`;
      const state = p.node.needsYou
        ? `${p.node.state}, needs you`
        : p.node.state;
      return (
        `<g class="node ${p.node.kind}${p.node.needsYou ? " needs" : ""}" transform="translate(${p.x},${p.y})">` +
        `<title>${escapeHtml(p.node.label)} (${state})</title>` +
        `<rect width="${nodeW}" height="${NODE_H}" rx="6"/>` +
        mark +
        `<text x="21" y="${cy + 4}">${escapeHtml(truncate(p.node.label, maxChars))}</text>` +
        `</g>` +
        renderNodeTickets(
          snapshot.tickets[p.node.id],
          `node:${p.node.id}`,
          { masked, demo: snapshot.demo },
          p.x,
          p.y + NODE_H + 3,
          nodeW,
        )
      );
    })
    .join("");
  const markers = ["handoff", "question", "status", "worker", "escalation"]
    .map(
      (k) =>
        `<marker id="arrow-${k}" class="arrow ${k}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z"/></marker>`,
    )
    .join("");
  return `<svg class="graph" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-label="依頼の相関図"><defs>${markers}</defs>${edges}${nodes}</svg>`;
}

function labelOf(snapshot: Snapshot, id: string): string {
  return (
    snapshot.nodes.find((n) => n.id === id)?.label ??
    (id === "coordinator" ? "coordinator" : id.slice(0, 8))
  );
}

export function renderRow(
  snapshot: Snapshot,
  f: Flow,
  masked: boolean,
): string {
  const subject = masked ? "••••••" : escapeHtml(f.subject || "（件名なし）");
  return (
    `<li class="row${f.live ? " live" : ""}">` +
    `<div class="route"><span class="who">${escapeHtml(labelOf(snapshot, f.from))}</span>` +
    `<span class="to">→</span><span class="who">${escapeHtml(labelOf(snapshot, f.to))}</span>` +
    `<span class="kind ${kindClass(f.type)}">${escapeHtml(f.type)}</span>` +
    `<time>${relativeTime(f.at, snapshot.at)}</time></div>` +
    `<div class="subject${masked ? " masked" : ""}">${subject}</div>` +
    // 依頼や報告の受け手のチケット。
    renderTickets(snapshot.tickets[f.to], `flow:${f.id}`, {
      masked,
      demo: snapshot.demo,
    }) +
    `</li>`
  );
}

function section(
  title: string,
  count: number,
  body: string,
  empty: string,
): string {
  return (
    `<section><h2>${title}<span class="count">${count}</span></h2>` +
    (count ? `<ul>${body}</ul>` : `<p class="empty">${empty}</p>`) +
    `</section>`
  );
}

export const NEED_LABELS: Record<NeedReason, string> = {
  permission: "許可待ち",
  input: "返事待ち",
  item: "Needs you",
  unread: "未読",
};

/** 開ける行の title。Item はボットのホームまでしか開けないことも伝える。 */
export const NEED_OPEN_TITLE = "Orca で開く（Item はボットのホームを開く）";

export function renderNeed(
  snapshot: Snapshot,
  n: Need,
  masked: boolean,
): string {
  const text = masked ? "••••••" : escapeHtml(n.text);
  // デモのデータは Orca に無いワークスペースを指すので、開けるようにしない。
  // 行（li）は操作できる要素にせず、開く部分とチケットのバッジを兄弟として並べる
  // （role="button" の中に別のボタンを入れない）。
  const open =
    n.target && !snapshot.demo
      ? `<div class="open" role="button" tabindex="0" title="${NEED_OPEN_TITLE}" data-need="${escapeHtml(n.id)}">`
      : "<div>";
  const item =
    n.item !== undefined ? `<span class="item-no">#${n.item}</span>` : "";
  return (
    `<li class="row needs">${open}` +
    `<div class="route"><span class="needs-icon" aria-hidden="true">!</span>` +
    `<span class="who">${escapeHtml(labelOf(snapshot, n.node))}</span>${item}` +
    `<span class="kind needs ${n.reason}">${NEED_LABELS[n.reason]}</span>` +
    `<time>${n.at ? relativeTime(n.at, snapshot.at) : ""}</time></div>` +
    `<div class="subject${masked ? " masked" : ""}">${text}</div></div>` +
    renderTickets(n.tickets, `need:${n.id}`, { masked, demo: snapshot.demo }) +
    `</li>`
  );
}

export function renderLists(snapshot: Snapshot, masked: boolean): string {
  const rows = (flows: Flow[]) =>
    flows.map((f) => renderRow(snapshot, f, masked)).join("");
  const needs = snapshot.needsYou
    .map((n) => renderNeed(snapshot, n, masked))
    .join("");
  return (
    section(
      "NEEDS YOU",
      snapshot.needsYou.length,
      needs,
      "人の対応を待っているものはありません",
    ) +
    section(
      "IN FLIGHT",
      snapshot.inFlight.length,
      rows(snapshot.inFlight),
      "いま動いているエージェントはありません",
    ) +
    section(
      "RECENT",
      snapshot.recent.length,
      rows(snapshot.recent),
      "まだ依頼はありません",
    )
  );
}

/** 取得に失敗しても表示は消さず、いつの状態を出しているかと失敗の中身を添える。 */
export function renderErrors(
  errors: string[],
  lastOkAt: number | null,
  now: number,
): string {
  if (!errors.length) return "";
  const since = lastOkAt
    ? `${relativeTime(lastOkAt, now)} 前に取れた状態を表示しています。`
    : "";
  const details = errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("");
  return `<div class="error" role="alert"><strong>更新できませんでした。</strong>${since}<ul>${details}</ul></div>`;
}
