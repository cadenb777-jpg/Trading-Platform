/**
 * Prospecting page maths and wording (pure, tested in logic.test.ts): the search form -> a prospect.search request,
 * money and radius parsing, labels that never claim certainty, freshness of each source, compare tables and CSV.
 */
import type { ClientType, CompareResult, FirmType, ProspectFirm, ProspectQuery, ProspectStatus } from '../data/prospect';

// ---------- labels ----------

/** The type chips on the search form (the two remaining types sit behind "More"). */
export const MAIN_TYPES: FirmType[] = ['Registered RIA', 'Exempt reporting adviser', 'Likely family office', 'Multi-family office'];
export const MORE_TYPES: FirmType[] = ['Possible single-family office', 'State-registered RIA', 'Other 13F filer', 'Form D issuer'];
export const TYPE_SHORT: Record<FirmType, string> = {
  'Registered RIA': 'RIA',
  'Exempt reporting adviser': 'Exempt adviser',
  'Likely family office': 'Family office?',
  'Multi-family office': 'Multi-family office',
  'Other 13F filer': '13F filer',
  'Form D issuer': 'Form D issuer',
  'State-registered RIA': 'State RIA',
  'Possible single-family office': 'Single-family office?',
};
/** Glossary term behind each type. */
export const TYPE_TERM: Record<FirmType, string> = {
  'Registered RIA': 'prRia',
  'Exempt reporting adviser': 'prEra',
  'Likely family office': 'prFamilyOffice',
  'Multi-family office': 'prMfo',
  'Other 13F filer': 'pr13fFiler',
  'Form D issuer': 'prFormD',
  'State-registered RIA': 'prStateRia',
  'Possible single-family office': 'prSfo',
};

export const CLIENT_LABELS: Record<ClientType, string> = {
  individuals: 'Individuals (not HNW)',
  hnw: 'High-net-worth individuals',
  banks: 'Banks or thrifts',
  investment_companies: 'Investment companies',
  bdcs: 'Business development companies',
  pooled: 'Pooled investment vehicles',
  pensions: 'Pension and profit-sharing plans',
  charities: 'Charities',
  government: 'State or municipal entities',
  other_advisers: 'Other investment advisers',
  insurance: 'Insurance companies',
  sovereign: 'Sovereign wealth funds',
  corporations: 'Corporations or businesses',
  other: 'Other',
};
/** The client types offered as filters (the rest are rare for prospecting). */
export const CLIENT_FILTERS: ClientType[] = ['hnw', 'individuals', 'pooled', 'pensions', 'charities', 'corporations', 'insurance', 'other_advisers'];

/**
 * The confidence words shown with a type. Registry facts read "From filing"; family-office labels read
 * "Strong / Moderate / Weak signals" or "Unknown". Whatever the helper sends, the page never says "certain".
 */
export function confidenceLabel(confidence: string | null | undefined): string {
  const c = (confidence ?? '').trim().toLowerCase();
  if (!c) return 'Unknown';
  if (/certain|definite|confirmed|guarantee/.test(c)) return 'Strong signals';
  return c.charAt(0).toUpperCase() + c.slice(1);
}

/** Badge tone: filing facts are neutral, signals get the accent, weak/unknown are muted. */
export function confidenceTone(confidence: string | null | undefined): 'accent' | 'warn' | '' {
  const c = (confidence ?? '').toLowerCase();
  if (c.startsWith('strong') || c.startsWith('moderate')) return 'accent';
  if (c.startsWith('weak') || c === 'unknown') return 'warn';
  return '';
}

// ---------- numbers ----------

/** "$5m", "1.2B", "250k", "500,000", "5 million" -> dollars. Blank or nonsense -> null. */
export function parseMoney(raw: string | null | undefined): number | null {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[$,\s]/g, '').replace(/(million|mm|mn)$/, 'm').replace(/(billion|bn)$/, 'b').replace(/(thousand)$/, 'k');
  const m = /^(\d+(?:\.\d+)?|\.\d+)([kmbt])?$/.exec(s);
  if (!m) return null;
  return parseFloat(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[m[2] as 'k'] ?? 1);
}

/** $1.23B / $450.0M / $12.5K; null -> "Not reported". */
export function moneyText(v: number | null | undefined, missing = 'Not reported'): string {
  if (v == null || !Number.isFinite(v)) return missing;
  const abs = Math.abs(v);
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${Math.round(v)}`;
}

export const countText = (v: number | null | undefined, missing = '—') => (v == null || !Number.isFinite(v) ? missing : Math.round(v).toLocaleString('en-US'));
export const weightText = (v: number | null | undefined, digits = 1) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`);

