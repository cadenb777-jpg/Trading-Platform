import { describe, expect, it } from 'vitest';
import { alertStatus, deliverySummary, describeAlert, formAlert, managedOnSetups, type HelperAlert } from './alertsLogic';

const base: HelperAlert = { id: 'a1', kind: 'price', symbol: 'AAPL', condition: 'above', price: 200, note: '', repeat: false, active: true, created: 0 };

describe('helper alerts in the browser', () => {
  it('describes each kind in plain words', () => {
    expect(describeAlert(base)).toBe('AAPL rises to $200.00');
    expect(describeAlert({ ...base, condition: 'below', price: 1234.5 })).toBe('AAPL falls to $1,234.50');
    expect(describeAlert({ ...base, kind: 'move', condition: 'either', pct: 3 })).toBe('AAPL up or down 3% on the day');
    expect(describeAlert({ ...base, kind: 'setup', setup: { symbol: 'NVDA', direction: -1, tier: 'A' } })).toBe('NVDA SELL setup (A) reaches its entry');
    expect(describeAlert({ ...base, kind: 'setups_ab' })).toBe('Any A or B setup reaches its entry');
  });

  it('shows watching, fired and ended', () => {
    const now = Date.UTC(2026, 9, 26, 15);
    expect(alertStatus(base, now).text).toBe('Watching');
    const fired = alertStatus({ ...base, active: false, ended: 'fired', firedAt: now / 1000 - 60, firedPrice: 201 }, now);
    expect(fired.text).toMatch(/^Fired .* at \$201\.00$/);
    expect(fired.tone).toBe('up');
    expect(alertStatus({ ...base, active: false, ended: 'Stop level hit: the setup failed' }, now).text).toBe('Ended: Stop level hit: the setup failed');
    expect(alertStatus({ ...base, repeat: true, firedAt: now / 1000 - 60 }, now).text).toContain('watching again (repeat)');
  });

  it('puts failed deliveries first', () => {
    expect(deliverySummary(undefined)).toEqual({ text: '', failed: false });
    const d = deliverySummary({ ntfy: 'ok', telegram: 'answered 400 chat not found', browser: 'no tab open' });
    expect(d.failed).toBe(true);
    expect(d.text).toBe('Telegram ✗ answered 400 chat not found · ntfy ✓ · Tabs: no tab open');
    expect(deliverySummary({ ntfy: 'ok', browser: '1 tab' }).failed).toBe(false);
  });

  it('builds the save request from the form and refuses bad values', () => {
    expect(formAlert(' aapl ', 'below', 150, ' dip ', true)).toEqual({ kind: 'price', symbol: 'AAPL', condition: 'below', price: 150, note: 'dip', repeat: true });
    expect(formAlert('MSFT', 'up', 3, '', false, 'x1')).toEqual({ id: 'x1', kind: 'move', symbol: 'MSFT', condition: 'up', pct: 3, note: '', repeat: false });
    expect(() => formAlert('AAPL', 'above', NaN, '', false)).toThrow(/price/);
    expect(() => formAlert('AAPL', 'down', 150, '', false)).toThrow(/100%/);
  });

  it('leaves the all-setups alert to the Setups page', () => {
    expect(managedOnSetups({ kind: 'setups_ab' })).toBe(true);
    expect(managedOnSetups({ kind: 'setup' })).toBe(false);
  });
});
