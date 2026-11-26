// パネルの DOM 側。worker に数秒おきにスナップショットを頼み、見えていない間は止める。
import type { Snapshot } from "../src/protocol";
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
let timer: ReturnType<typeof setTimeout> | undefined;
/** 要求は 1 つずつ送る。古い応答で新しい表示を上書きせず、更新のループも 1 本に保つ。 */
let running = false;
let again = false;

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
  graphEl.innerHTML = snapshot.nodes.length
    ? renderGraph(snapshot, Math.max(240, graphEl.clientWidth))
    : '<p class="empty">ボットもやりとりもまだありません</p>';
  listsEl.innerHTML = renderLists(snapshot, masked);
  errorsEl.innerHTML = renderErrors(snapshot.errors, lastOkAt, Date.now());
}

async function refresh(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  clearTimeout(timer);
  if (document.hidden) return;
  running = true;
  try {
    snapshot = await orca.plugin.request("map.snapshot");
    if (!snapshot.errors.length) lastOkAt = snapshot.at;
  } catch (error) {
    // worker ごと答えられないときも、最後に描いた状態は残す。
    const e = error as { code?: string; message?: string };
    const errors = [`${e.code ?? "error"}: ${e.message ?? ""}`];
    if (snapshot) snapshot = { ...snapshot, errors };
    else {
      graphEl.innerHTML =
        '<p class="empty">Orca の情報を読めませんでした。次の更新で読み直します。</p>';
      errorsEl.innerHTML = renderErrors(errors, null, Date.now());
    }
  } finally {
    running = false;
  }
  render();
  if (again) {
    again = false;
    void refresh();
    return;
  }
  timer = setTimeout(refresh, refreshMs);
}

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
