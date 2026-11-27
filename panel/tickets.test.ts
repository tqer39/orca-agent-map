import { assert, test } from "orca/testing";
import { demoSources } from "../src/demo";
import { buildSnapshot, type Ticket } from "../src/model";
import {
  renderNodeTickets,
  renderTickets,
  type TicketEvent,
  ticketHandler,
} from "./tickets";
import { renderGraph, renderLists } from "./view";

const NOW = Date.UTC(2030, 0, 1);
const URL_1 = "https://linear.example.com/demo/issue/ABC-123";
const live = { masked: false, demo: false };
const tickets: Ticket[] = [
  { label: "ABC-123", provider: "linear", url: URL_1 },
  { label: "PR #12", provider: "github" },
];
// デモ表示ではバッジを押せないので、押せる状態はデモの印を外して確かめる。
const snapshot = { ...buildSnapshot(demoSources(NOW), NOW), demo: false };

test("URL のあるバッジはボタン、無いバッジは押せない見た目にする", () => {
  const html = renderTickets(tickets, "need:x", live);
  assert.ok(
    html.includes(
      `<button type="button" class="ticket" data-ticket="need:x#0" data-ticket-url="${URL_1}"`,
    ),
  );
  assert.ok(html.includes('<span class="ticket static">PR #12</span>'));
  assert.equal(renderTickets([], "need:x", live), "");
  assert.equal(renderTickets(undefined, "need:x", live), "");
});

test("バッジの文字と URL はエスケープする", () => {
  const html = renderTickets(
    [{ label: "<b>", provider: '"x"', url: 'https://example.com/?a="b"&c' }],
    "s",
    live,
  );
  assert.ok(html.includes("&lt;b&gt;"));
  assert.ok(html.includes("https://example.com/?a=&quot;b&quot;&amp;c"));
  assert.ok(!html.includes("<b>"));
});

test("Masked ならバッジも伏せ、押せなくする", () => {
  for (const html of [
    renderTickets(tickets, "need:x", { masked: true, demo: false }),
    renderLists(snapshot, true),
    renderGraph(snapshot, 320, true),
  ]) {
    assert.ok(html.includes("•••"));
    assert.ok(!html.includes("ABC-12"));
    assert.ok(!html.includes("PR #"));
    assert.ok(!html.includes("data-ticket-url"));
  }
});

test("デモ表示のバッジは押せない", () => {
  const html = renderLists({ ...snapshot, demo: true }, false);
  assert.ok(html.includes('<span class="ticket static">ABC-123</span>'));
  assert.ok(!html.includes("data-ticket-url"));
});

test("一覧: 依頼の行は受け手の、NEEDS YOU の行はその相手のチケットを出す", () => {
  const html = renderLists(snapshot, false);
  // Planner 宛ての依頼の行と、builder-a（許可待ち）と Item の行。
  assert.ok(html.includes('data-ticket="flow:msg_demo_01#0"'));
  assert.ok(html.includes(">ABC-124</button>"));
  assert.ok(html.includes(">PR #7</button>"));
  // チケットの無い相手の行には何も足さない。
  assert.ok(!html.includes('data-ticket="flow:msg_demo_03#0"'));
});

test("図: ノードの下にバッジを出し、バッジの段だけ高くする", () => {
  const svg = renderGraph(snapshot, 320);
  assert.ok(svg.includes(">ABC-123</text>"));
  assert.ok(svg.includes('role="link" tabindex="0"'));
  const height = (s: string) => Number(/height="(\d+)"/.exec(s)?.[1]);
  assert.ok(
    height(svg) > height(renderGraph({ ...snapshot, tickets: {} }, 320)),
  );
});

test("図: 幅に入らないバッジは +N にまとめる", () => {
  const many: Ticket[] = [1, 2, 3, 4].map((n) => ({
    label: `ABC-10${n}`,
    provider: "jira",
  }));
  const svg = renderNodeTickets(many, "node:x", live, 0, 0, 100);
  assert.equal((svg.match(/ABC-10/g) ?? []).length, 1);
  assert.ok(svg.includes(">+3</text>"));
});

function fakeEvent(
  type: string,
  attrs: Record<string, string> | null,
  key?: string,
  tagName = "BUTTON",
) {
  const calls: string[] = [];
  const el = { tagName, getAttribute: (n: string) => attrs?.[n] ?? null };
  const event: TicketEvent = {
    type,
    key,
    target: { closest: () => (attrs ? el : null) },
    stopPropagation: () => calls.push("stop"),
    preventDefault: () => calls.push("prevent"),
  };
  return { event, calls };
}

function handler(
  result: { opened: boolean; reason?: string } = { opened: true },
) {
  const opened: string[] = [];
  const reports: (string | null)[] = [];
  const handle = ticketHandler({
    openExternal: (url) => {
      opened.push(url);
      return Promise.resolve(result);
    },
    report: (text) => reports.push(text),
  });
  return { handle, opened, reports };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("バッジのクリックは URL を開き、行のクリックには伝えない", async () => {
  const { handle, opened, reports } = handler();
  const { event, calls } = fakeEvent("click", { "data-ticket-url": URL_1 });
  handle(event);
  // await を挟まず、クリックの中で呼ぶ。
  assert.deepEqual(opened, [URL_1]);
  assert.deepEqual(calls, ["stop"]);
  await tick();
  assert.deepEqual(reports, [null]);
});

test("バッジ以外のクリックと、押せないバッジには何もしない", () => {
  const { handle, opened } = handler();
  for (const attrs of [null, {}]) {
    const { event, calls } = fakeEvent("click", attrs);
    handle(event);
    assert.deepEqual(calls, []);
  }
  assert.deepEqual(opened, []);
});

test("キーボード: button は click に任せ、図のバッジは Enter / Space で開く", () => {
  const { handle, opened } = handler();
  const attrs = { "data-ticket-url": URL_1 };
  // button の Enter は行の keydown に伝えず、既定の動作（click）は止めない。
  const button = fakeEvent("keydown", attrs, "Enter");
  handle(button.event);
  assert.deepEqual(button.calls, ["stop"]);
  assert.deepEqual(opened, []);

  for (const key of ["Enter", " "]) {
    const svg = fakeEvent("keydown", attrs, key, "g");
    handle(svg.event);
    assert.deepEqual(svg.calls, ["stop", "prevent"]);
  }
  assert.deepEqual(opened, [URL_1, URL_1]);

  // Tab などはそのまま通す。
  const tab = fakeEvent("keydown", attrs, "Tab", "g");
  handle(tab.event);
  assert.deepEqual(tab.calls, []);
});

test("開けなかったら理由を出し、取り消しは出さない", async () => {
  const denied = handler({ opened: false, reason: "consent-unavailable" });
  denied.handle(fakeEvent("click", { "data-ticket-url": URL_1 }).event);
  const cancelled = handler({ opened: false, reason: "cancelled" });
  cancelled.handle(fakeEvent("click", { "data-ticket-url": URL_1 }).event);
  await tick();
  assert.match(denied.reports[0] ?? "", /consent-unavailable/);
  assert.deepEqual(cancelled.reports, [null]);

  const reports: (string | null)[] = [];
  ticketHandler({ report: (t) => reports.push(t) })(
    fakeEvent("click", { "data-ticket-url": URL_1 }).event,
  );
  assert.match(reports[0] ?? "", /開けません/);
});
