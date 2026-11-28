// テストだけが使う偽物。プラグインの本体からは読まない。
import type { RunCli } from "./worker";

/** terminal list の応答を answer() まで返さない偽の CLI。fails なら失敗で答える。 */
export function heldCli(fails = false) {
  let answered = false;
  const waiting: (() => void)[] = [];
  const run: RunCli = () =>
    new Promise((resolve, reject) => {
      const settle = () =>
        fails
          ? reject(new Error("timeout"))
          : resolve({
              terminals: [
                {
                  handle: "term_1",
                  worktreeId: "repo::/w",
                  tabId: "t",
                  leafId: "l",
                },
              ],
            });
      if (answered) settle();
      else waiting.push(settle);
    });
  return {
    run,
    answer: () => {
      answered = true;
      for (const settle of waiting.splice(0)) settle();
    },
  };
}
