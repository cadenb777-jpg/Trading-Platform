/**
 * Touch screens (the owner's HP laptop): marks <html class="touch-input"> while the last pointer was a finger or pen,
 * and removes it at the next mouse or trackpad move, so style.css can switch off hover looks and fades that a tap would
 * otherwise leave on (and that made things blink). Listeners are passive and capture-phase: they never block a tap.
 */
export function initTouchMode(root: HTMLElement = document.documentElement) {
  const set = (on: boolean) => {
    if (root.classList.contains('touch-input') !== on) root.classList.toggle('touch-input', on);
  };
  window.addEventListener('pointerdown', (e: PointerEvent) => set(e.pointerType === 'touch' || e.pointerType === 'pen'), { capture: true, passive: true });
  window.addEventListener('pointermove', (e: PointerEvent) => e.pointerType === 'mouse' && set(false), { capture: true, passive: true });
}
