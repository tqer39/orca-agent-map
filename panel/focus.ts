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
 * フォーカスを戻す。data-go は行ごとに違う値（依頼の行は依頼の ID）なので、並びが変わっても
 * 同じ行に戻る。
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
  draw();
  if (!key) return;
  Array.from(container.querySelectorAll("[data-go]"))
    .find((el) => el.getAttribute("data-go") === key)
    ?.focus();
}
