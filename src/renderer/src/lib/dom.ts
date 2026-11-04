/**
 * 焦点是不是落在一个「会吃键盘输入」的元素上。
 *
 * 全局快捷键（尤其是 Ctrl+Z、方向键、空格）必须先问这一句：
 * 在输入框里，撤销该撤的是用户刚打的字，不是应用层的状态。
 */
export function isTypingTarget(el: Element | null | undefined): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return (el as HTMLElement).isContentEditable === true
}
