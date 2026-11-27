// ワークスペースに付けた参照（チケット・PR）を、パネルのバッジにする純粋関数。
// キーの推測（ブランチ名や PR タイトルからの抽出）はせず、Orca が持っている参照だけを出す。

export interface Ticket {
  /** Linear / Jira は identifier（ABC-123）、それ以外は `PR #12` / `MR !12` / `Issue #12`。 */
  label: string;
  /** ブラウザで開く先。無いバッジは押せない。 */
  url?: string;
  provider: string;
}

/** `orca worktree ps --json` の worktrees[].linkedItems[]（使う項目だけ）。 */
export interface RawLinkedItem {
  provider?: string;
  type?: string;
  number?: number | null;
  identifier?: string | null;
  title?: string | null;
  url?: string | null;
}

/** `orca worktree ps --json` の worktree のうち、参照を持つ項目。 */
export interface LinkedSlots {
  linkedItems?: RawLinkedItem[] | null;
  /** ブランチの PR。 */
  linkedPR?: { number?: number; title?: string; url?: string } | null;
  // 以下は linkedItems より前からある単一スロット。linkedItems に同じものが無いときだけ使う。
  linkedIssue?: number | null;
  linkedLinearIssue?: string | null;
  linkedGitLabMR?: number | null;
  linkedGitLabIssue?: number | null;
}

/** `orca bot item list --json` の items[].links[]（使う項目だけ）。 */
export interface RawItemLink {
  pr?: { number?: number; url?: string } | null;
}

const NUMBERED: Partial<Record<string, (n: number) => string>> = {
  pr: (n) => `PR #${n}`,
  mr: (n) => `MR !${n}`,
  issue: (n) => `Issue #${n}`,
};

/** 表示名は Orca 本体と同じにする。作れないもの（番号も identifier も無い）は null。 */
export function ticketLabel(item: RawLinkedItem): string | null {
  const numbered = typeof item.number === "number" && item.number > 0;
  if (item.provider === "linear" || item.provider === "jira")
    return item.identifier?.trim() || (numbered ? `#${item.number}` : null);
  const format = NUMBERED[item.type ?? ""];
  return format && numbered ? format(item.number as number) : null;
}

function toTicket(item: RawLinkedItem): Ticket | null {
  const label = ticketLabel(item);
  if (!label) return null;
  // ブラウザに渡すのは http(s) だけにする。
  const url = /^https?:\/\//i.test(item.url ?? "") ? item.url : undefined;
  return {
    label,
    provider: item.provider || "unknown",
    ...(url ? { url } : {}),
  };
}

/** 同じチケット（同じ URL、または同じ provider と表示名）は 1 つにまとめ、先に出たものを残す。 */
function merge(items: RawLinkedItem[]): Ticket[] {
  const tickets: Ticket[] = [];
  for (const item of items) {
    const t = toTicket(item);
    if (!t) continue;
    const known = tickets.find(
      (k) =>
        (k.url !== undefined && k.url === t.url) ||
        (k.provider === t.provider && k.label === t.label),
    );
    if (!known) tickets.push(t);
    else if (!known.url && t.url) known.url = t.url;
  }
  return tickets;
}

/** worktree に付けた参照と、ブランチの PR。 */
export function worktreeTickets(wt: LinkedSlots): Ticket[] {
  const items: RawLinkedItem[] = Array.isArray(wt.linkedItems)
    ? [...wt.linkedItems]
    : [];
  if (wt.linkedPR)
    items.push({ provider: "github", type: "pr", ...wt.linkedPR });
  items.push(
    { provider: "github", type: "issue", number: wt.linkedIssue },
    { provider: "linear", type: "issue", identifier: wt.linkedLinearIssue },
    { provider: "gitlab", type: "mr", number: wt.linkedGitLabMR },
    { provider: "gitlab", type: "issue", number: wt.linkedGitLabIssue },
  );
  return merge(items);
}

/** ボットの Item の links にある PR。 */
export function itemTickets(links: RawItemLink[] | null | undefined): Ticket[] {
  return merge(
    (Array.isArray(links) ? links : []).flatMap((l) =>
      l?.pr ? [{ provider: "github", type: "pr", ...l.pr }] : [],
    ),
  );
}
