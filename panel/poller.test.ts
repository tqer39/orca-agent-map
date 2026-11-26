import { assert, test } from "orca/testing";
import { createPoller } from "./poller";

/** 手で解決できる読み込みと、手で進めるタイマー。 */
function harness() {
  const pending: (() => void)[] = [];
  const applied: number[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  let started = 0;
  const refresh = createPoller({
    tick: () => {
      const n = ++started;
      return new Promise<void>((resolve) => {
        pending.push(() => {
          applied.push(n);
          resolve();
        });
      });
    },
    hidden: () => false,
    intervalMs: () => 5000,
    setTimer: (fn) => {
      const id = ++nextTimer;
      timers.set(id, fn);
      return id;
    },
    clearTimer: (id) => timers.delete(id as number),
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { refresh, pending, applied, timers, flush, started: () => started };
}

test("実行中に頼まれた更新は重ねず、終わった直後に 1 回だけ行う", async () => {
  const h = harness();
  void h.refresh();
  void h.refresh(); // 表示切り替えなどで重なった更新
  void h.refresh();
  assert.equal(h.started(), 1);
  h.pending.shift()?.();
  await h.flush();
  assert.equal(h.started(), 2);
  assert.equal(h.timers.size, 0);
  h.pending.shift()?.();
  await h.flush();
  assert.deepEqual(h.applied, [1, 2]);
  assert.equal(h.timers.size, 1);
});

test("待ちのタイマーは常に 1 本", async () => {
  const h = harness();
  void h.refresh();
  h.pending.shift()?.();
  await h.flush();
  assert.equal(h.timers.size, 1);
  void h.refresh(); // タイマーを待たずに読み直す
  h.pending.shift()?.();
  await h.flush();
  assert.equal(h.timers.size, 1);
  const [fire] = h.timers.values();
  fire();
  h.pending.shift()?.();
  await h.flush();
  assert.equal(h.timers.size, 1);
  assert.deepEqual(h.applied, [1, 2, 3]);
});
