// panel/main.ts のクリックの扱いを、DOM と Orca の最小の偽物で動かす。
import { assert, test } from "orca/testing";
import type { OrcaWorkerApi } from "orca/worker";
import { buildSnapshot } from "../src/model";
import { heldCli } from "../src/test-helpers";
import type { NeedTarget } from "../src/protocol";
import { openTarget } from "../src/worker";

const URL_B = "https://example.com/demo/pull/2";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const snapshot = buildSnapshot(
  {
    messages: [],
    workers: [],
    worktrees: [
      {
        worktreeId: "repo::/w",
        agents: [
          { orcaSessionId: "agent-a", paneKey: "t:l", state: "working" },
        ],
      },
    ],
    bots: ["Away"],
    items: [
      {
        bot: "Away",
        number: 2,
        title: "見て",
        status: "needs_you",
        links: [{ kind: "pr", pr: { url: URL_B } }],
      },
    ],
  },
  Date.UTC(2030, 0, 1),
);

// --- DOM と Orca の偽物 ---
const events: string[] = [];
type Listener = (event: unknown) => void;
const listeners: { type: string; fn: Listener; capture: boolean }[] = [];
/** capture の listener を先に呼び、stopPropagation されたら残りを呼ばない（document だけの簡単な版）。 */
function dispatch(type: string, event: Record<string, unknown> = {}) {
  let stopped = false;
  const e = {
    type,
    ...event,
    stopPropagation: () => {
      stopped = true;
    },
    preventDefault() {},
  };
  for (const capture of [true, false])
    for (const l of listeners.filter(
      (x) => x.type === type && x.capture === capture,
    )) {
      if (stopped) return;
      l.fn(e);
    }
}
const element = () => ({
  innerHTML: "",
  textContent: "",
  hidden: false,
  clientWidth: 320,
  classList: { toggle() {} },
  setAttribute() {},
  addEventListener() {},
  contains: () => false,
  querySelectorAll: () => [],
});
const doc = {
  hidden: true,
  activeElement: null,
  getElementById: element,
  addEventListener: (type: string, fn: Listener, capture = false) =>
    listeners.push({ type, fn, capture: capture === true }),
};

let cli = heldCli();
const host = {
  has: () => true,
  call: async (method: string) => {
    events.push(`host:${method}`);
    return method === "terminal.focus" ? { focused: true } : { opened: true };
  },
} as unknown as OrcaWorkerApi["host"];
/** worker へ届くのを止めている map.open。deliver() で 1 つ届ける。 */
const held: (() => void)[] = [];
const deliver = async () => {
  held.shift()?.();
  await tick();
};
const fakeOrca = {
  plugin: {
    request: async (name: string, input?: unknown) => {
      if (name === "map.snapshot") return snapshot;
      if (name === "map.open") {
        events.push("send:map.open");
        return new Promise((resolve, reject) => {
          held.push(() =>
            openTarget(host, cli.run, input as NeedTarget).then(
              resolve,
              reject,
            ),
          );
        });
      }
      throw new Error(`unknown ${name}`);
    },
  },
  settings: {
    get: async () => ({}),
    set: async () => {},
    onDidChange() {},
  },
  shell: {
    openExternal: async (url: string) => {
      events.push(`url:${url}`);
      return { opened: true };
    },
  },
};
Object.assign(globalThis, {
  document: doc,
  orca: fakeOrca,
  ResizeObserver: class {
    observe() {}
  },
});

/** 行やノードの開く部分（data-go）を押す。 */
const click = (key: string) =>
  dispatch("click", {
    target: {
      closest: (selector: string) =>
        selector === "[data-go]" ? { getAttribute: () => key } : null,
    },
  });

test("パネルのクリック: 端末を待つあいだに URL を押すと、先の移動が終わってから URL を開く", async () => {
  await import("./main");
  // 一度だけ見える状態にしてスナップショットを読み、また隠してタイマーを止める。
  doc.hidden = false;
  dispatch("visibilitychange");
  await tick();
  doc.hidden = true;
  dispatch("visibilitychange");

  for (const fails of [false, true]) {
    events.length = 0;
    cli = heldCli(fails);
    click("node:agent-a");
    click("need:item:Away:2");
    click("need:item:Away:2");
    await tick();
    // 先の要求が答えるまで、URL は開かず、次の要求も送らない。
    assert.deepEqual(events, ["send:map.open"]);
    await deliver();
    cli.answer();
    await tick();
    // 先の移動が終わってから URL を開く。URL の後に Orca は動かない。
    assert.deepEqual(events, [
      "send:map.open",
      fails ? "host:workspace.open" : "host:terminal.focus",
      `url:${URL_B}`,
    ]);
  }

  // 何も待っていなければ、URL はクリックの中ですぐ開く。
  events.length = 0;
  click("need:item:Away:2");
  assert.deepEqual(events, [`url:${URL_B}`]);

  // チケットのバッジを押すと、ブラウザでチケットを開き、行の移動（map.open）には伝わらない。
  // バッジは行の開く部分の兄弟だが、仮に開く部分の中にあっても capture で止まることを確かめる。
  const TICKET = "https://example.com/demo/issue/9";
  for (const insideRow of [false, true]) {
    events.length = 0;
    const badge = {
      tagName: "BUTTON",
      getAttribute: (name: string) =>
        name === "data-ticket-url" ? TICKET : null,
    };
    dispatch("click", {
      target: {
        closest: (selector: string) =>
          selector === "[data-ticket-url]"
            ? badge
            : selector === "[data-go]" && insideRow
              ? { getAttribute: () => "node:agent-a" }
              : null,
      },
    });
    await tick();
    assert.deepEqual(events, [`url:${TICKET}`]);
  }
});
