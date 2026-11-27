import { assert, test } from "orca/testing";
import { demoSources } from "../src/demo";
import { buildSnapshot, type Flow } from "../src/model";
import {
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
  assert.ok(renderLists(s, false).includes("&lt;b&gt;x&lt;/b&gt;"));
});

test("Masked なら件名を出さない", () => {
  const html = renderLists(snapshot, true);
  for (const f of [...snapshot.inFlight, ...snapshot.recent])
    assert.ok(!html.includes(f.subject));
  assert.ok(renderLists(snapshot, false).includes("比較表をまとめました"));
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
  const html = renderLists({ ...snapshot, inFlight: [] }, false);
  assert.ok(html.includes("いま動いているエージェントはありません"));
  assert.ok(html.includes("比較表をまとめました"));
});

test("NEEDS YOU を一番上に出し、理由を文字でも示す", () => {
  const html = renderLists(snapshot, false);
  assert.ok(html.indexOf("NEEDS YOU") < html.indexOf("IN FLIGHT"));
  assert.ok(
    html.includes("許可待ち") &&
      html.includes("Needs you") &&
      html.includes("未読"),
  );
  assert.ok(html.includes("来週の定例は火曜と木曜のどちらにしますか？"));
  assert.ok(!renderLists(snapshot, true).includes("来週の定例"));
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
  const html = renderNeed(s, need, false);
  assert.ok(html.includes('role="button"'));
  assert.ok(html.includes('tabindex="0"'));
  assert.ok(html.includes('data-need="item:&quot;x&quot;&lt;y&gt;:3"'));
  assert.ok(html.includes("#3"));
  // Masked でも Item 番号は出す（件名ではないので、探す手がかりに残す）。
  assert.ok(renderNeed(s, need, true).includes("#3"));

  const { target: _, ...noTarget } = need;
  assert.ok(!renderNeed(s, noTarget, false).includes("data-need"));
  // デモのデータは Orca に無いワークスペースを指すので選べない。
  assert.ok(
    !renderNeed({ ...s, demo: true }, need, false).includes("data-need"),
  );
});
