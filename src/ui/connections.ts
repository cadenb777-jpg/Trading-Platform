/**
 * Settings > Data connections: one row per free data source (and the AI key), each saying what it unlocks, where
 * to get a free key, the free-tier limit, a masked key box, a Test button (one cheap real call made by the helper)
 * and a status dot. Keys go straight to the helper and are never sent back: the browser only learns "saved".
 * Saving a key switches the matching features on at once (cached replies for them are dropped).
 */
import { clearEngineCache, engineRequest, worldReady } from '../data/schwab';
import { h, toast } from './dom';
import type { PlatformSettings } from './settings';

export interface ConnectionField {
  /** settings.set field name (the helper's existing names). */
  field: string;
  label: string;
  placeholder: string;
  /** The SEC email is shown again (it's not a secret); keys never are. */
  secret: boolean;
}

export interface Connection {
  id: 'fred' | 'bea' | 'bls' | 'eia' | 'census' | 'finnhub' | 'alpaca' | 'ai' | 'sec';
  name: string;
  /** What it switches on, in plain words. */
  unlocks: string;
  signup: string;
  signupLabel: string;
  limit: string;
  /** No key needed for the basics (the key only adds more). */
  optional: boolean;
  fields: ConnectionField[];
  /** Whether it is saved, from the settings flags (undefined = this helper doesn't know the connection). */
  isSet(s: PlatformSettings): boolean | undefined;
  /** Engine cache prefixes to drop when it changes, so pages ask again with the key. */
  refreshes: string[];
}

const key = (field: string, label: string, placeholder: string): ConnectionField => ({ field, label, placeholder, secret: true });

export const CONNECTIONS: Connection[] = [
  {
    id: 'ai', name: 'Anthropic (AI assistant)', optional: false,
    unlocks: 'The AI assistant, AI summary buttons and statement reading. Paid per use (not free): usually a few dollars a month.',
    signup: 'https://console.anthropic.com/settings/keys', signupLabel: 'Get a key', limit: 'Pay as you go; add a little credit under Billing',
    fields: [key('aiKey', 'Anthropic API key', 'sk-ant-…')], isSet: (s) => s.aiKeySet, refreshes: ['ai.'],
  },
  {
    id: 'sec', name: 'SEC EDGAR (contact email)', optional: false,
    unlocks: 'Company financials, insider trades, 13F holders and private-fund filings. No key: the SEC only asks for a contact email.',
    signup: 'https://www.sec.gov/os/accessing-edgar-data', signupLabel: 'SEC fair-access rules', limit: 'Up to 10 requests a second',
    fields: [{ field: 'secContact', label: 'Contact email', placeholder: 'you@example.com', secret: false }], isSet: (s) => !!s.secContact, refreshes: ['research.', 'sec.', 'alts.'],
  },
  {
    id: 'fred', name: 'FRED (St. Louis Fed)', optional: true,
    unlocks: 'Macro works without it; the key makes economic data load faster and more reliably.',
    signup: 'https://fredaccount.stlouisfed.org/apikeys', signupLabel: 'Get a free key', limit: '120 requests a minute',
    fields: [key('fredKey', 'FRED API key', '32 letters and numbers')], isSet: (s) => s.fredKeySet, refreshes: ['macro.', 'bonds.'],
  },
  {
    id: 'bea', name: 'BEA (GDP and PCE)', optional: false,
    unlocks: 'Macro > World: US GDP by component (what drove growth) and the PCE price index, the Fed’s inflation gauge.',
    signup: 'https://apps.bea.gov/API/signup/', signupLabel: 'Get a free key', limit: '100 requests and 100 MB a minute',
    fields: [key('beaKey', 'BEA user ID', '36 characters, from the BEA email')], isSet: (s) => s.beaKeySet, refreshes: ['world.'],
  },
  {
    id: 'bls', name: 'BLS (prices and jobs)', optional: true,
    unlocks: 'Macro > World works without it (CPI parts, wages, job openings, payrolls). The key adds more series and lifts the daily limit.',
    signup: 'https://data.bls.gov/registrationEngine/', signupLabel: 'Get a free key', limit: 'With key: 500 requests a day, 50 series each (no key: 25 a day)',
    fields: [key('blsKey', 'BLS registration key', '32 letters and numbers')], isSet: (s) => s.blsKeySet, refreshes: ['world.'],
  },
  {
    id: 'eia', name: 'EIA (oil and gasoline)', optional: false,
    unlocks: 'Macro > World: weekly US crude and gasoline inventories, WTI and pump prices.',
    signup: 'https://www.eia.gov/opendata/register.php', signupLabel: 'Get a free key', limit: 'Free; heavy use may be slowed down',
    fields: [key('eiaKey', 'EIA API key', '40 letters and numbers')], isSet: (s) => s.eiaKeySet, refreshes: ['world.'],
  },
  {
    id: 'census', name: 'Census (retail sales)', optional: true,
    unlocks: 'Macro > World works without it (retail sales). The key lifts the no-key daily limit.',
    signup: 'https://api.census.gov/data/key_signup.html', signupLabel: 'Get a free key', limit: 'No key: 500 requests a day; with key: no daily cap for normal use',
    fields: [key('censusKey', 'Census API key', '40 letters and numbers')], isSet: (s) => s.censusKeySet, refreshes: ['world.'],
  },
  {
    id: 'finnhub', name: 'Finnhub (analysts and earnings)', optional: false,
    unlocks: 'Analyst buy/hold/sell views on a stock’s overview (DES) and an earnings calendar on the Calendar page.',
    signup: 'https://finnhub.io/register', signupLabel: 'Get a free key', limit: '60 requests a minute (free plan)',
    fields: [key('finnhubKey', 'Finnhub API key', '20 letters and numbers')], isSet: (s) => s.finnhubKeySet, refreshes: ['finnhub.'],
  },
  {
    id: 'alpaca', name: 'Alpaca (price history)', optional: true,
    unlocks: 'Intraday history back to 2016 for charts, the hourly Setups scanner and the AI. Market data only, never trading.',
    signup: 'https://app.alpaca.markets/signup', signupLabel: 'Get free keys', limit: '200 requests a minute (free plan)',
    fields: [key('alpacaKeyId', 'API key ID', 'API key ID'), key('alpacaSecret', 'Secret key', 'Secret key')], isSet: (s) => s.alpacaSet, refreshes: ['alpaca.'],
  },
];

