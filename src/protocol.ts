// パネル <-> worker の取り決め。panel/main.ts と src/worker.ts の両方が読む。
import type { NeedTarget, Snapshot } from "./model";

export type { NeedTarget, Snapshot };

/** map.open の結果。pane は、ターミナルのペインまでフォーカスできたとき true。 */
export interface OpenResult {
  opened: true;
  pane: boolean;
}

declare module "orca" {
  interface PluginRequests {
    /** Orca の inbox / worker-list / worktree ps を読み、描く形にして返す。 */
    "map.snapshot": { output: Snapshot };
    /** 行やノードの開く先を Orca で表示する（workspace.open、ターミナルなら terminal.focus）。 */
    "map.open": { input: NeedTarget; output: OpenResult };
  }
}
