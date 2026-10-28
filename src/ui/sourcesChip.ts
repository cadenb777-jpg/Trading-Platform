/**
 * The "Sources" chip: put it next to a value (a price, a fund's NAV, a yield). It asks the helper's crosscheck.value
 * for the same value from several free sources and opens a small panel listing every source's value, time and link,
 * the best estimate (median of the sources that agree) and a confidence meter. Nothing is picked silently: every
 * source is listed, including the ones that had no value and why.
 *
 * `auto` checks straight away (for a page the owner opened on purpose, like a fund); otherwise the check runs on the
 * first click, so hovering over tickers never sends requests to other websites.
 */
import { CROSSCHECK_HELPER_VERSION, engineRequest, helper } from '../data/schwab';
import { ageText, chipText, confidenceLabel, formatCheckValue, meterPercent, meterText, rubricTitle, statusWords, type CheckField, type CrossCheck } from './confidence';
import { h } from './dom';
import { infoTip } from './glossary';

export interface CheckRequest {
  field: CheckField;
  symbol?: string | null;
  cik?: number | null;
}

/** True when the connected helper can cross-check (older helpers: the chip is left out). */
export const canCrossCheck = () => helper.isConnected && (helper.version ?? 0) >= CROSSCHECK_HELPER_VERSION;

let seq = 0;

export function checkValue(req: CheckRequest): Promise<CrossCheck> {
  const params: Record<string, unknown> = { field: req.field };
  if (req.symbol) params.symbol = req.symbol;
  if (req.cik) params.cik = req.cik;
  return engineRequest<CrossCheck>('crosscheck.value', params, 45000);
}

/** The name of the source the best estimate comes from. */
export const bestSourceName = (c: CrossCheck) => c.sources.find((s) => s.source === c.bestSource)?.name ?? 'the sources';

/** The meter: a bar and "65% confident (Medium)", with the scoring rubric on hover. */
export function confidenceMeter(c: CrossCheck) {
  const pct = meterPercent(c.score);
  const level = confidenceLabel(c.score, c.best != null);
  return h(
    'div',
    { class: `xc-meter-row xc-${c.tone}`, title: rubricTitle(c.rubric) },
    h(
      'div',
      { class: 'xc-meter', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, 'aria-valuetext': `${meterText(c.score)} (${level})`, 'aria-label': 'Confidence' },
      h('span', { class: 'xc-meter-fill', style: `width:${pct}%` }),
    ),
    h('span', { class: 'xc-meter-text' }, h('b', {}, meterText(c.score)), ` · ${level}`),
    infoTip('confidence'),
  );
}

/** The panel body: best estimate, meter, plain-words status and every source. */
export function crossCheckPanel(c: CrossCheck) {
  const rows = c.sources.map((s) =>
    h(
      'li',
      { class: `xc-src${s.value == null ? ' xc-missing' : s.compared === false ? ' xc-other' : s.agrees === false ? ' xc-off' : ''}` },
      h('span', { class: 'xc-src-name' }, s.name, h('span', { class: 'muted tiny' }, ` ${s.kind}`)),
      h('span', { class: 'xc-src-val' }, s.value == null ? h('span', { class: 'muted' }, s.error ? `no value: ${s.error}` : 'no value') : formatCheckValue(s.value, c.unit)),
      h(
        'span',
        { class: 'xc-src-meta muted small' },
        s.value != null ? ageText(s.asOf) : '',
        s.basisLabel ? ` · ${s.basisLabel}` : '',
        s.note ? ` · ${s.note}` : '',
        s.compared === false ? h('span', { class: 'xc-badge-other' }, ' · different definition, not compared') : s.agrees === false ? h('span', { class: 'xc-badge' }, ' differs') : '',
        s.url ? h('a', { href: s.url, target: '_blank', rel: 'noopener', class: 'xc-link', 'aria-label': `Open ${s.name}` }, ' ↗') : '',
      ),
    ),
  );
  return h(
    'div',
    { class: 'xc-body' },
    h(
      'div',
      { class: 'xc-best' },
      h('span', { class: 'muted small' }, `${c.label}${c.basisLabel ? ` (${c.basisLabel})` : ''}, best estimate`),
      h('span', {}, h('b', { class: 'xc-best-val' }, c.best == null ? 'not available' : formatCheckValue(c.best, c.unit)), c.best == null ? '' : h('span', { class: 'muted tiny' }, ` from ${bestSourceName(c)}`)),
    ),
    confidenceMeter(c),
    h('p', { class: `xc-status xc-${c.tone}`, role: c.tone === 'ok' ? undefined : 'status' }, h('b', {}, `${statusWords(c.status)}. `), c.message),
    h('ul', { class: 'xc-list', 'aria-label': 'Values found, by source' }, ...rows),
    h('p', { class: 'muted tiny' }, 'Best estimate = the value from the most trusted source that agrees with the others (never an average). Free public sources only; values can lag.'),
  );
}

/**
 * A chip that opens the sources panel below it (a disclosure: button + region). `onResult` gets the check (for
 * example to fill a spot that showed "unavailable" with the best estimate, labelled with its sources).
 */
export function sourcesChip(req: CheckRequest, opts: { auto?: boolean; onResult?: (c: CrossCheck) => void } = {}) {
  const id = `xc-panel-${++seq}`;
  const panel = h('div', { id, class: 'xc-panel', hidden: true, role: 'region', 'aria-label': 'Sources for this value' });
  const chip = h('button', { type: 'button', class: 'xc-chip', 'aria-expanded': 'false', 'aria-controls': id, title: 'Compare this value across free sources' }, chipText(null));
  const wrap = h('span', { class: 'xc-wrap' }, chip, panel);
  let check: Promise<CrossCheck> | null = null;
  let result: CrossCheck | null = null;
  const run = () => {
    if (!check) {
      chip.classList.add('loading');
      check = checkValue(req).then(
        (c) => {
          result = c;
          chip.textContent = chipText(c);
          chip.className = `xc-chip xc-${c.best == null ? 'red' : c.tone}`;
          chip.setAttribute('aria-label', `Sources: ${c.best == null ? 'no value found' : `${meterText(c.score)}, ${statusWords(c.status).toLowerCase()}`}`);
          panel.replaceChildren(crossCheckPanel(c));
          opts.onResult?.(c);
          grew();
          return c;
        },
        (err) => {
          chip.classList.remove('loading');
          chip.textContent = 'Sources · error';
          panel.replaceChildren(h('p', { class: 'muted small' }, `Couldn't check other sources: ${(err as Error).message}`));
          check = null; // a later click tries again
          throw err;
        },
      );
    }
    return check;
  };
  /** Tells a container (the ticker card) that the chip grew, so it can stay on screen. */
  const grew = () => wrap.dispatchEvent(new CustomEvent('xc:resize', { bubbles: true }));
  const toggle = (open: boolean) => {
    panel.hidden = !open;
    queueMicrotask(grew);
    chip.setAttribute('aria-expanded', String(open));
    if (open && !result) {
      panel.replaceChildren(h('p', { class: 'muted small' }, 'Checking other free sources…'));
      run().catch(() => {});
    }
  };
  chip.addEventListener('click', (e) => (e.stopPropagation(), toggle(panel.hidden !== false)));
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) (e.stopPropagation(), toggle(false), chip.focus());
  });
  if (opts.auto) run().catch(() => {});
  return wrap;
}