/** "2025-03-01" -> "Mar 2025"; "2025-03-15" with day=true -> "Mar 15, 2025". */
export function dateText(iso: string | null | undefined, day = false): string {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(iso ?? '');
  if (!m) return '—';
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1];
  return day && m[3] ? `${month} ${+m[3]}, ${m[1]}` : `${month} ${m[1]}`;
}

/** A 13F period end ("2025-03-31") -> "Q1 2025". */
export function quarterText(period: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(period ?? '');
  if (!m) return '—';
  return `Q${Math.ceil(+m[2] / 3)} ${m[1]}`;
}

// ---------- radius ----------

export type Place = { kind: 'zip'; zip: string } | { kind: 'point'; lat: number; lon: number } | { kind: 'address'; address: string };

/** What was typed in "of ZIP or address": a 5-digit ZIP, "lat, lon", or a street address (geocoded by the helper). */
export function parsePlace(raw: string | null | undefined): Place | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const zip = /^(\d{5})(?:-\d{4})?$/.exec(s);
  if (zip) return { kind: 'zip', zip: zip[1] };
  const pt = /^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(s);
  if (pt && Math.abs(+pt[1]) <= 90 && Math.abs(+pt[2]) <= 180) return { kind: 'point', lat: +pt[1], lon: +pt[2] };
  return { kind: 'address', address: s };
}

/** Miles from the radius box: 0.5..500, blank -> null, too big -> 500. */
export function parseMiles(raw: string | number | null | undefined): number | null {
  const v = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '').replace(/mi(les?)?$/i, '').trim());
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.min(500, Math.max(0.5, v));
}

/** "25 miles of 10022", "within 10 mi of 1 Park Ave, New York" -> {miles, place}. */
export function parseRadiusPhrase(text: string): { miles: number; place: Place } | null {
  const m = /^\s*(?:within\s+)?(\d+(?:\.\d+)?)\s*(?:mi|miles?)?\s+(?:of|from|around|near)\s+(.+)$/i.exec(text);
  if (!m) return null;
  const miles = parseMiles(m[1]);
  const place = parsePlace(m[2]);
  return miles && place ? { miles, place } : null;
}

// ---------- the search form ----------

export type SortKey = NonNullable<ProspectQuery['sort']>;
export interface SearchForm {
  text: string;
  types: FirmType[];
  state: string;
  city: string;
  zip: string;
  miles: string;
  /** ZIP, address or "lat, lon" for the radius. */
  near: string;
  aumMin: string;
  aumMax: string;
  clientTypes: ClientType[];
  has13f: boolean;
  hasPrivateFunds: boolean;
  /** A liquidity signal in the last 12 months (public records). */
  recentLiquidity: boolean;
  holds: string;
  minPosition: string;
  sort: SortKey | '';
}

export const emptyForm = (): SearchForm => ({ text: '', types: [], state: '', city: '', zip: '', miles: '', near: '', aumMin: '', aumMax: '', clientTypes: [], has13f: false, hasPrivateFunds: false, recentLiquidity: false, holds: '', minPosition: '', sort: '' });

/** A 9-character CUSIP (letters and digits, the last a digit). Anything else in "Holds" is read as a ticker. */
export const isCusip = (s: string) => /^[0-9A-Z]{8}[0-9]$/.test(s.trim().toUpperCase());

/**
 * The form -> a prospect.search request. `point` is the geocoded centre when "near" is a street address (the
 * page asks the helper first). Returns the query plus any problem to show (the query is still usable without it).
 */
