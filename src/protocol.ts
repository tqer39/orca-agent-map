// パネル <-> worker の取り決め。panel/main.ts と src/worker.ts の両方が読む。
import type { Snapshot } from "./model";

export type { Snapshot };

declare module "orca" {
  interface PluginRequests {
    /** Orca の inbox / worker-list / worktree ps を読み、描く形にして返す。 */
    "map.snapshot": { output: Snapshot };
  }
}
