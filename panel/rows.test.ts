// 行の構造のテスト。描いた HTML を木にして、押せる要素が入れ子になっていないことを確かめる。
import { assert, test } from "orca/testing";
import { demoSources } from "../src/demo";
import { buildSnapshot } from "../src/model";
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
    for (const html of [
      renderLists(snapshot, masked),
      renderGraph(snapshot, 320, masked),
    ]) {
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

test("NEEDS YOU の行: 開く部分とバッジは li の下の兄弟で、li 自体は押せない", () => {
  const els = parse(renderLists(snapshot, false));
  const openers = els.filter((el) => "data-need" in el.attrs);
  assert.equal(openers.length, snapshot.needsYou.length);
  for (const open of openers) {
    assert.equal(open.attrs.role, "button");
    assert.equal(open.attrs.tabindex, "0");
    assert.equal(open.parent?.tag, "li");
    assert.ok(!interactive(open.parent as El));
  }
  const badges = els.filter((el) => "data-ticket-url" in el.attrs);
  assert.ok(badges.length > 0);
  for (const badge of badges) {
    assert.equal(badge.tag, "button");
    assert.equal(badge.parent?.attrs.class, "tickets");
    assert.equal(badge.parent?.parent?.tag, "li");
    // 行をクリックしたときの移動（closest("[data-need]")）に掛からない。
    assert.ok(!ancestors(badge).some((p) => "data-need" in p.attrs));
  }
});

test("描き直しても、フォーカスを戻すためのキーは同じ行・同じバッジを指す", () => {
  const keys = (html: string, name: string) =>
    parse(html)
      .map((el) => el.attrs[name])
      .filter(Boolean)
      .sort();
  const first = renderLists(snapshot, false);
  // 次の更新でチケットの並びが変わっても、キーは変わらない。
  const reordered = {
    ...snapshot,
    needsYou: snapshot.needsYou.map((n) => ({
      ...n,
      tickets: n.tickets && [...n.tickets].reverse(),
    })),
  };
  const second = renderLists(reordered, false);
  assert.deepEqual(keys(second, "data-need"), keys(first, "data-need"));
  assert.deepEqual(keys(second, "data-ticket"), keys(first, "data-ticket"));
  assert.equal(
    new Set(keys(first, "data-ticket")).size,
    keys(first, "data-ticket").length,
  );
});

test("Masked でも行は開けて、バッジだけ押せなくなる", () => {
  const els = parse(renderLists(snapshot, true));
  assert.equal(
    els.filter((el) => "data-need" in el.attrs).length,
    snapshot.needsYou.length,
  );
  assert.equal(els.filter((el) => "data-ticket" in el.attrs).length, 0);
  assert.equal(els.filter((el) => el.tag === "button").length, 0);
});
