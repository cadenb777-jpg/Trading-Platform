/**
 * Green/red for a live change that doesn't flicker (owner: no blinking). A price sitting near unchanged moves a cent up
 * and down every few seconds; colouring each tick flipped green-red-green. Here:
 *   - under BAND (0.01%) either way is flat (no colour);
 *   - a colour holds until the change clearly crosses to the other side (past BAND the other way);
 *   - it fades to flat only when the change is back inside half the band.
 * `percent` is in percent units (0.25 = 0.25%). Pure, tested.
 */
export const BAND = 0.01;
export type Tone = 'up' | 'down' | '';

export function steadyTone(percent: number | null | undefined, prev: Tone = ''): Tone {
  if (percent == null || !Number.isFinite(percent)) return '';
  if (percent >= BAND) return 'up';
  if (percent <= -BAND) return 'down';
  return Math.abs(percent) >= BAND / 2 ? prev : '';
}

/** The tone an element shows now ('up', 'down' or ''), read from its classes. */
export const toneOfEl = (el: Element): Tone => (el.classList.contains('up') ? 'up' : el.classList.contains('down') ? 'down' : '');

/** Sets an element's up/down class from a live change, changing classes only when the tone really changes. */
export function paintTone(el: Element, percent: number | null | undefined) {
  const before = toneOfEl(el);
  const next = steadyTone(percent, before);
  if (next === before) return;
  el.classList.toggle('up', next === 'up');
  el.classList.toggle('down', next === 'down');
}
