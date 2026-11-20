/**
 * Among US companies (Research overview, helper 88): where a company's readings sit among every company that files
 * with the SEC (total assets of $100 million or more, all industries), from the SEC's XBRL frames
 * (engine/filerrank.py, research.filerrank). Pure and tested (filerRank.test.ts, on Coca-Cola's FY2025 figures as the
 * frames gave them on 2026-11-18); drawn in filerRankView.ts.
 *
 * Percentile = share of the other companies below plus half the ties (the platform's one rule). The words say where the
 * company sits, never whether that is good: a high asset growth or high accruals have come before LOWER returns
 * (Cooper, Gulen and Schill 2008; Sloan 1996), so "higher" is not "better". Readings, not signals.
 */
import { pc, signedPoints } from './debtDilution';

export type MetricKey = 'grossProfitability' | 'operatingMargin' | 'returnOnAssets' | 'salesGrowth' | 'assetGrowth' | 'accruals' | 'inventoryVsSales' | 'shareIssuance' | 'rdIntensity';

export interface Ranked {
  value: number;
  /** 0-100: share of the other companies below, plus half the ties */
  percentile: number;
  /** companies it was ranked against */
  n: number;
  p25: number;
  median: number;
  p75: number;
}

export interface FilerRank {
  /** the calendar year of the SEC frames (a fiscal year that best fits it) */
  year: number;
  /** small = assets under minAssets; noAssets = no balance dated at its year-end (both ranked, neither in the field) */
  company: { end: string; accn: string; assets: number | null; small: boolean; noAssets?: boolean } | null;
  metrics: Partial<Record<MetricKey, Ranked | null>>;
  minAssets: number;
  /** the SEC frames its figures came from (helper 93; helper 88-89 sent bare URLs) */
  frames?: ({ label: string; url: string } | string)[];
}

export interface MetricInfo {
  key: MetricKey;
  label: string;
  /** glossary key for the "i" tip */
  term: string;
  format: (v: number) => string;
  /** what a high reading has meant in the research (said under the row, never as good or bad) */
  note: string;
}

/** Points for a difference of two growth rates: +139.2 pts. */
const pts = (v: number) => `${signedPoints(v)} pts`;
const dollars = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`;

export const METRICS: MetricInfo[] = [
  { key: 'grossProfitability', label: 'Gross profit per $ of assets', term: 'grossProfitability', format: dollars, note: 'Higher has come before higher returns (Novy-Marx 2013).' },
  { key: 'operatingMargin', label: 'Operating margin', term: 'operatingMargin', format: (v) => pc(v, 1), note: 'Operating income ÷ sales.' },
  { key: 'returnOnAssets', label: 'Return on assets', term: 'returnOnAssets', format: (v) => pc(v, 1), note: 'Net income ÷ average total assets.' },
  { key: 'salesGrowth', label: 'Sales growth', term: 'salesGrowth', format: (v) => pc(v, 1, true), note: 'Revenue against the year before.' },
  { key: 'assetGrowth', label: 'Asset growth', term: 'assetGrowth', format: (v) => pc(v, 1, true), note: 'Higher has come before lower returns (Cooper, Gulen and Schill 2008).' },
  { key: 'accruals', label: 'Accruals', term: 'accruals', format: (v) => pc(v, 1, true), note: '(Net income − operating cash flow) ÷ average assets; higher has come before lower returns (Sloan 1996).' },
  { key: 'inventoryVsSales', label: 'Inventory vs sales growth', term: 'inventoryVsSales', format: pts, note: 'Higher has come before weaker profits and returns (Thomas and Zhang 2002).' },
  // helper 93: log change of diluted shares, shown as the % change it equals
  { key: 'shareIssuance', label: 'Share count change', term: 'shareIssuance', format: (v) => pc(Math.expm1(v), 1, true), note: 'Higher (more shares issued) has come before lower returns (Pontiff and Woodgate 2008).' },
  { key: 'rdIntensity', label: 'R&D per $ of sales', term: 'rdIntensity', format: (v) => pc(v, 1), note: 'Research and development spending ÷ sales (Chan, Lakonishok and Sougiannis 2001).' },
];

/** Plain words for a percentile: "higher than 96% of 2,539", "lower than 74% of 4,055", "about the middle of 1,474". */
export function placeWords(r: Ranked): string {
  const of = `of ${r.n.toLocaleString('en-US')}`;
  if (r.percentile >= 60) return `higher than ${Math.min(99, Math.floor(r.percentile))}% ${of}`;
  if (r.percentile <= 40) return `lower than ${Math.min(99, Math.floor(100 - r.percentile))}% ${of}`;
  return `about the middle ${of}`;
}

/** Top or bottom tenth: the readings worth a sentence. */
export const standsOut = (r: Ranked) => r.percentile >= 90 || r.percentile <= 10;

/** One sentence naming the readings in the top or bottom tenth (or saying none is). */
export function summaryWords(f: FilerRank): string {
  const ranked = METRICS.map((m) => [m, f.metrics[m.key]] as const).filter((x): x is readonly [MetricInfo, Ranked] => x[1] != null);
  if (!ranked.length) return 'None of these readings could be worked out from the figures the company tags in its filings.';
  const top = ranked.filter(([, r]) => r.percentile >= 90).map(([m]) => m.label.toLowerCase());
  const bottom = ranked.filter(([, r]) => r.percentile <= 10).map(([m]) => m.label.toLowerCase());
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  if (!top.length && !bottom.length) return ranked.length === 1 ? 'Its one reading is not in the top or bottom tenth of US companies.' : `None of its ${ranked.length} readings is in the top or bottom tenth of US companies.`;
  const parts = [top.length ? `in the top tenth of US companies for ${list(top)}` : '', bottom.length ? `in the bottom tenth for ${list(bottom)}` : ''].filter(Boolean);
  return `It sits ${parts.join(', and ')}.`;
}

/** Why a reading is missing: the companies that don't tag the line (Amazon has no gross profit line, banks no inventory). */
export const missingWords = 'Not tagged in the filing in a way that can be compared.';
