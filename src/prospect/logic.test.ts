import { describe, expect, it } from 'vitest';
import type { CompareResult, ProspectStatus } from '../data/prospect';
import {
  activeFilterCount,
  clusterPoints,
  compareCsv,
  compareTable,
  confidenceLabel,
  dateText,
  describeForm,
  emptyForm,
  formToQuery,
  headerSummary,
  moneyText,
  overlapLookup,
  parseMiles,
  parseMoney,
  parsePlace,
  parseRadiusPhrase,
  quarterText,
  sectorRows,
  sourceFreshness,
  toCsv,
} from './logic';

describe('money and dates', () => {
  it('reads the ways people type amounts', () => {
    expect(parseMoney('$5m')).toBe(5e6);
    expect(parseMoney('1.2B')).toBe(1.2e9);
    expect(parseMoney('250k')).toBe(250e3);
    expect(parseMoney('500,000')).toBe(500000);
    expect(parseMoney('5 million')).toBe(5e6);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('lots')).toBeNull();
  });
  it('formats money and says when it is missing', () => {
    expect(moneyText(2.5e9)).toBe('$2.50B');
    expect(moneyText(450e6)).toBe('$450.0M');
    expect(moneyText(null)).toBe('Not reported');
    expect(dateText('2025-03-01')).toBe('Mar 2025');
    expect(dateText('2025-03-15', true)).toBe('Mar 15, 2025');
    expect(quarterText('2025-03-31')).toBe('Q1 2025');
    expect(quarterText(null)).toBe('—');
  });
  it('never says certain', () => {
    expect(confidenceLabel('from filing')).toBe('From filing');
    expect(confidenceLabel('strong signals')).toBe('Strong signals');
    expect(confidenceLabel('certain')).toBe('Strong signals');
    expect(confidenceLabel('')).toBe('Unknown');
  });
});

describe('radius', () => {
  it('reads a ZIP, a point or an address', () => {
    expect(parsePlace('10022')).toEqual({ kind: 'zip', zip: '10022' });
    expect(parsePlace('10022-1234')).toEqual({ kind: 'zip', zip: '10022' });
    expect(parsePlace('40.75, -73.98')).toEqual({ kind: 'point', lat: 40.75, lon: -73.98 });
    expect(parsePlace('1 Park Ave, New York NY')).toEqual({ kind: 'address', address: '1 Park Ave, New York NY' });
    expect(parsePlace('  ')).toBeNull();
  });
  it('keeps miles sensible', () => {
    expect(parseMiles('25')).toBe(25);
    expect(parseMiles('10 miles')).toBe(10);
    expect(parseMiles('9000')).toBe(500);
    expect(parseMiles('0')).toBeNull();
    expect(parseMiles('')).toBeNull();
  });
  it('reads "within N miles of" phrases', () => {
    expect(parseRadiusPhrase('within 25 miles of 10022')).toEqual({ miles: 25, place: { kind: 'zip', zip: '10022' } });
    expect(parseRadiusPhrase('10 mi of 1 Park Ave, New York')).toEqual({ miles: 10, place: { kind: 'address', address: '1 Park Ave, New York' } });
    expect(parseRadiusPhrase('acme wealth')).toBeNull();
  });
});

