import { describe, expect, it } from 'vitest';
import { ema, rsi, sma } from '../indicators/math';
import type { Bar } from '../types';
import { compileScript } from './interpreter';

const bars: Bar[] = Array.from({ length: 200 }, (_, i) => {
  const close = 100 + Math.sin(i / 6) * 8 + i * 0.05;
  return { time: 1_700_000_000 + i * 3600, open: close - 0.5, high: close + 1, low: close - 1, close, volume: 1000 + i };
});
const closes = bars.map((b) => b.close);
const same = (a: number[], b: number[]) => a.every((v, i) => (Number.isNaN(v) ? Number.isNaN(b[i]) : Math.abs(v - b[i]) < 1e-9));

describe('script engine', () => {
  it('runs a TradingView-style RSI script with inputs and levels', () => {
    const script = compileScript(`//@version=5
indicator("My RSI", overlay=false)
len = input.int(14, "Length", minval=1)
src = input.source(close, "Source")
r = ta.rsi(src, len)
plot(r, "RSI", color=color.purple, linewidth=2)
hline(70, "Overbought")
hline(30)`);
    expect(script.name).toBe('My RSI');
    expect(script.overlay).toBe(false);
    expect(script.inputs.map((i) => [i.label, i.default])).toEqual([['Length', 14], ['Source', 'close']]);
    expect(script.levels).toEqual([70, 30]);
    expect(script.plots[0]).toMatchObject({ title: 'RSI', color: '#9c27b0', lineWidth: 2 });
    expect(same(script.run(bars, {}).p0, rsi(closes, 14))).toBe(true);
    expect(same(script.run(bars, { in0: 7 }).p0, rsi(closes, 7))).toBe(true);
  });

  it('supports tuples, history, ternaries, crossovers and one-line functions', () => {
    const script = compileScript(`indicator("Test", overlay=true)
[macdLine, signal, hist] = ta.macd(close, 12, 26, 9)
up = close > close[1] ? 1 : -1
double(x) => x * 2
crossUp = ta.crossover(ta.sma(close, 5), ta.sma(close, 20))
plot(hist)
plot(up)
plot(double(sma(close, 3)))
plot(crossUp, style=plot.style_histogram)`);
    const out = script.run(bars, {});
    const macd = ema(closes, 12).map((f, i) => f - ema(closes, 26)[i]);
    const signal = ema(macd, 9);
    expect(same(out.p0, macd.map((m, i) => m - signal[i]))).toBe(true);
    expect(out.p1.slice(1, 4)).toEqual(closes.slice(1, 4).map((c, i) => (c > closes[i] ? 1 : -1)));
    expect(same(out.p2, sma(closes, 3).map((v) => v * 2))).toBe(true);
    expect(script.plots[3].type).toBe('histogram');
    expect(out.p3.some((v) => v === 1)).toBe(true);
  });

  it('gives clear errors with line numbers', () => {
    expect(() => compileScript('indicator("x")\nplot(ta.nope(close))')).toThrow(/Line 2: The function ta.nope\(\) isn't supported yet/);
    expect(() => compileScript('indicator("x")\nif close > open\n    plot(close)')).toThrow(/Line 2: "if" blocks aren't supported yet/);
    expect(() => compileScript('indicator("x")\nplot(foo)')).toThrow(/Line 2: Unknown name "foo"/);
    expect(() => compileScript('strategy("x")')).toThrow(/Strategies aren't supported yet/);
    expect(() => compileScript('indicator("x")\nx = 1')).toThrow(/doesn't plot anything/);
  });

  it('turns plotshape into chart signals', () => {
    const script = compileScript(`indicator("Sig", overlay=true)
plot(close)
plotshape(ta.crossover(ta.sma(close, 5), ta.sma(close, 20)), "Buy", style=shape.arrowup, location=location.belowbar, color=color.green, text="Buy")`);
    expect(script.plots[1]).toMatchObject({ type: 'marker', marker: { shape: 'arrowUp', position: 'belowBar', text: 'Buy' }, color: '#4caf50' });
    expect(script.run(bars, {}).p1.some((v) => v === 1)).toBe(true);
  });

  it('handles colours and multi-line calls', () => {
    const script = compileScript(`indicator("Colors")
plot(close,
     title = "Close",
     color = color.new(color.red, 50))`);
    expect(script.plots[0].color).toBe('#f2364580');
  });
});
