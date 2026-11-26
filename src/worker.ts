/// <reference types="node" />
// プラグインの worker。Orca の plugin API には orchestration の inbox や worker 一覧を読む
// メソッドが無いので、Node から orca CLI を呼んで JSON を読む。
import { execFile } from "node:child_process";
import type { OrcaWorkerApi } from "orca/worker";
import { demoSources } from "./demo";
import {
  buildSnapshot,
  type RawItem,
  type RawSources,
  type Snapshot,
} from "./model";
import "./protocol";

export type RunCli = (args: string[]) => Promise<unknown>;

const MAC_ORCA = "/Applications/Orca.app/Contents/Resources/bin/orca";
const CLI_TIMEOUT_MS = 10_000;
/** 複数のパネルが同時に開いていても CLI を呼ぶのは一度だけにする。 */
const CACHE_MS = 1_500;

function execJson(file: string, args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...args, "--json"],
      { timeout: CLI_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => {
        // 失敗しても --json は stdout にエラーの JSON を出すので、まずそれを読む。
        try {
          const parsed = JSON.parse(stdout) as {
            ok?: boolean;
            result?: unknown;
            error?: { message?: string };
          };
          if (parsed.ok) return resolve(parsed.result);
          return reject(
            new Error(parsed.error?.message ?? `orca ${args.join(" ")} failed`),
          );
        } catch {
          reject(
            error ?? new Error(`orca ${args.join(" ")}: unreadable output`),
          );
        }
      },
    );
  });
}

export function cliRunner(configuredPath: string): RunCli {
  let file = configuredPath || "orca";
  return async (args) => {
    // 並列の呼び出しが途中で file を替えても、失敗した呼び出しが使った実行ファイルで判断する。
    const used = file;
    try {
      return await execJson(used, args);
    } catch (error) {
      // Finder から起動した Orca の PATH には orca が無いことがある。
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
      if (
        !missing ||
        configuredPath ||
        process.platform !== "darwin" ||
        used === MAC_ORCA
      )
        throw error;
      file = MAC_ORCA;
      return execJson(MAC_ORCA, args);
    }
  };
}

function list<T>(value: unknown, key: string): T[] {
  const items = (value as Record<string, unknown> | null)?.[key];
  return Array.isArray(items) ? (items as T[]) : [];
}

const BOTS_TTL_MS = 15_000;

interface BotsAndItems {
  bots: string[];
  items: RawItem[];
}

/**
 * ボットの一覧と、ボットごとの Needs you の Item を読む。ボットの数だけ CLI を呼ぶので、
 * 結果は BOTS_TTL_MS のあいだ使い回す。
 */
export function botsReader(
  run: RunCli,
): (now: number) => Promise<BotsAndItems> {
  let cached: { at: number; value: Promise<BotsAndItems> } | null = null;
  const read = async (): Promise<BotsAndItems> => {
    const listed = list<{ name?: string }>(await run(["bot", "list"]), "bots");
    const bots = listed
      .map((b) => b.name)
      .filter((name): name is string => Boolean(name));
    const lists = await Promise.all(
      bots.map(async (bot) => {
        const out = await run([
          "bot",
          "item",
          "list",
          "--bot",
          bot,
          "--status",
          "needs-you",
        ]);
        return list<Omit<RawItem, "bot">>(out, "items").map((item) => ({
          ...item,
          bot,
        }));
      }),
    );
    return { bots, items: lists.flat() };
  };
  return (now) => {
    if (!cached || now - cached.at >= BOTS_TTL_MS)
      cached = { at: now, value: read() };
    return cached.value;
  };
}

type Source = "messages" | "workers" | "worktrees" | "bots";

/**
 * CLI を並列に呼んでスナップショットを作る関数を返す。失敗したデータの元は最後に取れた値を使い、
 * 失敗を errors に載せる（パネルは「更新できませんでした」と出す）。
 */
export function createLoader(run: RunCli): (now: number) => Promise<Snapshot> {
  const readBots = botsReader(run);
  const last: Partial<RawSources> = {};
  const sources: [Source, string, () => Promise<unknown>][] = [
    [
      "messages",
      "orca orchestration inbox",
      () => run(["orchestration", "inbox", "--full", "--limit", "100"]),
    ],
    [
      "workers",
      "orca orchestration worker-list",
      () => run(["orchestration", "worker-list"]),
    ],
    ["worktrees", "orca worktree ps", () => run(["worktree", "ps"])],
    ["bots", "orca bot", () => readBots(Date.now())],
  ];
  return async (now) => {
    const results = await Promise.allSettled(
      sources.map(([, , load]) => load()),
    );
    const errors: string[] = [];
    results.forEach((r, i) => {
      const [key, label] = sources[i];
      if (r.status === "rejected") {
        errors.push(`${label}: ${(r.reason as Error).message}`);
        return;
      }
      if (key === "bots") Object.assign(last, r.value as BotsAndItems);
      else last[key] = list(r.value, key) as never;
    });
    const raw: RawSources = {
      messages: last.messages ?? [],
      workers: last.workers ?? [],
      worktrees: last.worktrees ?? [],
      bots: last.bots ?? [],
      items: last.items ?? [],
    };
    return { ...buildSnapshot(raw, now), errors };
  };
}

export default function activate(orca: OrcaWorkerApi): void {
  let cached: { at: number; snapshot: Promise<Snapshot> } | null = null;
  let loader: {
    path: string;
    load: (now: number) => Promise<Snapshot>;
  } | null = null;

  orca.panels.handle("map.snapshot", async () => {
    const now = Date.now();
    if (cached && now - cached.at < CACHE_MS) return cached.snapshot;
    const settings = await orca.settings.get();
    const path = typeof settings.orcaPath === "string" ? settings.orcaPath : "";
    if (loader?.path !== path)
      loader = { path, load: createLoader(cliRunner(path)) };
    const snapshot =
      settings.demo === true
        ? Promise.resolve({
            ...buildSnapshot(demoSources(now), now),
            demo: true,
          })
        : loader.load(now);
    cached = { at: now, snapshot };
    return snapshot;
  });
}
