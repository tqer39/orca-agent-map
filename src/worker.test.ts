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
    // 本物の worker-list と同じく、担当の paneKey は付けずに返す。
    if (args[1] === "worker-list")
      return {
        workers: raw.workers.map(({ assigneePaneKey: _, ...w }) => w),
      };
    if (args[0] === "worktree") return { worktrees: raw.worktrees };
    if (args[1] === "list") return { bots: raw.bots.map((name) => ({ name })) };
    if (args[1] === "worker-show") {
      const w = raw.workers.find((x) => x.dispatchId === args[3]);
      return { dispatch: { assigneePaneKey: w?.assigneePaneKey } };
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

test("worker の担当は worker-show で引き、dispatch ごとに覚える", async () => {
  const calls: string[][] = [];
  const read = workersReader(fakeCli(calls));
  const first = await read();
  const shown = () =>
    calls.filter((c) => c[1] === "worker-show").map((c) => c[3]);
  assert.deepEqual(shown().sort(), ["ctx_demo_a", "ctx_demo_b", "ctx_demo_c"]);
  assert.deepEqual(
    first.workers.map((w) => [w.dispatchId, w.assigneePaneKey]),
    [
      ["ctx_demo_a", "pane-4"],
      ["ctx_demo_b", "pane-5"],
      ["ctx_demo_c", "pane-6"],
    ],
  );
  await read();
  assert.equal(shown().length, 3);
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
  const { items, incomplete } = await needsYouItems(async (args) => {
    calls.push(args);
    const i = args.indexOf("--cursor");
    return pages[i < 0 ? "" : args[i + 1]];
  }, "Scheduler");
  assert.equal(incomplete, undefined);
  assert.equal(items.length, 102);
  assert.deepEqual(items[101], { number: 102, bot: "Scheduler" });
  assert.deepEqual(calls[1].slice(-2), ["--cursor", "p2"]);
  assert.ok(calls[0].includes("--limit"));
});

/** 終わった worker を、worker-show を引かない位置（21 件目以降）に置いた worker-list。 */
function workerListWith(outcome: string, liveness: string) {
  const older = Array.from({ length: 20 }, (_, i) => ({
    dispatchId: `ctx_old_${i}`,
    workspace: "repo::old",
    outcome: "succeeded",
  }));
  return {
    workers: [
      ...older,
      { dispatchId: "ctx_x", workspace: "repo::shared", outcome, liveness },
    ],
  };
}

test("走っている間に引いた担当は、終わった後も使う", async () => {
  let state: [string, string] = ["in_progress", "live"];
  const shown: string[] = [];
  const read = workersReader(async (args) => {
    if (args[1] === "worker-list") return workerListWith(...state);
    shown.push(args[3]);
    return {
      dispatch: { assigneePaneKey: args[3] === "ctx_x" ? "pane-x" : null },
    };
  });
  await read();
  state = ["succeeded", "exited"];
  const after = await read();
  assert.equal(after.workers.at(-1)?.assigneePaneKey, "pane-x");
  assert.equal(shown.filter((id) => id === "ctx_x").length, 1);
});

test("一覧から消えた dispatch の担当は忘れる", async () => {
  let listed = true;
  const shown: string[] = [];
  const read = workersReader(async (args) => {
    if (args[1] === "worker-list")
      return listed ? workerListWith("in_progress", "live") : { workers: [] };
    shown.push(args[3]);
    return { dispatch: { assigneePaneKey: "pane-x" } };
  });
  await read();
  listed = false;
  await read();
  listed = true;
  await read();
  assert.equal(shown.filter((id) => id === "ctx_x").length, 2);
});

/** ページごとに決まった応答を返す偽の CLI。 */
function pagedCli(next: (cursor: string | undefined) => string | undefined) {
  const calls: (string | undefined)[] = [];
  const run: RunCli = async (args) => {
    const i = args.indexOf("--cursor");
    const cursor = i < 0 ? undefined : args[i + 1];
    calls.push(cursor);
    return { items: [{ number: calls.length }], nextCursor: next(cursor) };
  };
  return { run, calls };
}

test("ページの上限に達しても続きがあれば、未取得ありとして返す", async () => {
  let n = 0;
  const { run, calls } = pagedCli(() => `c${++n}`);
  const result = await needsYouItems(run, "Scheduler");
  assert.equal(calls.length, 50);
  assert.equal(result.items.length, 50);
  assert.match(result.incomplete ?? "", /50 ページを超えた/);
});

test("同じカーソルが続けて返ったら止め、未取得ありとして返す", async () => {
  const { run, calls } = pagedCli(() => "same");
  const result = await needsYouItems(run, "Scheduler");
  assert.deepEqual(calls, [undefined, "same"]);
  assert.equal(result.items.length, 2);
  assert.match(result.incomplete ?? "", /繰り返された/);
});

test("カーソルが A → B → A と巡ったら、同じページを読み直さずに止める", async () => {
  const { run, calls } = pagedCli((c) => (c === "A" ? "B" : "A"));
  const result = await needsYouItems(run, "Scheduler");
  assert.deepEqual(calls, [undefined, "A", "B"]);
  assert.equal(result.items.length, 3);
  assert.match(result.incomplete ?? "", /繰り返された/);
});

test("途中のページで失敗したら、ボットの取得の失敗として伝える", async () => {
  const run: RunCli = async (args) => {
    if (args.includes("--cursor")) throw new Error("timeout");
    return { items: [{ number: 1 }], nextCursor: "p2" };
  };
  await assert.rejects(needsYouItems(run, "Scheduler"), /timeout/);
});

test("未取得のある Item は読めた分を出し、errors にも載せる", async () => {
  let n = 0;
  const run: RunCli = async (args) => {
    if (args[1] === "list" && args[0] === "bot")
      return { bots: [{ name: "Scheduler" }] };
    if (args[1] === "item")
      return {
        items: [{ number: ++n, status: "needs_you", title: `t${n}` }],
        nextCursor: `c${n}`,
      };
    if (args[1] === "inbox") return { messages: [] };
    if (args[1] === "worker-list") return { workers: [] };
    return { worktrees: [] };
  };
  const snapshot = await createLoader(run)(NOW);
  assert.equal(snapshot.needsYou.length, 50);
  assert.equal(snapshot.errors.length, 1);
  assert.match(snapshot.errors[0], /^orca bot: Scheduler: .*50 ページを超えた/);
});
