// 押された行やノードの移動を行う。DOM に触らないので Node でテストできる。
import type { NeedTarget, OpenResult } from "../src/protocol";
import type { GoAction } from "./view";

export function errorText(error: unknown): string {
  const e = error as { code?: string; message?: string };
  return `${e.code ?? "error"}: ${e.message ?? ""}`;
}

export interface GoDeps {
  /** worker に Orca の中の移動を頼む（map.open）。 */
  open(target: NeedTarget): Promise<OpenResult>;
  openExternal?(url: string): Promise<{ opened: boolean }>;
  /** 押した操作がまだ有効か（navigator.userActivation.isActive）。URL はその間しか開けない。 */
  active(): boolean;
  /** 開けなかった理由を出す。null で消す。 */
  report(error: string | null): void;
}

/** 前の移動が終わったか分からないので、待っていた移動を送らなかったときの案内。 */
export const UNSETTLED =
  "前の移動がまだ終わっていないかもしれないので、次の移動はしませんでした。もう一度押してください";

/**
 * 時間切れなどで答えが来なかった。worker の処理が終わったとは限らない（Orca は要求を中断するが、
 * 処理の終わりは待たない）ので、次の要求をすぐ送ると同時に 2 つ動くことがある。
 */
function unsettled(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === "timeout" || code === "cancelled";
}

export const EXPIRED =
  "押してから時間がたったので、リンクを開けませんでした。もう一度押してください";

/**
 * 移動を行う関数を返す。worker への移動の要求は一度に 1 つだけにし、前の要求の答えを待ってから
 * 次を行う。待つあいだに押されたものは、最後に押した 1 つだけ残す。
 *
 * パネルから worker への要求は、同時に出すと届く順が入れ替わることがある（Orca は要求ごとに
 * worker の用意を待ってから渡す）。一度に 1 つなら、このパネルの要求は押した順に終わる。
 * URL も、前の移動が終わってから開く（それまでは何も始めない）。
 * 時間切れで答えが来なかったときは、worker の処理が残っているかもしれないので、待っていたものは
 * 送らずに捨て、もう一度押してもらう（worker も中断された要求では host を呼ばない）。
 */
export function goer(deps: GoDeps): (action: GoAction) => Promise<void> {
  let latest = 0;
  let busy = false;
  let waiting: { action: GoAction; mine: number } | null = null;

  /**
   * 1 つ行う。最後に押したもの以外の結果は出さない。worker の処理が終わったか分からないまま
   * 戻ったときは false を返す。
   */
  async function perform(action: GoAction, mine: number): Promise<boolean> {
    const report = (error: string | null) => {
      if (mine === latest) deps.report(error);
    };
    if (action.kind === "orca") {
      try {
        await deps.open(action.target);
        report(null);
      } catch (error) {
        report(`Orca で開けませんでした（${errorText(error)}）`);
        return !unsettled(error);
      }
      return true;
    }
    // 前の移動を待ったあいだに、押した操作の有効期間が切れていることがある。
    if (!deps.active()) {
      report(EXPIRED);
      return true;
    }
    try {
      // 押した直後なら await を挟まずに呼ぶ（shell.openExternal は押した操作の中でしか開けない）。
      const opened = await deps.openExternal?.(action.url);
      report(opened?.opened ? null : "リンクを開けませんでした");
    } catch (error) {
      report(`リンクを開けませんでした（${errorText(error)}）`);
    }
    return true;
  }

  return async (action) => {
    const mine = ++latest;
    if (busy) {
      waiting = { action, mine };
      return;
    }
    busy = true;
    try {
      let next: { action: GoAction; mine: number } | null = { action, mine };
      while (next) {
        const settled = await perform(next.action, next.mine);
        const after: { action: GoAction; mine: number } | null = waiting;
        waiting = null;
        // 前の移動が終わったか分からないときは、待っていた移動を送らず、もう一度押してもらう。
        if (!settled && after) {
          if (after.mine === latest) deps.report(UNSETTLED);
          break;
        }
        next = after;
      }
    } finally {
      busy = false;
    }
  };
}