/** Sources that need no key and already work. */
export const NO_KEY_SOURCES = ['World Bank', 'IMF', 'OECD', 'ECB', 'US Treasury', 'SEC', 'Polymarket', 'Kalshi'];

export type TestState = { ok: boolean; message: string } | 'testing' | null;

export interface RowModel {
  dot: 'ok' | 'bad' | 'off' | 'testing';
  status: string;
  placeholders: string[];
  canTest: boolean;
  canRemove: boolean;
  /** Shown under the row (test result, or why the row is read-only). */
  message: string;
  /** False when the connected helper doesn't know this connection yet. */
  supported: boolean;
}

/** Everything a row shows, from the saved flags and the last test (pure, so it can be tested). */
export function rowModel(c: Connection, s: PlatformSettings, test: TestState = null, testable = true): RowModel {
  const set = c.isSet(s);
  const supported = set !== undefined;
  const placeholders = c.fields.map((f) => (f.secret ? (set ? 'Saved ✓ (paste a new one to replace it)' : f.placeholder) : f.placeholder));
  if (!supported)
    return { dot: 'off', status: 'Needs the updated helper', placeholders, canTest: false, canRemove: false, supported, message: 'Download the project ZIP again and restart the helper to use this.' };
  const canTest = !!set && testable;
  if (test === 'testing') return { dot: 'testing', status: 'Testing…', placeholders, canTest: false, canRemove: !!set, supported, message: '' };
  if (test) return { dot: test.ok ? 'ok' : 'bad', status: test.ok ? '✓ Connected' : '✗ Not working', placeholders, canTest, canRemove: !!set, supported, message: test.message };
  return {
    dot: set ? 'ok' : 'off',
    status: set ? (c.id === 'sec' ? '● Set' : '● Saved') : c.optional ? '○ Optional, not set' : '○ Not set',
    placeholders, canTest, canRemove: !!set && c.id !== 'sec', supported, message: '',
  };
}

export interface RowDeps {
  save(changes: Record<string, string>): Promise<PlatformSettings>;
  refresh(): void;
}

const lastTest = new Map<string, TestState>();

async function runTest(c: Connection): Promise<{ ok: boolean; message: string }> {
  if (c.id === 'alpaca') {
    const r = await engineRequest<{ ok: boolean; message: string }>('alpaca.status', {}, 20000);
    return { ok: r.ok, message: r.message };
  }
  return engineRequest<{ ok: boolean; message: string }>('connections.test', { connection: c.id }, 25000);
}

