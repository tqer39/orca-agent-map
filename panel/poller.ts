// 定期的に読み直す仕組み。DOM に触らないので Node でテストできる。

export interface PollerOptions {
  /** 1 回分の読み込み。失敗は中で扱い、投げない。 */
  tick: () => Promise<void>;
  /** 見えていない間は読まない。 */
  hidden: () => boolean;
  intervalMs: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * 読み直しを始める関数を返す。読み込みは 1 つずつにし、実行中に頼まれた分は終わった直後に
 * 1 回だけまとめて行う。古い応答が新しい表示を上書きせず、待ちのタイマーも常に 1 本になる。
 */
export function createPoller(options: PollerOptions): () => Promise<void> {
  const setTimer =
    options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ??
    ((handle: unknown) =>
      clearTimeout(handle as ReturnType<typeof setTimeout>));
  let timer: unknown;
  let running = false;
  let again = false;

  const refresh = async (): Promise<void> => {
    if (running) {
      again = true;
      return;
    }
    clearTimer(timer);
    timer = undefined;
    if (options.hidden()) return;
    running = true;
    try {
      await options.tick();
    } finally {
      running = false;
    }
    if (again) {
      again = false;
      return refresh();
    }
    timer = setTimer(() => void refresh(), options.intervalMs());
  };
  return refresh;
}
