// チケットのバッジの描画と、押したときの処理。DOM に触らないので Node でテストできる。
import type { Ticket } from "../src/model";
import { escapeHtml as esc } from "./html";

const MASK = "•••";

export interface TicketView {
  /** 伏せ字の表示。番号も出さず、押せなくする。 */
  masked: boolean;
  /** デモのデータは実在しない URL を指すので、押せなくする。 */
  demo: boolean;
}

interface Badge {
  text: string;
  /** 押せるバッジの属性。押せないバッジは空。 */
  attrs: string;
  open: boolean;
}

/**
 * `scope` は描き直した後にフォーカスを戻すための、バッジの置き場所（行やノード）の名前。
 * 並びが変わっても同じチケットに戻せるよう、data-ticket には順番ではなく URL を入れる。
 */
function badges(tickets: Ticket[], scope: string, view: TicketView): Badge[] {
  return tickets.map((t) => {
    const url = view.masked || view.demo ? undefined : t.url;
    return {
      text: view.masked ? MASK : t.label,
      open: url !== undefined,
      attrs:
        url !== undefined
          ? ` data-ticket="${esc(`${scope}#${url}`)}" data-ticket-url="${esc(url)}" data-provider="${esc(t.provider)}"`
          : "",
    };
  });
}

/** 一覧の行に出すバッジ。行のボタンの外（兄弟）に置けるよう、ひとまとまりの要素で返す。 */
export function renderTickets(
  tickets: Ticket[] | undefined,
  scope: string,
  view: TicketView,
): string {
  if (!tickets?.length) return "";
  const html = badges(tickets, scope, view)
    .map((b) =>
      b.open
        ? `<button type="button" class="ticket"${b.attrs} title="${esc(b.text)} をブラウザで開く">${esc(b.text)}</button>`
        : `<span class="ticket static">${esc(b.text)}</span>`,
    )
    .join("");
  return `<div class="tickets">${html}</div>`;
}

export const BADGE_H = 13;
const BADGE_GAP = 3;
const badgeWidth = (text: string) => Math.ceil(text.length * 5.4) + 8;

/**
 * 図のノードの下に出すバッジ（SVG）。幅 `maxWidth` に入る分だけ並べ、残りは「+N」にまとめる。
 * ノードの `<g>` の中には入れない（ノードを押す操作と分けるため）。
 */
export function renderNodeTickets(
  tickets: Ticket[] | undefined,
  scope: string,
  view: TicketView,
  x: number,
  y: number,
  maxWidth: number,
): string {
  if (!tickets?.length) return "";
  const all = badges(tickets, scope, view);
  const moreWidth = (n: number) => (n ? badgeWidth(`+${n}`) + BADGE_GAP : 0);
  let shown = 0;
  let used = 0;
  while (shown < all.length) {
    const w = badgeWidth(all[shown].text);
    if (used + w + moreWidth(all.length - shown - 1) > maxWidth) break;
    used += w + BADGE_GAP;
    shown++;
  }
  const rest = all.length - shown;
  const drawn: Badge[] = all.slice(0, shown);
  if (rest) drawn.push({ text: `+${rest}`, attrs: "", open: false });
  let dx = 0;
  return drawn
    .map((b) => {
      const w = badgeWidth(b.text);
      const at = x + dx;
      dx += w + BADGE_GAP;
      // SVG には button が無いので、押せるバッジは role と tabindex を付け、Enter / Space は ticketHandler が扱う。
      const open = b.open
        ? `${b.attrs} role="link" tabindex="0" aria-label="${esc(b.text)} をブラウザで開く"`
        : "";
      return (
        `<g class="ticket${b.open ? "" : " static"}"${open} transform="translate(${at},${y})">` +
        `<rect width="${w}" height="${BADGE_H}" rx="3"/>` +
        `<text x="${w / 2}" y="${BADGE_H - 3.5}" text-anchor="middle">${esc(b.text)}</text></g>`
      );
    })
    .join("");
}

/** ticketHandler が読むイベントの項目（DOM の MouseEvent / KeyboardEvent が満たす）。 */
export interface TicketEvent {
  type: string;
  key?: string;
  target: unknown;
  stopPropagation(): void;
  preventDefault(): void;
}

interface TicketElement {
  tagName: string;
  getAttribute(name: string): string | null;
}

export interface TicketDeps {
  /** `orca.shell.openExternal`。デスクトップ版でないと無い。 */
  openExternal?: (url: string) => Promise<{ opened: boolean; reason?: string }>;
  /** 開けなかった理由を出す。開けたら null で消す。 */
  report: (text: string | null) => void;
}

/**
 * 押せるバッジの click と keydown を扱う。行やノードを押す操作（Orca 内へ移動）に伝わらないよう、
 * capture で登録して stopPropagation する。openExternal は操作の直後でないと Orca が断るので、
 * 何も await せずに呼ぶ。
 */
export function ticketHandler(deps: TicketDeps): (event: TicketEvent) => void {
  return (event) => {
    const target = event.target as {
      closest?: (selector: string) => TicketElement | null;
    } | null;
    const el = target?.closest?.("[data-ticket-url]");
    const url = el?.getAttribute("data-ticket-url");
    if (!el || !url) return;
    if (event.type === "keydown") {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.stopPropagation();
      // button は Enter / Space で click が来るので、そちらで開く。
      if (el.tagName === "BUTTON") return;
      event.preventDefault();
    } else event.stopPropagation();
    if (!deps.openExternal) {
      deps.report("この Orca ではチケットをブラウザで開けません");
      return;
    }
    deps.openExternal(url).then(
      (r) =>
        deps.report(
          r.opened || r.reason === "cancelled"
            ? null
            : `チケットをブラウザで開けませんでした（${r.reason ?? "unknown"}）`,
        ),
      (error: unknown) =>
        deps.report(
          `チケットをブラウザで開けませんでした（${(error as Error)?.message ?? ""}）`,
        ),
    );
  };
}