export function formToQuery(f: SearchForm, point?: { lat: number; lon: number } | null): { query: ProspectQuery; problems: string[] } {
  const q: ProspectQuery = {};
  const problems: string[] = [];
  if (f.text.trim()) q.text = f.text.trim();
  if (f.types.length) q.types = [...f.types];
  if (f.state.trim()) q.state = f.state.trim().toUpperCase();
  if (f.city.trim()) q.city = f.city.trim();
  if (f.zip.trim()) q.zip = f.zip.trim();
  const min = parseMoney(f.aumMin);
  const max = parseMoney(f.aumMax);
  if (f.aumMin.trim() && min == null) problems.push(`AUM minimum "${f.aumMin}" isn't a number (try 50m or 1.5b).`);
  if (f.aumMax.trim() && max == null) problems.push(`AUM maximum "${f.aumMax}" isn't a number (try 50m or 1.5b).`);
  if (min != null && max != null && min > max) problems.push('The AUM minimum is above the maximum.');
  if (min != null) q.aumMin = min;
  if (max != null) q.aumMax = max;
  if (f.clientTypes.length) q.clientTypes = [...f.clientTypes];
  if (f.has13f) q.has13f = true;
  if (f.hasPrivateFunds) q.hasPrivateFunds = true;
  if (f.recentLiquidity) q.recentLiquidity = true;
  const holds = f.holds.trim().toUpperCase();
  if (holds) {
    q.holds = isCusip(holds) ? { cusip: holds } : { symbol: holds };
    const minPos = parseMoney(f.minPosition);
    if (f.minPosition.trim() && minPos == null) problems.push(`Minimum position "${f.minPosition}" isn't a number.`);
    if (minPos != null) q.minPosition = minPos;
  }
  const place = parsePlace(f.near);
  if (place) {
    const miles = parseMiles(f.miles) ?? 25;
    if (place.kind === 'zip') q.near = { zip: place.zip, miles };
    else if (place.kind === 'point') q.near = { lat: place.lat, lon: place.lon, miles };
    else if (point) q.near = { lat: point.lat, lon: point.lon, miles };
    else problems.push('That address needs finding first.');
  } else if (f.miles.trim()) problems.push('Add a ZIP or address for the radius.');
  if (f.sort) q.sort = f.sort;
  if (q.sort === 'distance' && !q.near) delete q.sort;
  if (q.sort === 'position' && !q.holds) delete q.sort;
  return { query: q, problems };
}

/** How many filters are on (for the "Filters (3)" button on phones). */
export function activeFilterCount(f: SearchForm): number {
  return [f.text, f.state, f.city, f.zip, f.near, f.aumMin, f.aumMax, f.holds].filter((s) => s.trim()).length + (f.types.length ? 1 : 0) + (f.clientTypes.length ? 1 : 0) + (f.has13f ? 1 : 0) + (f.hasPrivateFunds ? 1 : 0) + (f.recentLiquidity ? 1 : 0);
}

/** A plain sentence for what is being searched ("Multi-family offices within 25 mi of 10022, AUM $100M+"). */
export function describeForm(f: SearchForm): string {
  const parts: string[] = [];
  parts.push(f.types.length ? f.types.map((t) => TYPE_SHORT[t]).join(' or ') : 'All firms');
  if (f.text.trim()) parts.push(`matching "${f.text.trim()}"`);
  if (f.near.trim()) parts.push(`within ${parseMiles(f.miles) ?? 25} mi of ${f.near.trim()}`);
  const where = [f.city.trim(), f.state.trim().toUpperCase(), f.zip.trim()].filter(Boolean).join(', ');
  if (where) parts.push(`in ${where}`);
  const min = parseMoney(f.aumMin);
  const max = parseMoney(f.aumMax);
  if (min != null || max != null) parts.push(`AUM ${min != null ? moneyText(min) : '$0'}${max != null ? `-${moneyText(max)}` : '+'}`);
  if (f.clientTypes.length) parts.push(`serving ${f.clientTypes.map((c) => CLIENT_LABELS[c].toLowerCase()).join(' or ')}`);
  if (f.has13f) parts.push('files 13F');
  if (f.hasPrivateFunds) parts.push('has private funds');
  if (f.recentLiquidity) parts.push('recent liquidity event');
  if (f.holds.trim()) parts.push(`holds ${f.holds.trim().toUpperCase()}${parseMoney(f.minPosition) ? ` (${moneyText(parseMoney(f.minPosition))}+)` : ''}`);
  return parts.join(', ');
}

// ---------- results columns ----------

export interface Column {
  key: string;
  label: string;
  /** Shown by default. */
  on: boolean;
}
export const RESULT_COLUMNS: Column[] = [
  { key: 'type', label: 'Type', on: true },
  { key: 'place', label: 'City / State', on: true },
  { key: 'aum', label: 'AUM', on: true },
  { key: 'clients', label: 'Clients', on: true },
  { key: 'people', label: 'People (titles)', on: true },
  { key: 'value13f', label: '13F value', on: true },
  { key: 'filed', label: 'Last filing', on: true },
  { key: 'employees', label: 'Employees', on: false },
  { key: 'funds', label: 'Private funds', on: false },
  { key: 'crd', label: 'CRD / CIK', on: false },
  { key: 'phone', label: 'Phone', on: false },
  { key: 'website', label: 'Website', on: false },
  { key: 'outreach', label: 'Outreach', on: true },
];

