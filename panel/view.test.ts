import { assert, test } from "orca/testing";
import { demoSources } from "../src/demo";
import { buildSnapshot, type Flow, type Need } from "../src/model";
import {
  actionFor,
  edgesOf,
  escapeHtml,
  layout,
  relativeTime,
  renderErrors,
  renderGraph,
  renderLists,
  renderNeed,
} from "./view";

const NOW = Date.UTC(2030, 0, 1);
const snapshot = buildSnapshot(demoSources(NOW), NOW);

test("件名の HTML はエスケープする", () => {
  assert.equal(
    escapeHtml(`<img src=x onerror="a">&'`),
    "&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;",
  );
  const s = {
    ...snapshot,
    recent: [{ ...snapshot.recent[0], subject: "<b>x</b>" }],
  };
  assert.ok(renderLists(s, false, true).includes("&lt;b&gt;x&lt;/b&gt;"));
});

test("Masked なら件名を出さない", () => {
  const html = renderLists(snapshot, true, true);
  for (const f of [...snapshot.inFlight, ...snapshot.recent])
    assert.ok(!html.includes(f.subject));
  assert.ok(
    renderLists(snapshot, false, true).includes("比較表をまとめました"),
  );
});

test("進行中の組だけ点線で流れる線になる", () => {
  const svg = renderGraph(snapshot, 320);
  assert.equal((svg.match(/class="edge [a-z]+ live"/g) ?? []).length, 4);
  assert.ok(svg.includes("Concierge"));
});

test("同じ送り元・送り先の依頼は 1 本の線にまとめる", () => {
  const f = (id: string, live: boolean): Flow => ({
    id,
    from: "a",
    to: "b",
    type: "handoff",
    subject: "",
    at: 0,
    live,
  });
  assert.deepEqual(edgesOf([f("1", false), f("2", true)]), [
    { from: "a", to: "b", kind: "handoff", live: true },
  ]);
});

test("送るほうが多いノードは左、受けるほうが多いノードは右", () => {
  const { placed } = layout(
    snapshot.nodes,
    [...snapshot.inFlight, ...snapshot.recent],
    320,
  );
  const side = (label: string) =>
    [...placed.values()].find((p) => p.node.label === label)?.side;
  assert.equal(side("Concierge"), "left");
  assert.equal(side("Planner"), "right");
});

test("相対時刻", () => {
  assert.equal(relativeTime(NOW - 5_000, NOW), "5s");
  assert.equal(relativeTime(NOW - 3 * 60_000, NOW), "3m");
  assert.equal(relativeTime(NOW - 2 * 3_600_000, NOW), "2h");
});

test("進行中が 0 件でも空の文言を出し、RECENT はそのまま見せる", () => {
  const html = renderLists({ ...snapshot, inFlight: [] }, false, true);
  assert.ok(html.includes("いま動いているエージェントはありません"));
  assert.ok(html.includes("比較表をまとめました"));
});

test("NEEDS YOU を一番上に出し、理由を文字でも示す", () => {
  const html = renderLists(snapshot, false, true);
  assert.ok(html.indexOf("NEEDS YOU") < html.indexOf("IN FLIGHT"));
  assert.ok(
    html.includes("許可待ち") &&
      html.includes("Needs you") &&
      html.includes("未読"),
  );
  assert.ok(html.includes("来週の定例は火曜と木曜のどちらにしますか？"));
  assert.ok(!renderLists(snapshot, true, true).includes("来週の定例"));
});

test("人を待つノードは ! の印と title で示す", () => {
  const svg = renderGraph(snapshot, 320);
  assert.equal((svg.match(/class="node [a-z]+ needs"/g) ?? []).length, 3);
  assert.ok(svg.includes("needs you)"));
});

