/**
 * Home's small "Best setups" box: how many A and B setups each time frame has right now and the best three,
 * with a button to the Setups page where the full list, evidence and trade guides live.
 */
import { engineRequest } from '../data/schwab';
import { formatPrice, h, timeAgo } from '../ui/dom';
import { icon } from '../ui/icons';
import type { Setup } from './setupsPanel';

type Horizon = 'short' | 'swing' | 'position';
const LABEL: Record<Horizon, string> = { short: 'Short swing', swing: 'Swing', position: 'Position' };
const REFRESH_MS = 60_000;

export function createSetupsTeaser() {
  const body = h('div', { class: 'teaser-body' }, h('div', { class: 'skeleton', style: 'height:80px' }));
  const el = h(
    'section',
    { class: 'panel setups-teaser' },
    h('div', { class: 'panel-head' }, h('h3', {}, icon('target', 20), ' Best setups'), h('span', { class: 'spacer' }), h('a', { class: 'btn small', href: '#setups' }, 'Open Setups →')),
    body,
  );

  async function load() {
    try {
      const r = await engineRequest<{ updated: number; horizons?: Partial<Record<Horizon, { setups: Setup[] }>>; setups: Setup[] }>('scanner.results', {}, 600_000);
      const hz = r.horizons ?? { swing: { setups: r.setups } };
      const good = (Object.keys(LABEL) as Horizon[]).flatMap((k) => (hz[k]?.setups ?? []).filter((s) => (s.tier === 'A' || s.tier === 'B') && s.status !== 'forming').map((s) => ({ ...s, horizon: k })));
      const rank = { A: 0, B: 1, C: 2 } as const;
      good.sort((a, b) => rank[a.tier ?? 'C'] - rank[b.tier ?? 'C'] || b.score - a.score);
      body.replaceChildren(
        h('div', { class: 'teaser-counts small' }, ...(Object.keys(LABEL) as Horizon[]).map((k) => {
          const n = good.filter((s) => s.horizon === k).length;
          return h('span', {}, h('b', {}, String(n)), ` ${LABEL[k]}`);
        }), h('span', { class: 'muted' }, `A/B setups · scanned ${timeAgo(r.updated)}`)),
        good.length
          ? h('ul', { class: 'teaser-list' }, ...good.slice(0, 3).map((s) => h('li', {}, h('a', { href: '#setups' },
              h('b', {}, s.symbol), ' ', h('span', { class: s.direction > 0 ? 'up' : 'down' }, s.direction > 0 ? 'BUY' : 'SELL'), ' ', h('i', { class: `tier tier-${s.tier}` }, `${s.tier}`),
              h('span', { class: 'muted small' }, ` ${LABEL[s.horizon as Horizon]} · ${s.direction > 0 ? 'above' : 'below'} $${formatPrice(s.plan.trigger)} · stop $${formatPrice(s.plan.stop)}`)))))
          : h('p', { class: 'muted small' }, 'No A or B setups right now on any time frame. The Setups page shows the closest candidates and why they fall short.'),
      );
    } catch (err) {
      body.replaceChildren(h('p', { class: 'muted small' }, (err as Error).message));
    }
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    el,
    start() {
      load();
      timer ??= setInterval(() => !el.closest('[hidden]') && load(), REFRESH_MS);
    },
  };
}
