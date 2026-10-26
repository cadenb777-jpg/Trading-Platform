/** Helper alerts (helper/engine/alerts.py) as the browser sees them, and the plain-words text shown for them. */

export type AlertKind = 'price' | 'move' | 'setup' | 'setups_ab';

export interface HelperAlert {
  id: string;
  kind: AlertKind;
  symbol: string;
  condition?: 'above' | 'below' | 'up' | 'down' | 'either';
  price?: number;
  pct?: number;
  note: string;
  repeat: boolean;
  active: boolean;
  created: number;
  /** Unix seconds (helper time). */
  firedAt?: number;
  firedPrice?: number;
  /** Why it stopped: 'fired', or e.g. 'Stop level hit: the setup failed'. */
  ended?: string;
  setupId?: string;
  setup?: { symbol: string; direction: number; tier?: string | null; strategyName?: string };
  lastDelivery?: { at: number; results: Record<string, string>; message: string };
}

export interface AlertsReply {
  alerts: HelperAlert[];
  channels: { ntfy: boolean; telegram: boolean };
}

/** The new-alert form's choices. */
export const ALERT_CHOICES = [
  { key: 'above', label: 'Price rises to', kind: 'price', unit: '$' },
  { key: 'below', label: 'Price falls to', kind: 'price', unit: '$' },
  { key: 'up', label: 'Up on the day by', kind: 'move', unit: '%' },
  { key: 'down', label: 'Down on the day by', kind: 'move', unit: '%' },
  { key: 'either', label: 'Moves either way by', kind: 'move', unit: '%' },
] as const;
export type AlertChoice = (typeof ALERT_CHOICES)[number]['key'];

const money = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: v >= 1 ? 2 : 4 })}`;

/** The alert in a few words, e.g. "AAPL rises to $200.00". */
export function describeAlert(a: HelperAlert): string {
  if (a.kind === 'price') return `${a.symbol} ${a.condition === 'below' ? 'falls to' : 'rises to'} ${money(a.price ?? 0)}`;
  if (a.kind === 'move') return `${a.symbol} ${a.condition === 'up' ? 'up' : a.condition === 'down' ? 'down' : 'up or down'} ${a.pct}% on the day`;
  if (a.kind === 'setup') return `${a.setup?.symbol ?? a.symbol} ${(a.setup?.direction ?? 1) > 0 ? 'BUY' : 'SELL'} setup${a.setup?.tier ? ` (${a.setup.tier})` : ''} reaches its entry`;
  return 'Any A or B setup reaches its entry';
}

/** Active, fired (when and at what price) or ended (why). */
export function alertStatus(a: HelperAlert, now = Date.now()): { text: string; tone: '' | 'up' | 'down' | 'muted' } {
  const when = (t: number) => {
    const d = new Date(t * 1000);
    return now - d.getTime() < 20 * 3600_000 ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };
  const fired = a.firedAt ? `Fired ${when(a.firedAt)}${a.firedPrice ? ` at ${money(a.firedPrice)}` : ''}` : '';
  if (a.active) return { text: fired ? `${fired} · watching again${a.repeat ? ' (repeat)' : ''}` : a.kind === 'setups_ab' ? 'Watching every A and B setup' : 'Watching', tone: fired ? 'up' : '' };
  if (a.ended && a.ended !== 'fired') return { text: `Ended: ${a.ended}`, tone: 'muted' };
  return { text: fired || 'Off', tone: fired ? 'up' : 'muted' };
}

/** "Phone (ntfy) ✓ · Telegram ✗ chat not found · 1 tab", for the alerts list. Failures come first. */
export function deliverySummary(results: Record<string, string> | undefined): { text: string; failed: boolean } {
  if (!results) return { text: '', failed: false };
  const names: Record<string, string> = { ntfy: 'ntfy', telegram: 'Telegram', browser: 'Tabs' };
  const parts = Object.entries(results)
    .filter(([k]) => k in names)
    .map(([k, v]) => ({ k, ok: v === 'ok' || k === 'browser', text: k === 'browser' ? `${names[k]}: ${v}` : v === 'ok' ? `${names[k]} ✓` : `${names[k]} ✗ ${v}` }))
    .sort((a, b) => Number(a.ok) - Number(b.ok));
  return { text: parts.map((p) => p.text).join(' · '), failed: parts.some((p) => !p.ok) };
}

/** What alerts.save needs for a price or day-move alert from the form. */
export function formAlert(symbol: string, choice: AlertChoice, value: number, note: string, repeat: boolean, id?: string): Record<string, unknown> {
  const c = ALERT_CHOICES.find((x) => x.key === choice)!;
  if (!Number.isFinite(value) || value <= 0) throw new Error(c.kind === 'move' ? 'Enter the % move' : 'Enter a price for the alert');
  if (c.kind === 'move' && value > 100) throw new Error('The move must be 100% or less');
  return { ...(id ? { id } : {}), kind: c.kind, symbol: symbol.trim().toUpperCase(), condition: choice, [c.kind === 'move' ? 'pct' : 'price']: value, note: note.trim(), repeat };
}

/** The form choice that matches a saved alert (to edit it). */
export const choiceOf = (a: HelperAlert): AlertChoice => (a.condition ?? 'above') as AlertChoice;


/** The "every A and B setup" alert is switched by the Setups page's "Alert me on A & B entries" box, not deleted here. */
export const managedOnSetups = (a: Pick<HelperAlert, 'kind'>) => a.kind === 'setups_ab';
