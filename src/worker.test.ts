import { assert, mockHost, mountWorker, test } from "orca/testing";
import { demoSources } from "./demo";
import * as main from "./worker";
import {
  botsReader,
  createLoader,
  needsYouItems,
  type RunCli,
  workersReader,
} from "./worker";

const NOW = Date.UTC(2030, 0, 1);

/** demoSources を返す偽の orca CLI。`fail` に挙げたコマンドは失敗させる。 */
function fakeCli(
  calls: string[][] = [],
  fail: Set<string> = new Set(),
): RunCli {
  const raw = demoSources(NOW);
  return async (args) => {
    calls.push(args);
    if (fail.has(args[1])) throw new Error("not reachable");
    if (args[1] === "inbox") return { messages: raw.messages };
    if (args[1] === "worker-list") return { workers: raw.workers };
    if (args[0] === "worktree") return { worktrees: raw.worktrees };
    if (args[1] === "list") return { bots: raw.bots.map((name) => ({ name })) };
    if (args[1] === "worker-show") {
      const w = raw.workers.find((x) => x.dispatchId === args[3]);
      const wt = raw.worktrees.find((t) => t.worktreeId === w?.workspace);
      return { dispatch: { assigneePaneKey: wt?.agents?.[0]?.paneKey } };
    }
    const bot = args[args.indexOf("--bot") + 1];
    return {
      items: raw.items.filter((i) => i.bot === bot && i.status === "needs_you"),
    };
  };
}

test("デモ設定ならダミーデータを返す", async () => {
  const host = mockHost({ settings: { demo: true } });
  const worker = await mountWorker(main, { host });
  const snapshot = await worker.request("map.snapshot");
  assert.equal(snapshot.demo, true);
  assert.ok(snapshot.nodes.some((n) => n.label === "Concierge"));
  assert.ok(snapshot.inFlight.length > 0);
  assert.deepEqual(worker.refusals, []);
  await worker.deactivate();
});

test("CLI の結果を 1 つのスナップショットにまとめる", async () => {
  const calls: string[][] = [];
  const snapshot = await createLoader(fakeCli(calls))(NOW);
  assert.deepEqual(calls.slice(0, 4), [
    ["orchestration", "inbox", "--full", "--limit", "100"],
    ["orchestration", "worker-list"],
    ["worktree", "ps"],
    ["bot", "list"],
  ]);
  assert.equal(calls.filter((c) => c[1] === "item").length, 4);
  assert.equal(snapshot.inFlight.length, 4);
  assert.deepEqual(
    snapshot.needsYou.map((n) => n.reason),
    ["permission", "item", "unread"],
  );
  assert.ok(snapshot.nodes.some((n) => n.label === "Archivist"));
  assert.deepEqual(snapshot.errors, []);
});

test("取得に失敗したら最後に取れた値で描き、失敗を errors に載せる", async () => {
  const fail = new Set<string>();
  const load = createLoader(fakeCli([], fail));
  const first = await load(NOW);
  fail.add("worker-list");
  fail.add("inbox");
  const second = await load(NOW);
  assert.deepEqual(second.errors, [
    "orca orchestration inbox: not reachable",
    "orca orchestration worker-list: not reachable",
  ]);
  assert.deepEqual(second.inFlight, first.inFlight);
  assert.deepEqual(second.recent, first.recent);
});

test("一度も取れていないデータの元は空として描く", async () => {
  const snapshot = await createLoader(fakeCli([], new Set(["worker-list"])))(
    NOW,
  );
  assert.deepEqual(snapshot.errors, [
    "orca orchestration worker-list: not reachable",
  ]);
  assert.ok(snapshot.recent.length > 0);
});

test("ボットの一覧と Item は 15 秒のあいだ読み直さない", async () => {
  let calls = 0;
  const read = botsReader(async (args) => {
    calls++;
    return args[1] === "list"
      ? { bots: [{ name: "Scheduler" }] }
      : { items: [] };
  });
  await read(0);
  await read(10_000);
  assert.equal(calls, 2);
  await read(15_000);
  assert.equal(calls, 4);
});

test("走っている worker の担当は worker-show で引き、dispatch ごとに覚える", async () => {
  const calls: string[][] = [];
  const read = workersReader(fakeCli(calls));
  const first = await read();
  const shown = () =>
    calls.filter((c) => c[1] === "worker-show").map((c) => c[3]);
  assert.deepEqual(shown().sort(), ["ctx_demo_a", "ctx_demo_b"]);
  assert.deepEqual(
    first.workers.map((w) => [w.dispatchId, w.assigneePaneKey]),
    [
      ["ctx_demo_a", "pane-4"],
      ["ctx_demo_b", "pane-5"],
      ["ctx_demo_c", undefined],
    ],
  );
  await read();
  assert.equal(shown().length, 2);
});

test("worker-show に失敗しても worker-list は描き、次の更新で引き直す", async () => {
  let fail = true;
  const calls: string[][] = [];
  const cli = fakeCli(calls);
  const read = workersReader(async (args) => {
    if (args[1] === "worker-show" && fail) throw new Error("timeout");
    return cli(args);
  });
  const first = await read();
  assert.equal(first.workers.length, 3);
  assert.ok(first.workers.every((w) => w.assigneePaneKey === undefined));
  fail = false;
  const second = await read();
  assert.equal(second.workers[0].assigneePaneKey, "pane-4");
});

test("Needs you の Item は nextCursor を辿って全ページ読む", async () => {
  const calls: string[][] = [];
  const pages: Record<
    string,
    { items: { number: number }[]; nextCursor?: string }
  > = {
    "": {
      items: Array.from({ length: 100 }, (_, i) => ({ number: i + 1 })),
      nextCursor: "p2",
    },
    p2: { items: [{ number: 101 }, { number: 102 }] },
  };
  const items = await needsYouItems(async (args) => {
    calls.push(args);
    const i = args.indexOf("--cursor");
    return pages[i < 0 ? "" : args[i + 1]];
  }, "Scheduler");
  assert.equal(items.length, 102);
  assert.deepEqual(items[101], { number: 102, bot: "Scheduler" });
  assert.deepEqual(calls[1].slice(-2), ["--cursor", "p2"]);
  assert.ok(calls[0].includes("--limit"));
});
