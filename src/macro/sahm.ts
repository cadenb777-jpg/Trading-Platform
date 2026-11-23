/**
 * Recession check (Macro → Today's read): the Sahm rule, real time. Pure and tested (sahm.test.ts); drawn in
 * sahmView.ts from two FRED series the helper already serves raw (macro.series): SAHMREALTIME (the published real-time
 * reading, so nothing is re-computed or revised here) and USREC (NBER recession months).
 *
 * The rule: the 3-month average unemployment rate 0.50 points or more above its low of the previous 12 months
 * (Sahm, "Direct Stimulus Payments to Individuals", Brookings Hamilton Project, 2019). It is built to say a recession
 * has probably begun, not to forecast one: its record below is measured against NBER's start dates, which NBER announces
 * months later, so "no recession" means none declared so far.
 */

export interface MonthPoint {
  /** YYYY-MM-DD, first of the month */
  time: string;
  value: number;
}

/** One start date for every full-history request of NBER dates (helper 105), so the Macro panels share one saved copy. */
export const HISTORY_SINCE = '1948-01-01';

/** Points at which the rule fires. */
export const TRIGGER = 0.5;
/** Points at which it is worth watching (a common desk threshold, shown as a mark only). */
export const WATCH = 0.3;
/** A new signal needs this many months below the trigger before it, so one episode counts once (six keeps the
 * Aug 1981 recession's own signal, Nov 1981, apart from 1980's: twelve would have hidden it). */
export const QUIET_MONTHS = 6;
/** A signal within this many months of a recession's first month is matched to it. */
export const MATCH_MONTHS = 6;

export interface Signal {
  /** first month at or above the trigger */
  date: string;
  value: number;
  /** NBER recession start matched to it, or null when none started within MATCH_MONTHS */
  recessionStart: string | null;
  /** signal month - start month (positive = after the recession had begun) */
  monthsFromStart: number | null;
}

const monthIndex = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;

/** First months of NBER recessions (a 1 after a 0). */
export function recessionStarts(usrec: MonthPoint[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < usrec.length; i++) if (usrec[i].value === 1 && usrec[i - 1].value === 0) out.push(usrec[i].time);
  return out;
}

/** Each time a series reached `trigger` after `quiet` months below it, matched to the nearest NBER recession start
 * within MATCH_MONTHS (shared by the Sahm rule and the recession probability). */
export function crossings(series: MonthPoint[], usrec: MonthPoint[], trigger: number, quiet: number = QUIET_MONTHS): Signal[] {
  const starts = recessionStarts(usrec);
  const out: Signal[] = [];
  let below = 0;
  for (const p of series) {
    if (p.value >= trigger) {
      if (below >= quiet) {
        let best: string | null = null;
        let gap: number | null = null;
        for (const s of starts) {
          const d = monthIndex(p.time) - monthIndex(s);
          if (Math.abs(d) <= MATCH_MONTHS && (gap == null || Math.abs(d) < Math.abs(gap))) {
            best = s;
            gap = d;
          }
        }
        out.push({ date: p.time, value: p.value, recessionStart: best, monthsFromStart: gap });
      }
      below = 0;
    } else below++;
  }
  return out;
}

/** Each time the Sahm reading reached the trigger after QUIET_MONTHS months below it. */
export const sahmSignals = (sahm: MonthPoint[], usrec: MonthPoint[]): Signal[] => crossings(sahm, usrec, TRIGGER);

export type SahmState = 'triggered' | 'watch' | 'calm';
export const sahmState = (v: number): SahmState => (v >= TRIGGER ? 'triggered' : v >= WATCH ? 'watch' : 'calm');

export const month = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const pts = (v: number) => v.toFixed(2);
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
/** 'eight', '14'; Cap for the start of a sentence. */
const word = (n: number) => WORDS[n] ?? String(n);
const Word = (n: number) => word(n).charAt(0).toUpperCase() + word(n).slice(1);
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${word(n)} times`);

/** Today's reading in words. */
export function nowWords(latest: MonthPoint): string {
  // to the shown 2 decimals, so a tiny negative reading is "0.00 above", never "0.00 below ... still falling"
  const v = Math.round(latest.value * 100) / 100 || 0;
  const s = sahmState(v);
  // below zero: unemployment is still falling to new lows (the 3-month average is under last year's lowest)
  const base =
    v < 0
      ? `In ${month(latest.time)} the 3-month average unemployment rate was ${pts(-v)} points below its low of the year before: unemployment was still falling.`
      : `In ${month(latest.time)} the 3-month average unemployment rate was ${pts(v)} points above its low of the year before.`;
  if (s === 'triggered') return `${base} That is at or past the ${pts(TRIGGER)} line the rule uses: by its record, a recession has probably begun.`;
  if (s === 'watch') return `${base} That is ${pts(TRIGGER - v)} points short of the ${pts(TRIGGER)} line: worth watching.`;
  return `${base} That is ${pts(TRIGGER - v)} points short of the ${pts(TRIGGER)} line: no sign of a recession from jobs.`;
}

/** Recessions that began after the series did, and those no signal was matched to. */
export function missedRecessions(sahm: MonthPoint[], usrec: MonthPoint[], signals: Signal[]): { testable: string[]; missed: string[] } {
  if (!sahm.length) return { testable: [], missed: [] };
  const from = sahm[0].time;
  const testable = recessionStarts(usrec).filter((s) => s >= from);
  const matched = new Set(signals.map((s) => s.recessionStart));
  return { testable, missed: testable.filter((s) => !matched.has(s)) };
}

/** The record since the series began, counted honestly (misses and false alarms included). */
export function recordWords(signals: Signal[], since: string, usrecThrough: string | null, record?: { testable: string[]; missed: string[] }): string {
  if (!signals.length) return `It hasn’t reached ${pts(TRIGGER)} since ${since.slice(0, 4)}.`;
  const hits = signals.filter((s) => s.recessionStart);
  const misses = signals.filter((s) => !s.recessionStart);
  const after = hits.filter((s) => (s.monthsFromStart ?? 0) > 0).length;
  const far = Math.max(0, ...hits.map((s) => Math.abs(s.monthsFromStart ?? 0)));
  let t = `Since ${since.slice(0, 4)} it has reached ${pts(TRIGGER)} ${times(signals.length)}.`;
  if (hits.length) t += ` ${Word(hits.length)} came within ${far} month${far === 1 ? '' : 's'} of a recession’s start${after > hits.length / 2 ? ', mostly just after it had begun: it confirms a recession more than it forecasts one' : ''}.`;
  if (record?.testable.length) {
    const first = record.testable[0].slice(0, 4);
    t += record.missed.length
      ? ` It missed ${record.missed.length === 1 ? 'the recession' : `${word(record.missed.length)} recessions`} starting ${record.missed.map(month).join(', ')}.`
      : record.testable.length === 1 ? ` It flagged the one recession since ${first}.` : record.testable.length === 2 ? ` It flagged both recessions since ${first}.` : ` It flagged all ${word(record.testable.length)} recessions since ${first}.`;
  }
  if (misses.length) t += ` ${Word(misses.length)} (${misses.map((s) => month(s.date)).join(', ')}) ${misses.length === 1 ? 'was' : 'were'} not followed by a recession NBER has declared${usrecThrough ? ` (its dates run to ${month(usrecThrough)})` : ''}.`;
  return t;
}