/** One connection's row. */
export function connectionRow(c: Connection, s: PlatformSettings, deps: RowDeps): HTMLElement {
  const testable = c.id === 'alpaca' || worldReady();
  const m = rowModel(c, s, lastTest.get(c.id) ?? null, testable);
  const inputs = c.fields.map((f, i) =>
    h('input', {
      class: 'input', type: f.secret ? 'password' : 'email', placeholder: m.placeholders[i], autocomplete: 'off', spellcheck: false,
      'aria-label': `${c.name}: ${f.label}`, value: f.secret ? undefined : s.secContact || undefined, disabled: !m.supported,
    }),
  );
  const rerender = () => deps.refresh();
  const save = async () => {
    const changes: Record<string, string> = {};
    c.fields.forEach((f, i) => {
      const v = inputs[i].value.trim();
      if (v || !f.secret) changes[f.field] = v;
    });
    if (c.fields.length > 1 && !c.isSet(s) && Object.keys(changes).length < c.fields.length) return toast(`Paste both: ${c.fields.map((f) => f.label).join(' and ')}`);
    if (!Object.keys(changes).length) return toast('Paste the key first');
    try {
      await deps.save(changes);
      for (const p of c.refreshes) clearEngineCache(p);
      window.dispatchEvent(new CustomEvent('tp:data-connection', { detail: { id: c.id } }));
      lastTest.delete(c.id);
      toast('Saved. Testing…');
      rerender();
      if (testable) void test();
    } catch (err) {
      toast((err as Error).message);
    }
  };
  const test = async () => {
    lastTest.set(c.id, 'testing');
    rerender();
    try {
      lastTest.set(c.id, await runTest(c));
    } catch (err) {
      lastTest.set(c.id, { ok: false, message: (err as Error).message });
    }
    rerender();
  };
  const remove = async () => {
    try {
      await deps.save(Object.fromEntries(c.fields.map((f) => [f.field, ''])));
      for (const p of c.refreshes) clearEngineCache(p);
      window.dispatchEvent(new CustomEvent('tp:data-connection', { detail: { id: c.id } }));
      lastTest.delete(c.id);
      rerender();
    } catch (err) {
      toast((err as Error).message);
    }
  };
  return h(
    'div',
    { class: 'settings-row dc-row', 'data-connection': c.id },
    h(
      'div',
      { class: 'settings-label dc-head' },
      h('span', { class: `dc-dot dc-${m.dot}`, 'aria-hidden': 'true' }),
      h('b', {}, c.name),
      h('span', { class: `key-status ${m.dot === 'ok' ? 'ok' : ''}`, role: 'status' }, m.status),
    ),
    h('p', { class: 'muted small dc-unlocks' }, c.unlocks),
    h(
      'p',
      { class: 'small dc-meta' },
      h('a', { href: c.signup, target: '_blank', rel: 'noopener' }, `${c.signupLabel} ↗`),
      h('span', { class: 'muted' }, ` · Free tier: ${c.limit}`),
    ),
    ...inputs.slice(0, -1).map((i) => h('div', { class: 'ap-controls' }, i)),
    h(
      'div',
      { class: 'ap-controls' },
      inputs[inputs.length - 1],
      h('button', { class: 'btn primary', onclick: save, disabled: !m.supported }, 'Save'),
      h('button', { class: 'btn', onclick: test, disabled: !m.canTest, title: m.canTest ? 'One small real request to check the key' : 'Save a key first' }, 'Test'),
      m.canRemove ? h('button', { class: 'btn', onclick: remove }, 'Remove') : null,
    ),
    m.message ? h('p', { class: `small dc-result ${m.dot === 'bad' ? 'down' : m.dot === 'ok' ? 'up' : 'muted'}` }, m.message) : null,
  );
}

/** The whole section: heading, the no-key sources line and one row per connection. */
export function dataConnectionsSection(s: PlatformSettings, deps: RowDeps): HTMLElement[] {
  return [
    h('h3', { class: 'settings-section', id: 'settings-data' }, 'Data connections'),
    h(
      'p',
      { class: 'muted small dc-intro' },
      'Paste each free key once you have made the account; the matching features switch on as soon as it is saved. Keys are kept by the helper on this computer and are never shown again or sent to this page.',
    ),
    h('p', { class: 'small dc-nokey' }, h('b', {}, 'Already working, no key needed: '), NO_KEY_SOURCES.join(', '), '.'),
    ...CONNECTIONS.map((c) => connectionRow(c, s, deps)),
  ];
}