/** The latest date a firm filed anything we hold (ADV filing date, else its 13F quarter). */
export const lastFiling = (f: Pick<ProspectFirm, 'filingDate' | 'period13f'>) => f.filingDate || f.period13f || '';

// ---------- data freshness ----------

export type SourceKey = 'adv' | 'adv_full' | '13f' | 'formd' | 'state' | 'geo';
export const SOURCE_INFO: { key: SourceKey; label: string; what: string; size: string; cadence: string; beta?: boolean }[] = [
  { key: 'adv', label: 'Adviser lists (Form ADV, monthly)', what: 'Every SEC-registered adviser and exempt adviser: address, AUM, clients by type, fees, employees.', size: 'about 60 MB', cadence: 'Monthly' },
  { key: 'adv_full', label: 'Form ADV full data (people and private funds)', what: 'Owners and executive officers with titles (Schedule A/B) and private funds with gross assets (Schedule D 7.B.1). Firms that filed after the bulk data ended are read one by one from IAPD.', size: 'about 1 GB download', cadence: 'When the SEC publishes' },
  { key: '13f', label: '13F holdings (quarterly)', what: 'Every manager with $100M+ in listed US securities: positions for the latest 2 quarters, total value for 8 quarters (the trend), signatures, other managers.', size: 'about 400 MB a quarter', cadence: 'Quarterly' },
  { key: 'formd', label: 'Form D offerings (3 years)', what: 'Private fund offerings from the last 12 quarters (newest filing per fund): amounts, investors, minimums, related persons.', size: 'about 50 MB a quarter', cadence: 'Quarterly' },
  { key: 'state', label: 'State-registered advisers (IAPD)', what: 'Smaller RIAs registered with their state instead of the SEC (often under $100M): name, CRD, main office. From the public IAPD firm search, state by state.', size: 'small, about 20 minutes (polite pace)', cadence: 'Monthly', beta: true },
  { key: 'geo', label: 'Map locations (US Census)', what: 'Turns firm addresses into map points (and ZIP centres), for radius search and the map.', size: 'a few MB', cadence: 'After each adviser list' },
];

/** First full download: roughly what the database grows to. */
export const FIRST_DOWNLOAD_SIZE = '1-2 GB of disk space';

/** What public data can never show, in plain words (the Data tab). */
export const DATA_LIMITS = [
  'Single-family offices are exempt from adviser registration, so they file no Form ADV. They show up only if they file 13F ($100M+ in listed US stocks) or Form D (a private offering).',
  "Firms with less than $100M in listed US securities don't file 13F, so they have no holdings here.",
  "The SEC's bulk Form ADV data (people and private funds) ended in Dec 2024. Firms that filed later are filled in one by one from their Form ADV PDF on IAPD.",
  "Filings carry names and titles, never emails or direct phone lines. If a firm doesn't file, it isn't in public data.",
];

export type Freshness = { state: 'missing' | 'fresh' | 'due' | 'running' | 'failed'; text: string; date: string; action?: string };
export const FRESHNESS_LABEL: Record<Freshness['state'], string> = { fresh: 'Done', due: 'Out of date', missing: 'Not downloaded', running: 'Downloading', failed: 'Failed' };

/** One source's line in the Data panel: Done / Failed (why, what to do) / Not downloaded / Out of date / Downloading. */
export function sourceFreshness(status: ProspectStatus | null, key: string, nowMs = Date.now()): Freshness {
  const info = status?.sources?.[key] ?? null;
  const job = status?.job;
  if (job?.running && (job.current ? job.current === key : job.source === key || job.source === 'all')) return { state: 'running', text: job.stage || 'Running', date: '' };
  const result = status?.results?.[key] ?? null;
  if (result && result.ok === false && (!info?.at || result.when >= info.at)) return { state: 'failed', text: result.reason ?? 'Failed', date: '', action: result.action };
  if (!info || !info.at) return { state: 'missing', text: 'Not downloaded yet', date: '' };
  const days = Math.max(0, (nowMs / 1000 - info.at) / 86400);
  const ago = days < 1 ? 'today' : `${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'} ago`;
  const limit = status?.refreshDays?.[key] ?? 30;
  const date = typeof info.sourceDate === 'string' ? info.sourceDate : '';
  const file = key === '13f' && date ? `13F data to ${dateText(date, true)}` : key === 'adv' && date ? `${dateText(date)} list` : key === 'adv_full' && date ? `As of ${dateText(date, true)}` : key === 'formd' && date ? `Form D data to ${dateText(date, true)}` : key === 'state' && date ? `Listed ${dateText(date, true)}` : key === 'geo' ? `${countText((info as { matched?: number }).matched ?? 0)} address${(info as { matched?: number }).matched === 1 ? '' : 'es'} matched` : '';
  return { state: key !== 'geo' && days > limit ? 'due' : 'fresh', text: `${file ? `${file} · ` : ''}downloaded ${ago}`, date };
}

