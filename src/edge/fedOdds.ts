/**
 * Macro → Fed rate odds: the market's odds of a cut, hold or hike at each FOMC meeting, from 30-day fed funds futures
 * (helper engine/rates.py, CME FedWatch method). Each meeting: a cut / hold / hike bar, the most likely target range
 * and the rate the futures expect after it.
 */
import { h } from '../ui/dom';
import { edgePanel, sourceLine } from './panel';

export interface FedMeeting {
  date: string;
  before: number;
  after: number;
  steps: number;
  ranges: { lower: number; upper: number; p: number }[];
  pCut: number;
  pHold: number;
  pHike: number;
  expectedChange: number;
  tentative: boolean;
}
export interface FedOdds {
  effr: number;
  effrDate: string;
  target: [number, number];
  futures: { symbol: string; month: string; price: number; rate: number }[];
  meetings: FedMeeting[];
  asOf: string;
  method: string;
}

const p0 = (v: number) => `${Math.round(v * 100)}%`;
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** The most likely target range and a plain sentence for one meeting (pure, tested). */
export function meetingRead(m: FedMeeting): { range: string; sentence: string } {
  const top = [...m.ranges].sort((a, b) => b.p - a.p)[0];
  const range = top ? `${top.lower.toFixed(2)}–${top.upper.toFixed(2)}%` : '—';
  const bps = Math.round(m.expectedChange * 100);
  const sentence = Math.abs(bps) < 3 ? 'No change priced in by then.' : `${Math.abs(bps)} bp of ${bps < 0 ? 'cuts' : 'hikes'} priced in by then (from today).`;
  return { range, sentence };
}

function bar(m: FedMeeting) {
  const seg = (cls: string, p: number, label: string) => (p > 0.005 ? h('i', { class: cls, style: `width:${(p * 100).toFixed(1)}%`, title: `${label} ${p0(p)}` }, p >= 0.12 ? p0(p) : '') : '');
  return h('div', { class: 'fed-bar', role: 'img', 'aria-label': `Cut ${p0(m.pCut)}, hold ${p0(m.pHold)}, hike ${p0(m.pHike)}` }, seg('cut', m.pCut, 'Lower than today'), seg('hold', m.pHold, 'Same as today'), seg('hike', m.pHike, 'Higher than today'));
}

export function fedOddsPanel(): HTMLElement {
  return edgePanel<FedOdds>({
    title: 'Fed rate odds',
    term: 'fedOdds',
    sub: 'What the futures market expects at each meeting',
    request: 'macro.fedodds',
    render(d, body) {
      body.append(
        h('p', { class: 'small' }, `Target range now ${d.target[0].toFixed(2)}–${d.target[1].toFixed(2)}% · effective rate ${d.effr.toFixed(2)}% (${day(d.effrDate)})`),
        h(
          'div',
          { class: 'fed-rows', role: 'table', 'aria-label': 'Rate odds by meeting' },
          h('div', { class: 'fed-row fed-headrow', role: 'row' }, h('span', { role: 'columnheader' }, 'Meeting'), h('span', { role: 'columnheader' }, 'Lower · same · higher than today'), h('span', { role: 'columnheader', class: 'num' }, 'Most likely'), h('span', { role: 'columnheader', class: 'num' }, 'Expected rate')),
          ...d.meetings.map((m) => {
            const read = meetingRead(m);
            return h(
              'div',
              { class: 'fed-row', role: 'row', title: read.sentence },
              h('span', { role: 'cell' }, day(m.date), m.tentative ? h('span', { class: 'muted small', title: 'The Fed’s tentative date' }, ' (tent.)') : ''),
              h('span', { role: 'cell' }, bar(m)),
              h('span', { role: 'cell', class: 'num' }, read.range),
              h('span', { role: 'cell', class: 'num' }, `${m.after.toFixed(2)}%`),
            );
          }),
        ),
        d.meetings.length ? '' : h('p', { class: 'muted small' }, 'Schwab didn’t price enough fed funds futures months to work out the meetings.'),
        sourceLine(`${d.method} Futures from Schwab (${d.futures.length} months), rates from FRED · ${new Date(d.asOf).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`),
      );
    },
  });
}
