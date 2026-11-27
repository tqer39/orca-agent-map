// パネルの DOM 側。worker に数秒おきにスナップショットを頼み、見えていない間は止める。
import type { Snapshot } from "../src/protocol";
import { createPoller } from "./poller";
import { ticketHandler } from "./tickets";
import { renderErrors, renderGraph, renderLists } from "./view";

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const graphEl = $("graph");
const listsEl = $("lists");
const errorsEl = $("errors");
const liveEl = $("live");
const needsEl = $("needs");
const demoEl = $("demo");
const maskEl = $("mask") as HTMLButtonElement;

let snapshot: Snapshot | null = null;
/** 最後にエラー無しで取れた時刻。失敗中の表示に「いつの状態か」を出す。 */
let lastOkAt: number | null = null;
let masked = false;
let refreshMs = 5000;
/** Need You の行を開けなかったときの理由。次に開けるまで表示する。 */
let openError: string | null = null;

function errorText(error: unknown): string {
  const e = error as { code?: string; message?: string };
  return `${e.code ?? "error"}: ${e.message ?? ""}`;
}

function render(): void {
  maskEl.setAttribute("aria-pressed", String(masked));
  if (!snapshot) return;
  const live = snapshot.inFlight.length;
  liveEl.textContent = `${live} live`;
  liveEl.classList.toggle("on", live > 0);
  const needs = snapshot.needsYou.length;
  needsEl.textContent = `! ${needs} needs you`;
  needsEl.hidden = needs === 0;
  demoEl.hidden = !snapshot.demo;
  // 描き直すとバッジも作り直されるので、キーボードで選んでいたバッジにフォーカスを戻す。
  const ticket = document.activeElement?.getAttribute("data-ticket");
  graphEl.innerHTML = snapshot.nodes.length
    ? renderGraph(snapshot, Math.max(240, graphEl.clientWidth), masked)
    : '<p class="empty">ボットもやりとりもまだありません</p>';
  // 描き直すと行が作り直されるので、キーボードで選んでいた行にフォーカスを戻す。
  const focused = (document.activeElement as HTMLElement | null)?.dataset?.need;
  listsEl.innerHTML = renderLists(snapshot, masked);
  if (focused)
    listsEl.querySelectorAll<HTMLElement>("[data-need]").forEach((row) => {
      if (row.dataset.need === focused) row.focus();
    });
  if (ticket)
    document
      .querySelectorAll<HTMLElement | SVGElement>("[data-ticket]")
      .forEach((el) => {
        if (el.getAttribute("data-ticket") === ticket) el.focus();
      });
  const errors = openError ? [...snapshot.errors, openError] : snapshot.errors;
  errorsEl.innerHTML = renderErrors(errors, lastOkAt, Date.now());
}

async function openNeed(id: string): Promise<void> {
  const target = snapshot?.needsYou.find((n) => n.id === id)?.target;
  if (!target) return;
  try {
    await orca.plugin.request("map.open", target);
    openError = null;
  } catch (error) {
    openError = `Orca で開けませんでした（${errorText(error)}）`;
  }
  render();
}

function needOf(event: Event): string | undefined {
  return (event.target as Element | null)?.closest<HTMLElement>("[data-need]")
    ?.dataset.need;
}

// チケットのバッジ。行やノードを押す操作より先に受けるよう、capture で登録する。
const shell = orca.shell;
const onTicket = ticketHandler({
  openExternal: shell && ((url) => shell.openExternal(url)),
  report: (text) => {
    openError = text;
    render();
  },
});
document.addEventListener("click", onTicket, true);
document.addEventListener("keydown", onTicket, true);

listsEl.addEventListener("click", (event) => {
  const id = needOf(event);
  if (id) void openNeed(id);
});

listsEl.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const id = needOf(event);
  if (!id) return;
  event.preventDefault();
  void openNeed(id);
});

async function load(): Promise<void> {
  try {
    snapshot = await orca.plugin.request("map.snapshot");
    if (!snapshot.errors.length) lastOkAt = snapshot.at;
  } catch (error) {
    // worker ごと答えられないときも、最後に描いた状態は残す。
    const errors = [errorText(error)];
    if (snapshot) snapshot = { ...snapshot, errors };
    else {
      graphEl.innerHTML =
        '<p class="empty">Orca の情報を読めませんでした。次の更新で読み直します。</p>';
      errorsEl.innerHTML = renderErrors(errors, null, Date.now());
    }
  }
  render();
}

// 要求は 1 つずつ送り、古い応答で新しい表示を上書きしない。
const refresh = createPoller({
  tick: load,
  hidden: () => document.hidden,
  intervalMs: () => refreshMs,
});

async function loadSettings(): Promise<void> {
  const settings = await orca.settings.get();
  masked = settings.masked === true;
  const seconds =
    typeof settings.refreshSeconds === "number" ? settings.refreshSeconds : 5;
  refreshMs = Math.max(2, seconds) * 1000;
}

maskEl.addEventListener("click", () => {
  masked = !masked;
  render();
  void orca.settings.set("masked", masked);
});

orca.settings.onDidChange(() => {
  void loadSettings().then(refresh);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void refresh();
});

new ResizeObserver(() => render()).observe(graphEl);

void loadSettings().then(refresh);
