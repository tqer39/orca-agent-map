// 行の構造のテスト。描いた HTML を木にして、押せる要素が入れ子になっていないことを確かめる。
import { assert, test } from "orca/testing";
import { demoSources } from "../src/demo";
import { buildSnapshot } from "../src/model";
import { readFileSync } from "node:fs";
import { keepFocus } from "./focus";
import { renderGraph, renderLists } from "./view";

const NOW = Date.UTC(2030, 0, 1);
const base = buildSnapshot(demoSources(NOW), NOW);
// デモのデータに開く先を足し、押せる行とバッジのある状態にする。
const snapshot = {
  ...base,
  demo: false,
  needsYou: base.needsYou.map((n, i) => ({
    ...n,
    target: { workspaceId: `repo::dummy-${i}` },
  })),
};
const lists = (masked: boolean) => renderLists(snapshot, masked, true);
const flows = [...snapshot.inFlight, ...snapshot.recent];
/** 開ける行の数（NEEDS YOU は全部、IN FLIGHT / RECENT は受け手に開く先のある行）。 */
const openableRows =
  snapshot.needsYou.length + flows.filter((f) => snapshot.targets[f.to]).length;

interface El {
  tag: string;
  attrs: Record<string, string>;
  parent: El | null;
}

/** view.ts が出す形（属性は二重引用符、閉じタグあり）だけを読む小さなパーサ。 */
function parse(html: string): El[] {
  const all: El[] = [];
  const open: El[] = [];
  for (const m of html.matchAll(/<(\/?)([a-z0-9]+)((?:\s[^<>]*?)?)(\/?)>/g)) {
    if (m[1]) {
      assert.equal(open.pop()?.tag, m[2]);
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of m[3].matchAll(/([a-z-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    const el: El = { tag: m[2], attrs, parent: open.at(-1) ?? null };
    all.push(el);
    if (!m[4]) open.push(el);
  }
  assert.equal(open.length, 0);
  return all;
}

const interactive = (el: El) =>
  el.tag === "button" || "tabindex" in el.attrs || "role" in el.attrs;

function ancestors(el: El): El[] {
  const out: El[] = [];
  for (let p = el.parent; p; p = p.parent) out.push(p);
  return out;
}

test("押せる要素の中に、別の押せる要素を入れない（一覧と図、Masked でも）", () => {
  for (const masked of [false, true]) {
    for (const html of [lists(masked), renderGraph(snapshot, 320, masked)]) {
      for (const el of parse(html).filter(interactive)) {
        // 図の svg（role="group"）は入れ物なので数えない。
        const inside = ancestors(el).filter(
          (p) => interactive(p) && p.attrs.role !== "group",
        );
        assert.deepEqual(inside, []);
      }
    }
  }
});

test("NEEDS YOU / IN FLIGHT / RECENT の行: 開く部分（div.open）とバッジは li の下の兄弟で、li 自体は押せない", () => {
  const els = parse(lists(false));
  const openers = els.filter((el) => "data-go" in el.attrs);
  assert.ok(flows.some((f) => !snapshot.targets[f.to]));
  assert.equal(openers.length, openableRows);
  assert.ok(openers.some((el) => el.attrs["data-go"].startsWith("node:")));
  for (const open of openers) {
    assert.equal(open.tag, "div");
    assert.equal(open.attrs.class, "open");
    assert.equal(open.attrs.role, "button");
    assert.equal(open.attrs.tabindex, "0");
    assert.equal(open.parent?.tag, "li");
    assert.ok(!interactive(open.parent as El));
  }
  // 開けない行の li も押せない。
  for (const li of els.filter((el) => el.tag === "li"))
    assert.ok(!interactive(li));
  const badges = els.filter((el) => "data-ticket-url" in el.attrs);
  assert.ok(badges.length > 0);
  assert.ok(badges.some((b) => b.attrs["data-ticket"].startsWith("flow:")));
  for (const badge of badges) {
    assert.equal(badge.tag, "button");
    assert.equal(badge.parent?.attrs.class, "tickets");
    assert.equal(badge.parent?.parent?.tag, "li");
    // 行をクリックしたときの移動（closest("[data-go]")）に掛からない。
    assert.ok(!ancestors(badge).some((p) => "data-go" in p.attrs));
  }
});

test("図: 開けるノードの g とバッジは兄弟で、バッジはノードを押す操作に掛からない", () => {
  const els = parse(renderGraph(snapshot, 320, false));
  const nodes = els.filter((el) => "data-go" in el.attrs);
  assert.equal(
    nodes.length,
    snapshot.nodes.filter((n) => snapshot.targets[n.id]).length,
  );
  for (const node of nodes) {
    assert.equal(node.tag, "g");
    assert.equal(node.attrs.role, "button");
    assert.equal(node.attrs.tabindex, "0");
  }
  const badges = els.filter((el) => "data-ticket-url" in el.attrs);
  assert.ok(badges.length > 0);
  for (const badge of badges)
    assert.ok(!ancestors(badge).some((p) => "data-go" in p.attrs));
});

test("描き直しても、フォーカスを戻すためのキーは同じ行・同じバッジを指す", () => {
  const keys = (html: string, name: string) =>
    parse(html)
      .map((el) => el.attrs[name])
      .filter(Boolean)
      .sort();
  const first = lists(false);
  // 次の更新でチケットの並びが変わっても、キーは変わらない。
  const reordered = {
    ...snapshot,
    needsYou: snapshot.needsYou.map((n) => ({
      ...n,
      tickets: n.tickets && [...n.tickets].reverse(),
    })),
  };
  const second = renderLists(reordered, false, true);
  assert.deepEqual(keys(second, "data-go"), keys(first, "data-go"));
  assert.deepEqual(keys(second, "data-ticket"), keys(first, "data-ticket"));
  assert.equal(
    new Set(keys(first, "data-ticket")).size,
    keys(first, "data-ticket").length,
  );
});

test("描き直した後、選んでいた行（同じ開く先が複数あれば同じ順番のもの）にフォーカスを戻す", () => {
  const focused: string[] = [];
  const el = (key: string, n: number) => ({
    key,
    n,
    getAttribute: (name: string) => (name === "data-go" ? key : null),
    focus: () => focused.push(`${key}#${n}`),
  });
  let drawn = [el("node:a", 0), el("node:b", 0), el("node:b", 1)];
  const container = {
    contains: (x: unknown) => drawn.includes(x as never),
    querySelectorAll: () => drawn,
  };
  keepFocus(container, drawn[2], () => {
    drawn = [el("node:b", 0), el("node:b", 1), el("node:a", 0)];
  });
  assert.deepEqual(focused, ["node:b#1"]);
  // 中に無い要素を選んでいたら、何もしない。
  keepFocus(container, el("node:x", 0), () => {});
  assert.deepEqual(focused, ["node:b#1"]);
});

test("Masked でも行とノードは開けて、バッジだけ押せなくなる", () => {
  const els = parse(lists(true));
  assert.equal(els.filter((el) => "data-go" in el.attrs).length, openableRows);
  assert.equal(els.filter((el) => "data-ticket" in el.attrs).length, 0);
  assert.equal(els.filter((el) => el.tag === "button").length, 0);
  assert.ok(!lists(true).includes("ABC-12"));
  const svg = parse(renderGraph(snapshot, 320, true));
  assert.ok(svg.some((e) => "data-go" in e.attrs));
  assert.ok(!svg.some((e) => "data-ticket-url" in e.attrs));
});

test("CSS: 開く部分と開けるノードだけを押せる見た目にし、li には付けない", () => {
  const css = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  for (const rule of [
    ".row > .open {",
    ".row > .open:hover {",
    ".row > .open:focus-visible {",
    ".node[data-go] {",
    ".node[data-go]:focus-visible rect {",
  ])
    assert.ok(css.includes(rule), rule);
  assert.ok(!css.includes(".openable"));
  assert.ok(!/\.row\s*\{[^}]*cursor:\s*pointer/.test(css));
});
