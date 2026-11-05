import { describe as group, expect, it } from 'vitest';
import { allIndicators, getIndicator } from '../indicators/library';
import { TIMEFRAMES } from '../types';
import { BUCKETS, TUNING, bucketOf, describe, recommend, scaleLookbacks, timeframeWords } from './tuning';

const def = (id: string) => getIndicator(id)!;

group('bucketOf', () => {
  it('maps every timeframe to a bucket', () => {
    expect(bucketOf('5s')).toBe('1m');
    expect(bucketOf('3m')).toBe('1m');
    expect(bucketOf('5m')).toBe('5m');
    expect(bucketOf('10m')).toBe('5m');
    expect(bucketOf('15m')).toBe('15m');
    expect(bucketOf('45m')).toBe('15m');
    expect(bucketOf('1h')).toBe('1h');
    expect(bucketOf('4h')).toBe('1h');
    expect(bucketOf('1D')).toBe('1D');
    expect(bucketOf('1W')).toBe('1W');
    expect(bucketOf('1M')).toBe('1W');
    for (const tf of TIMEFRAMES) expect(BUCKETS).toContain(bucketOf(tf));
  });
});

group('the tuning table', () => {
  it('only names real indicators and real inputs, inside their min/max', () => {
    for (const [id, row] of Object.entries(TUNING)) {
      const d = getIndicator(id);
      expect(d, id).toBeTruthy();
      for (const [bucket, params] of Object.entries(row.by)) {
        expect(BUCKETS).toContain(bucket);
        for (const [key, value] of Object.entries(params!)) {
          const input = d!.inputs.find((i) => i.key === key);
          expect(input, `${id}.${key}`).toBeTruthy();
          if (input!.type === 'number' && typeof value === 'number') {
            expect(value).toBeGreaterThanOrEqual(input!.min ?? -Infinity);
            expect(value).toBeLessThanOrEqual(input!.max ?? Infinity);
          }
        }
      }
      for (const preferred of Object.values(row.prefer ?? {})) expect(getIndicator(preferred!), preferred).toBeTruthy();
    }
  });

  it('covers the main momentum, trend, volatility and volume families', () => {
    for (const id of ['rsi', 'stoch', 'macd', 'roc', 'cci', 'willr', 'cmo', 'tsi', 'ppo', 'adx', 'bb', 'keltner', 'atr', 'vwap', 'emacloud']) expect(TUNING[id], id).toBeTruthy();
  });

  it('gives the documented RSI and MACD settings', () => {
    expect(recommend(def('rsi'), '5m').params.length).toBe(9);
    expect(recommend(def('rsi'), '1m').params.length).toBe(7);
    expect(recommend(def('rsi'), '1D').params.length).toBe(14);
    expect(recommend(def('macd'), '5m').params).toMatchObject({ fast: 8, slow: 17, signal: 9, source: 'close' });
    expect(recommend(def('macd'), '1D').params).toMatchObject({ fast: 12, slow: 26, signal: 9 });
    expect(recommend(def('rsi'), '5m').source).toBe('table');
    expect(recommend(def('rsi'), '5m').why).toMatch(/rule of thumb/);
  });

  it('suggests rolling VWAP instead of session VWAP on daily bars', () => {
    expect(recommend(def('vwap'), '1D').prefer).toBe('vwaprolling');
    expect(recommend(def('vwap'), '5m').prefer).toBeUndefined();
  });
});

group('the fallback rule', () => {
  it('shortens lookbacks on short bars, keeps multipliers and small smoothing values, and respects min/max', () => {
    const trix = def('trix');
    expect(scaleLookbacks(trix, '5m').length).toBe(Math.round(18 * 0.65));
    expect(scaleLookbacks(trix, '1D').length).toBe(18);
    const sq = def('squeeze');
    const p = scaleLookbacks(sq, '1m');
    expect(p.mult).toBe(2);
    expect(p.kcMult).toBe(1.5);
    expect(p.length).toBe(10);
  });

  it('every indicator gets valid settings on every timeframe', () => {
    for (const d of allIndicators()) {
      for (const tf of ['1m', '5m', '15m', '1h', '1D', '1W'] as const) {
        const { params } = recommend(d, tf);
        for (const i of d.inputs) {
          const v = params[i.key];
          expect(v, `${d.id}.${i.key}`).not.toBeUndefined();
          if (i.type === 'number') {
            expect(v as number).toBeGreaterThanOrEqual(i.min ?? -Infinity);
            expect(v as number).toBeLessThanOrEqual(i.max ?? Infinity);
          }
        }
      }
    }
  });

  it('names timeframes in words', () => {
    expect(timeframeWords('5m')).toBe('5-minute');
    expect(timeframeWords('1h')).toBe('1-hour');
    expect(timeframeWords('1D')).toBe('daily');
    expect(timeframeWords('30s')).toBe('30-second');
  });

  it('describes settings briefly', () => {
    expect(describe(def('rsi'), { length: 9, source: 'close' })).toBe('RSI(9)');
    expect(describe(def('vwap'), {})).toBe('VWAP');
  });
});