describe('form -> prospect.search request', () => {
  it('sends only what is filled in', () => {
    expect(formToQuery(emptyForm()).query).toEqual({});
  });
  it('maps every filter', () => {
    const f = { ...emptyForm(), text: ' acme ', types: ['Multi-family office' as const], state: 'ny', aumMin: '100m', aumMax: '2b', clientTypes: ['hnw' as const], has13f: true, hasPrivateFunds: true, holds: 'aapl', minPosition: '1m', near: '10022', miles: '30', sort: 'distance' as const };
    const { query, problems } = formToQuery(f);
    expect(problems).toEqual([]);
    expect(query).toEqual({ text: 'acme', type: ['Multi-family office'], state: 'NY', aumMin: 1e8, aumMax: 2e9, clientTypes: ['hnw'], has13f: true, hasPrivateFunds: true, holds: { symbol: 'AAPL' }, minPosition: 1e6, near: { zip: '10022', miles: 30 }, sort: 'distance' });
    expect(activeFilterCount(f)).toBe(10);
  });
  it('a CUSIP goes as a CUSIP; an address needs its geocoded point; a radius defaults to 25 miles', () => {
    expect(formToQuery({ ...emptyForm(), holds: '037833100' }).query.holds).toEqual({ cusip: '037833100' });
    const addr = { ...emptyForm(), near: '1 Park Ave, New York' };
    expect(formToQuery(addr).query.near).toBeUndefined();
    expect(formToQuery(addr).problems).toHaveLength(1);
    expect(formToQuery(addr, { lat: 40.75, lon: -73.98 }).query.near).toEqual({ lat: 40.75, lon: -73.98, miles: 25 });
  });
  it('reports bad numbers and drops sorts that need a missing filter', () => {
    const { query, problems } = formToQuery({ ...emptyForm(), aumMin: 'big', aumMax: '1m', sort: 'distance' });
    expect(problems[0]).toMatch(/isn't a number/);
    expect(query).toEqual({ aumMax: 1e6 });
    expect(formToQuery({ ...emptyForm(), aumMin: '5m', aumMax: '1m' }).problems).toContain('The AUM minimum is above the maximum.');
    expect(formToQuery({ ...emptyForm(), miles: '10' }).problems).toContain('Add a ZIP or address for the radius.');
  });
  it('describes the search in words', () => {
    expect(describeForm({ ...emptyForm(), types: ['Multi-family office'], near: '10022', miles: '25', aumMin: '100m' })).toBe('Multi-family office, within 25 mi of 10022, AUM $100.0M+');
  });
});

const RESULT: CompareResult = {
  firms: [
    { id: 'a', name: 'Acme', type: 'Registered RIA', confidence: 'from filing', aum: 5e8, discretionary: 4.5e8, clients: 250, aumPerClient: 2e6, employees: 25, fees: ['Percentage of assets'], privateFunds: 0, privateFundsGav: null, clientMix: { hnw: { count: 50, fewerThan5: null, aum: 4e8, share: 0.2 } }, value13f: 8e5, period13f: '2025-03-31', positions: 2, turnover: 0.1, sectors: { Technology: 0.7, Health: 0.3 } },
    { id: 'b', name: '=Pine', type: 'Multi-family office', confidence: 'strong signals', aum: null, discretionary: null, clients: 0, aumPerClient: null, employees: null, fees: [], privateFunds: 1, privateFundsGav: 2e8, clientMix: {}, value13f: 2e6, period13f: '2025-03-31', positions: 3, turnover: null, sectors: { Technology: 0.5, Energy: 0.35, 'Not mapped': 0.15 } },
    { id: 'c', name: 'Quiet', type: 'Likely family office', confidence: 'weak signals', aum: null, discretionary: null, clients: 0, aumPerClient: null, employees: null, fees: [], privateFunds: 0, privateFundsGav: null, clientMix: {}, value13f: null, period13f: null, positions: 0, turnover: null, sectors: {} },
  ],
  pairs: [
    { a: 'a', b: 'b', overlap: 0.5, shared: 1, differences: [] },
    { a: 'a', b: 'c', overlap: 0, shared: 0, differences: [] },
    { a: 'b', b: 'c', overlap: 0, shared: 0, differences: [] },
  ],
  sharedHoldings: [{ cusip: '037833100', ticker: 'AAPL', issuer: 'APPLE INC', heldBy: 2, weights: [0.7, 0.5, 0] }],
};

describe('compare', () => {
  it('formats measures, saying what is missing', () => {
    const t = compareTable(RESULT);
    expect(t.find((r) => r.label === 'Regulatory AUM')!.values).toEqual(['$500.0M', 'Not reported', 'Not reported']);
    expect(t.find((r) => r.label === 'Private funds')!.values).toEqual(['None in Form ADV data', '1 ($200.0M)', 'None in Form ADV data']);
    expect(t.find((r) => r.label === '13F value')!.values).toEqual(['$800K (Q1 2025)', '$2.0M (Q1 2025)', 'No 13F']);
    expect(t.find((r) => r.label === 'Type')!.values[2]).toBe('Likely family office (Weak signals)');
  });
  it('looks up overlap both ways, none for a firm without 13F', () => {
    const o = overlapLookup(RESULT);
    expect(o('a', 'b')?.overlap).toBe(0.5);
    expect(o('b', 'a')?.overlap).toBe(0.5);
    expect(o('a', 'c')).toBeNull();
    expect(o('a', 'a')).toBeNull();
  });
  it('lines up sectors, folding unmapped value last', () => {
    const rows = sectorRows(RESULT.firms);
    expect(rows.map((r) => r.sector)).toEqual(['Technology', 'Energy', 'Health', 'Not mapped (no sector found)']);
    expect(rows[0].weights).toEqual([0.7, 0.5, null]);
    expect(rows[3].weights).toEqual([0, 0.15, null]);
  });
  it('exports CSV with formulas defused', () => {
    const csv = compareCsv(RESULT);
    expect(csv.split('\r\n')[0]).toBe("Measure,Acme,'=Pine,Quiet");
    expect(csv).toContain('AAPL,037833100,2,70.00%,50.00%,0.00%');
    expect(toCsv([['a,b', 'say "hi"', -5, '-5']])).toBe('"a,b","say ""hi""",-5,\'-5\r\n');
  });
});

describe('data panel', () => {
  const status = {
    sources: { adv: { at: 1_700_000_000, sourceDate: '2025-03-01' }, '13f': { at: 1_700_000_000 - 40 * 86400, sourceDate: '2025-05-31' }, adv_full: null, formd: null, geo: null },
    job: { running: false },
    refreshDays: { adv: 30, '13f': 30 },
  } as unknown as ProspectStatus;
  it('says how fresh each source is', () => {
    const now = (1_700_000_000 + 2 * 86400) * 1000;
    expect(sourceFreshness(status, 'adv', now)).toEqual({ state: 'fresh', text: 'Mar 2025 list · downloaded 2 days ago', date: '2025-03-01' });
    expect(sourceFreshness(status, '13f', now).state).toBe('due');
    expect(sourceFreshness(status, 'formd', now)).toEqual({ state: 'missing', text: 'Not downloaded yet', date: '' });
    expect(sourceFreshness({ ...status, job: { running: true, source: 'all', stage: 'Downloading 13F 40%' } }, 'adv', now)).toEqual({ state: 'running', text: 'Downloading 13F 40%', date: '' });
  });
  it('summarises the header self-check', () => {
    expect(headerSummary(null)).toBeNull();
    expect(headerSummary([{ file: 'x', tables: [], missingRequired: [], missingOptional: [], unexpected: [], unexpectedCount: 0 }])).toEqual({ ok: true, text: 'All required columns found in 1 file.' });
    expect(headerSummary([{ file: 'x', tables: [], missingRequired: ['CUSIP'], missingOptional: [], unexpected: [], unexpectedCount: 0 }])!.ok).toBe(false);
  });
});

describe('map clusters', () => {
  it('groups nearby points and keeps far ones apart', () => {
    const pts = [{ x: 10, y: 10 }, { x: 20, y: 15 }, { x: 300, y: 300 }];
    const c = clusterPoints(pts, (p) => p, 48);
    expect(c.map((g) => g.items.length).sort()).toEqual([1, 2]);
    expect(c.find((g) => g.items.length === 2)).toMatchObject({ x: 15, y: 12.5 });
  });
});
