// パネルの DOM 側。worker に数秒おきにスナップショットを頼み、見えていない間は止める。
import type { Snapshot } from "../src/protocol";
import { keepFocus } from "./focus";
import { errorText, goer } from "./go";
import { createPoller } from "./poller";
import { ticketHandler } from "./tickets";
import { actionFor, renderErrors, renderGraph, renderLists } from "./view";

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
/** 行やノードを開けなかったときの理由。次に開けるまで表示する。 */
let openError: string | null = null;
const shell = orca.shell;

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
  const s = snapshot;
  keepFocus(graphEl, document.activeElement as HTMLElement | null, () => {
    graphEl.innerHTML = s.nodes.length
      ? renderGraph(s, Math.max(240, graphEl.clientWidth), masked)
      : '<p class="empty">ボットもやりとりもまだありません</p>';
  });
  keepFocus(listsEl, document.activeElement as HTMLElement | null, () => {
    listsEl.innerHTML = renderLists(s, masked, Boolean(shell));
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

// チケットのバッジ。行やノードを押す操作より先に受けるよう、capture で登録する。
const onTicket = ticketHandler({
  openExternal: shell && ((url) => shell.openExternal(url)),
  report: (text) => {
    openError = text;
    render();
  },
});
document.addEventListener("click", onTicket, true);
document.addEventListener("keydown", onTicket, true);

const go = goer({
  open: (target) => orca.plugin.request("map.open", target),
  openExternal: shell && ((url) => shell.openExternal(url)),
  // userActivation の無い環境では、開けるかどうかは shell に任せる。
  active: () => globalThis.navigator?.userActivation?.isActive ?? true,
  report: (error) => {
    openError = error;
    render();
  },
});

/** 押された行やノードを開く。 */
function goTo(event: Event): boolean {
  const key = (event.target as Element | null)
    ?.closest?.("[data-go]")
    ?.getAttribute("data-go");
  const action = key && snapshot && actionFor(snapshot, key, Boolean(shell));
  if (action) void go(action);
  return Boolean(action);
}

document.addEventListener("click", (event) => {
  goTo(event);
});

// 行もノードも role="button" の要素なので、Enter / Space はここで扱う。
document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (goTo(event)) event.preventDefault();
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
