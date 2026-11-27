// 描き直しの前後でフォーカスを保つ。DOM の型だけに頼り、テストでは小さな偽物で動かす。

interface Focusable {
  getAttribute(name: string): string | null;
  focus(): void;
}

interface Container {
  contains(el: unknown): boolean;
  querySelectorAll(selector: string): ArrayLike<Focusable>;
}

/**
 * 描き直すと要素が作り直されるので、キーボードで選んでいた行やノード（data-go）に、描いた後も
 * フォーカスを戻す。同じ開く先の行が複数あるときは、同じ順番のものに戻す。
 */
export function keepFocus(
  container: Container,
  active: Focusable | null,
  draw: () => void,
): void {
  const key =
    active && container.contains(active)
      ? active.getAttribute("data-go")
      : null;
  const sameKey = () =>
    Array.from(container.querySelectorAll("[data-go]")).filter(
      (el) => el.getAttribute("data-go") === key,
    );
  const index = key && active ? sameKey().indexOf(active) : -1;
  draw();
  if (!key) return;
  const next = sameKey();
  next[Math.min(Math.max(index, 0), next.length - 1)]?.focus();
}
