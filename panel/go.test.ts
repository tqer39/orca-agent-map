import { assert, test } from "orca/testing";
import type { OrcaWorkerApi } from "orca/worker";
import type { NeedTarget } from "../src/protocol";
import { heldCli } from "../src/test-helpers";
import { openTarget } from "../src/worker";
import { EXPIRED, type GoDeps, goer, UNSETTLED } from "./go";
import type { GoAction } from "./view";

const URL_B = "https://example.com/demo/pull/2";
const TERM: GoAction = {
  kind: "orca",
  target: { workspaceId: "repo::/w", paneKey: "t:l" },
};
const ws = (workspaceId: string): GoAction => ({
  kind: "orca",
  target: { workspaceId },
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * パネルと worker の間。map.open は溜めておき、deliver() で worker（openTarget）に届ける。
 * 起きたことは events に順に残し、同時に worker へ向かっている要求の数の最大を数える。
 */
function world(
  options: { fails?: boolean; opened?: boolean; active?: () => boolean } = {},
) {
  const events: string[] = [];
  const host = {
    has: () => true,
    call: async (method: string, params: { workspaceId?: string }) => {
      events.push(
        `host:${method}${params.workspaceId ? `:${params.workspaceId}` : ""}`,
      );
      return method === "terminal.focus" ? { focused: true } : { opened: true };
    },
  } as unknown as OrcaWorkerApi["host"];
  const cli = heldCli(options.fails);
  const held: (() => void)[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const reports: (string | null)[] = [];
  const deps: GoDeps = {
    open: (target: NeedTarget) => {
      events.push(`send:${target.workspaceId}`);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise((resolve, reject) => {
        held.push(() =>
          openTarget(host, cli.run, target)
            .then(resolve, reject)
            .finally(() => inFlight--),
        );
      });
    },
    openExternal: async (url) => {
      events.push(`url:${url}`);
      return { opened: options.opened ?? true };
    },
    active: options.active ?? (() => true),
    report: (error) => reports.push(error),
  };
  return {
    go: goer(deps),
    events,
    reports,
    cli,
    maxInFlight: () => maxInFlight,
    /** 溜めている要求を 1 つ worker に届ける。 */
    deliver: async () => {
      held.shift()?.();
      await tick();
    },
  };
}

test("待つあいだに押したものは最後の 1 つだけ残し、worker への要求は一度に 1 つ", async () => {
  const w = world();
  const first = w.go(TERM);
  void w.go(ws("repo::/b"));
  void w.go(ws("repo::/c"));
  await tick();
  assert.deepEqual(w.events, ["send:repo::/w"]);
  await w.deliver();
  w.cli.answer();
  await tick();
  await w.deliver();
  await first;
  assert.deepEqual(w.events, [
    "send:repo::/w",
    "host:terminal.focus",
    "send:repo::/c",
    "host:workspace.open:repo::/c",
  ]);
  assert.equal(w.maxInFlight(), 1);
  assert.deepEqual(w.reports, [null]);
});

for (const fails of [false, true])
  for (const opened of [true, false])
    test(`端末を待つあいだに URL を押すと、先の移動が終わってから URL を開く（CLI ${fails ? "失敗" : "成功"}・URL ${opened ? "成功" : "キャンセル"}）`, async () => {
      const w = world({ fails, opened });
      const first = w.go(TERM);
      void w.go({ kind: "external", url: URL_B });
      await tick();
      // 先の要求が答えるまで、URL は開かない。
      assert.ok(!w.events.includes(`url:${URL_B}`));
      await w.deliver();
      assert.ok(!w.events.includes(`url:${URL_B}`));
      w.cli.answer();
      await first;
      assert.deepEqual(w.events, [
        "send:repo::/w",
        fails ? "host:workspace.open:repo::/w" : "host:terminal.focus",
        `url:${URL_B}`,
      ]);
      assert.equal(
        w.reports.at(-1),
        opened ? null : "リンクを開けませんでした",
      );
    });

test("待つあいだに押した操作の有効期間が切れたら、URL は開かず、もう一度押すよう案内する", async () => {
  let active = true;
  const w = world({ active: () => active });
  const first = w.go(TERM);
  void w.go({ kind: "external", url: URL_B });
  await tick();
  active = false;
  await w.deliver();
  w.cli.answer();
  await first;
  assert.ok(!w.events.includes(`url:${URL_B}`));
  assert.equal(w.reports.at(-1), EXPIRED);
  // もう一度押せば、待つものが無いのですぐ開く。
  active = true;
  await w.go({ kind: "external", url: URL_B });
  assert.ok(w.events.includes(`url:${URL_B}`));
  assert.equal(w.reports.at(-1), null);
});

test("何も待っていなければ、URL は押した操作の中で（await を挟まずに）開く", () => {
  const w = world();
  void w.go({ kind: "external", url: URL_B });
  assert.deepEqual(w.events, [`url:${URL_B}`]);
});

test("URL を待つあいだに Orca の行を押したら、URL は開かずに後の行を開く", async () => {
  const w = world();
  const first = w.go(TERM);
  void w.go({ kind: "external", url: URL_B });
  void w.go(ws("repo::/c"));
  await w.deliver();
  w.cli.answer();
  await tick();
  await w.deliver();
  await first;
  assert.ok(!w.events.includes(`url:${URL_B}`));
  assert.equal(w.events.at(-1), "host:workspace.open:repo::/c");
});

test("先の移動が失敗しても次の移動は行い、先の失敗で後の表示を上書きしない", async () => {
  const reports: (string | null)[] = [];
  const opened: string[] = [];
  let fail: (error: Error) => void = () => {};
  const go = goer({
    open: (target) =>
      target.workspaceId === "repo::/a"
        ? new Promise((_, reject) => {
            fail = reject;
          })
        : (opened.push(target.workspaceId),
          Promise.resolve({ opened: true, pane: false })),
    active: () => true,
    report: (error) => reports.push(error),
  });
  const first = go(ws("repo::/a"));
  void go(ws("repo::/b"));
  fail(new Error("not reachable"));
  await first;
  assert.deepEqual(opened, ["repo::/b"]);
  assert.deepEqual(reports, [null]);
  // 最後に押したものの失敗は出す。
  const again = go(ws("repo::/a"));
  fail(new Error("not reachable"));
  await again;
  assert.match(reports.at(-1) ?? "", /Orca で開けませんでした.*not reachable/);
});

test("前の移動が時間切れになったら、待っていた移動は送らず、もう一度押すよう案内する", async () => {
  const sent: string[] = [];
  const reports: (string | null)[] = [];
  let timeout: () => void = () => {};
  const go = goer({
    open: (target) => {
      sent.push(target.workspaceId);
      return target.workspaceId === "repo::/a"
        ? new Promise((_, reject) => {
            timeout = () =>
              reject(
                Object.assign(new Error("request timed out"), {
                  code: "timeout",
                }),
              );
          })
        : Promise.resolve({ opened: true, pane: false });
    },
    active: () => true,
    report: (error) => reports.push(error),
  });
  const first = go(ws("repo::/a"));
  void go(ws("repo::/b"));
  void go(ws("repo::/c"));
  timeout();
  await first;
  assert.deepEqual(sent, ["repo::/a"]);
  assert.deepEqual(reports, [UNSETTLED]);
  // もう一度押せば送る。
  await go(ws("repo::/c"));
  assert.deepEqual(sent, ["repo::/a", "repo::/c"]);
  assert.equal(reports.at(-1), null);
});

test("確定した失敗（時間切れでない）なら、待っていた移動は送る", async () => {
  const sent: string[] = [];
  let fail: () => void = () => {};
  const go = goer({
    open: (target) => {
      sent.push(target.workspaceId);
      return target.workspaceId === "repo::/a"
        ? new Promise((_, reject) => {
            fail = () =>
              reject(
                Object.assign(new Error("denied"), {
                  code: "capability_denied",
                }),
              );
          })
        : Promise.resolve({ opened: true, pane: false });
    },
    active: () => true,
    report: () => {},
  });
  const first = go(ws("repo::/a"));
  void go(ws("repo::/c"));
  fail();
  await first;
  assert.deepEqual(sent, ["repo::/a", "repo::/c"]);
});

test("最後に押した移動が時間切れになったら、そのまま理由を出す", async () => {
  const reports: (string | null)[] = [];
  const go = goer({
    open: () =>
      Promise.reject(
        Object.assign(new Error("request timed out"), { code: "timeout" }),
      ),
    active: () => true,
    report: (error) => reports.push(error),
  });
  await go(ws("repo::/a"));
  assert.match(reports.at(-1) ?? "", /Orca で開けませんでした（timeout/);
});