test("取得に失敗したら、いつの状態かと失敗の中身を出す", () => {
  const html = renderErrors(["orca worktree ps: timeout"], NOW - 120_000, NOW);
  assert.ok(html.includes("更新できませんでした"));
  assert.ok(html.includes("2m 前に取れた状態"));
  assert.ok(html.includes("orca worktree ps: timeout"));
  assert.equal(renderErrors([], NOW, NOW), "");
});

test("開く先のある Need は選べる行にし、Item 番号を出す", () => {
  const s = { ...snapshot, demo: false };
  const need = {
    id: `item:"x"<y>:3`,
    node: "bot:Scheduler",
    reason: "item" as const,
    text: "見て",
    at: 0,
    target: { workspaceId: "folder:home" },
    item: 3,
  };
  const html = renderNeed(s, need, false, true);
  assert.ok(html.includes('role="button"'));
  assert.ok(html.includes('tabindex="0"'));
  assert.ok(html.includes('data-go="need:item:&quot;x&quot;&lt;y&gt;:3"'));
  assert.ok(html.includes("#3"));
  // Masked でも Item 番号は出す（件名ではないので、探す手がかりに残す）。
  assert.ok(renderNeed(s, need, true, true).includes("#3"));

  const { target: _, ...noTarget } = need;
  assert.ok(!renderNeed(s, noTarget, false, true).includes("data-go"));
  // デモのデータは Orca に無いワークスペースを指すので選べない。
  assert.ok(
    !renderNeed({ ...s, demo: true }, need, false, true).includes("data-go"),
  );
});

test("Orca で開く先が無い Item は、パネルが URL を開けるときだけリンクを開く行にする", () => {
  const s = { ...snapshot, demo: false };
  const url = "https://example.com/demo/pull/9";
  const need: Need = {
    id: "item:Away:9",
    node: "bot:Away",
    reason: "item",
    text: "見て",
    at: 0,
    url,
  };
  const html = renderNeed(s, need, false, true);
  assert.ok(html.includes('data-go="need:item:Away:9"'));
  assert.ok(html.includes("ブラウザで開く"));
  // shell の無いクライアントでは開けないので、押せる見た目にしない。
  assert.ok(!renderNeed(s, need, false, false).includes("data-go"));
  const withUrl = { ...s, needsYou: [need] };
  assert.deepEqual(actionFor(withUrl, "need:item:Away:9", true), {
    kind: "external",
    url,
  });
  assert.equal(actionFor(withUrl, "need:item:Away:9", false), null);
  // Orca で開く先があれば、そちらを先にする。
  const both = { ...need, target: { workspaceId: "folder:home" } };
  assert.deepEqual(
    actionFor({ ...s, needsYou: [both] }, "need:item:Away:9", true),
    { kind: "orca", target: { workspaceId: "folder:home" } },
  );
});

test("IN FLIGHT / RECENT の行は受け手のノードを開き、開く先の無い行やノードは押せる見た目にしない", () => {
  const s = { ...snapshot, demo: false };
  const html = renderLists(s, false, true);
  const flows = [...s.inFlight, ...s.recent];
  const openable = flows.filter((f) => s.targets[f.to]);
  assert.ok(openable.length > 0 && openable.length < flows.length);
  const keys = [...html.matchAll(/data-go="(node:[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    keys,
    openable.map((f) => `node:${f.to}`),
  );
  assert.deepEqual(actionFor(s, `node:${openable[0].to}`, false), {
    kind: "orca",
    target: s.targets[openable[0].to],
  });
  const svg = renderGraph(s, 320);
  const nodes = [...svg.matchAll(/<g class="node[^"]*" data-go="([^"]+)"/g)];
  assert.equal(nodes.length, s.nodes.filter((n) => s.targets[n.id]).length);
  assert.ok(
    nodes.every((m) =>
      svg.includes(`data-go="${m[1]}" role="button" tabindex="0"`),
    ),
  );
  // デモのデータは開かない。
  const demo = { ...snapshot, demo: true };
  assert.ok(!renderLists(demo, false, true).includes("data-go"));
  assert.ok(!renderGraph(demo, 320).includes("data-go"));
});