/** Short names of the download stages (the overall progress line). */
export const STAGE_NAMES: Record<string, string> = { adv: 'Adviser lists', adv_full: 'People and funds', '13f': '13F', formd: 'Form D', state: 'State advisers', build: 'Matching firms', geo: 'Map locations' };

/** Sources whose last run failed (for "Retry failed sources"), including the firm-matching step. */
export function failedSources(status: ProspectStatus | null): string[] {
  const keys = SOURCE_INFO.map((s) => s.key as string).filter((k) => sourceFreshness(status, k).state === 'failed');
  return status?.results?.build?.ok === false && !status.job?.running ? [...keys, 'build'] : keys;
}

/** Header self-check summary for one source: "All columns found", or what's missing. */
export function headerSummary(checks: ProspectStatus['headers'][string]): { ok: boolean; text: string } | null {
  if (!checks || !checks.length) return null;
  const required = checks.flatMap((c) => c.missingRequired);
  const optional = checks.flatMap((c) => c.missingOptional);
  const unexpected = checks.reduce((n, c) => n + (c.unexpectedCount ?? c.unexpected.length), 0);
  if (required.length) return { ok: false, text: `Missing required columns: ${required.join(', ')}. Nothing from that file was saved.` };
  const extra = [optional.length ? `${optional.length} optional column${optional.length === 1 ? '' : 's'} not found (${optional.slice(0, 4).join(', ')}${optional.length > 4 ? '…' : ''})` : '', unexpected ? `${unexpected} extra column${unexpected === 1 ? '' : 's'} ignored` : ''].filter(Boolean);
  return { ok: true, text: `All required columns found in ${checks.length} file${checks.length === 1 ? '' : 's'}${extra.length ? `; ${extra.join('; ')}` : ''}.` };
}

// ---------- compare ----------

/** Overlap between every pair as a lookup: overlap(a, b) in 0..1 (null when either has no 13F). */
export function overlapLookup(result: CompareResult) {
  const map = new Map<string, { overlap: number; shared: number }>();
  for (const p of result.pairs) map.set(`${p.a}|${p.b}`, p).set(`${p.b}|${p.a}`, p);
  const has13f = new Set(result.firms.filter((f) => f.positions > 0).map((f) => f.id));
  return (a: string, b: string) => (a === b || !has13f.has(a) || !has13f.has(b) ? null : (map.get(`${a}|${b}`) ?? null));
}

/** Sectors across the compared firms, biggest combined weight first; the rest fold into "Other sectors". */
export function sectorRows(firms: { sectors: Record<string, number> }[], top = 8): { sector: string; weights: (number | null)[] }[] {
  const total = new Map<string, number>();
  for (const f of firms) for (const [s, w] of Object.entries(f.sectors ?? {})) total.set(s, (total.get(s) ?? 0) + w);
  const order = [...total.keys()].sort((a, b) => (a === 'Not mapped' ? 1 : b === 'Not mapped' ? -1 : (total.get(b) ?? 0) - (total.get(a) ?? 0)));
  const keep = order.filter((s) => s !== 'Not mapped').slice(0, top);
  const rows = keep.map((sector) => ({ sector, weights: firms.map((f) => (Object.keys(f.sectors ?? {}).length ? (f.sectors[sector] ?? 0) : null)) }));
  const rest = order.filter((s) => !keep.includes(s));
  if (rest.length)
    rows.push({ sector: rest.length === 1 && rest[0] === 'Not mapped' ? 'Not mapped (no sector found)' : 'Other / not mapped', weights: firms.map((f) => (Object.keys(f.sectors ?? {}).length ? rest.reduce((n, s) => n + (f.sectors[s] ?? 0), 0) : null)) });
  return rows;
}

/** The side-by-side table: one row per measure, one column per firm (text already formatted). */
export function compareTable(result: CompareResult): { label: string; values: string[] }[] {
  const f = result.firms;
  const row = (label: string, fn: (x: CompareResult['firms'][number]) => string) => ({ label, values: f.map(fn) });
  return [
    row('Type', (x) => `${x.type} (${confidenceLabel(x.confidence)})`),
    row('Regulatory AUM', (x) => moneyText(x.aum)),
    row('Discretionary AUM', (x) => moneyText(x.discretionary)),
    row('Clients', (x) => (x.clients ? countText(x.clients) : 'Not reported')),
    row('AUM per client', (x) => moneyText(x.aumPerClient, '—')),
    row('High-net-worth share of clients', (x) => weightText(x.clientMix?.hnw?.share ?? null, 0)),
    row('Employees', (x) => countText(x.employees, 'Not reported')),
    row('How they are paid', (x) => (x.fees?.length ? x.fees.join(', ') : 'Not reported')),
    row('Private funds', (x) => (x.privateFunds ? `${x.privateFunds} (${moneyText(x.privateFundsGav, 'GAV not reported')})` : 'None in Form ADV data')),
    row('13F value', (x) => (x.value13f != null ? `${moneyText(x.value13f)} (${quarterText(x.period13f)})` : 'No 13F')),
    row('13F positions', (x) => (x.positions ? countText(x.positions) : '—')),
    row('13F turnover (quarter)', (x) => weightText(x.turnover, 0)),
  ];
}

/** CSV text with every cell quoted when needed and formula-like cells defused (a leading apostrophe). */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    if (v == null) return '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s) && !(typeof v === 'number')) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** The compare view as CSV: measures, overlap per pair, shared holdings with each firm's weight. */
export function compareCsv(result: CompareResult): string {
  const names = result.firms.map((f) => f.name);
  const byId = new Map(result.firms.map((f) => [f.id, f.name]));
  const rows: (string | number | null)[][] = [['Measure', ...names], ...compareTable(result).map((r) => [r.label, ...r.values])];
  rows.push([], ['13F overlap', 'Firm A', 'Firm B', 'Overlap', 'Shared holdings']);
  for (const p of result.pairs) rows.push(['', byId.get(p.a) ?? p.a, byId.get(p.b) ?? p.b, weightText(p.overlap), p.shared]);
  rows.push([], ['Shared holdings', 'CUSIP', 'Held by', ...names]);
  for (const s of result.sharedHoldings) rows.push([s.ticker || s.issuer || s.cusip, s.cusip, s.heldBy, ...s.weights.map((w) => weightText(w, 2))]);
  rows.push([], ['Sector mix (13F, long stock positions)', ...names]);
  for (const s of sectorRows(result.firms)) rows.push([s.sector, ...s.weights.map((w) => (w == null ? 'No 13F' : weightText(w)))]);
  rows.push([], ['Source: SEC Form ADV, 13F and Form D data in your prospect database. Family-office labels are educated guesses from public signals.']);
  return toCsv(rows);
}

// ---------- map clustering ----------

/**
 * Groups points that sit within `cell` pixels of each other on screen (a simple grid), so a dense city shows one
 * numbered circle instead of a pile of pins. `project` turns a point into screen pixels at the current zoom.
 */
export function clusterPoints<T>(items: T[], project: (item: T) => { x: number; y: number }, cell = 48): { x: number; y: number; items: T[] }[] {
  const grid = new Map<string, { x: number; y: number; items: T[] }>();
  for (const item of items) {
    const p = project(item);
    const key = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`;
    const g = grid.get(key);
    if (!g) grid.set(key, { x: p.x, y: p.y, items: [item] });
    else {
      const n = g.items.length;
      g.x = (g.x * n + p.x) / (n + 1);
      g.y = (g.y * n + p.y) / (n + 1);
      g.items.push(item);
    }
  }
  return [...grid.values()];
}

/** The 13F change badge words. */
export const CHANGE_WORDS: Record<string, string> = { new: 'New', added: 'Added', trimmed: 'Trimmed', exited: 'Exited', unchanged: 'Unchanged' };
export const CHANGE_TONE: Record<string, string> = { new: 'accent', added: 'up', trimmed: 'warn', exited: 'down', unchanged: '' };
