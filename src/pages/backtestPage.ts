/** Backtest: try a trading strategy on past prices, with costs, and compare it with just buying and holding. */
import { backtest } from '../backtest/engine';
import { STRATEGIES } from '../backtest/strategies';
import { getProvider } from '../data';
import { guessMarket } from '../data/quotes';
import type { Timeframe } from '../types';
import { createLineChart, dataTable, money, numberField, pageFrame, pct, statCards } from '../ui/charts';
import { formatPrice, h } from '../ui/dom';
import { displaySymbol } from '../ui/watchlist';

const TIMEFRAMES: Timeframe[] = ['1D', '1W', '1h', '15m', '5m'];
const ratio = (v: number | null | undefined) => (v == null ? '—' : Number.isFinite(v) ? v.toFixed(2) : '∞');
const date = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

export function createBacktestPage() {
  let strategy = STRATEGIES[0];
  let params: Record<string, number> = {};
  const opts = { capital: 10000, positionSize: 1, commission: 0.0005, slippage: 0.0005, stopLoss: 0, takeProfit: 0, allowShort: false };
  const symbolInput = h('input', { class: 'input symbol', value: 'SPY', 'aria-label': 'Symbol', spellcheck: false });
  const tfSelect = h('select', { class: 'input', 'aria-label': 'Timeframe' }, ...TIMEFRAMES.map((t) => h('option', { value: t }, t === '1D' ? 'Daily' : t === '1W' ? 'Weekly' : t)));
  const stratSelect = h('select', { class: 'input', 'aria-label': 'Strategy' }, ...STRATEGIES.map((s) => h('option', { value: s.id }, s.name)));
  const runBtn = h('button', { class: 'btn primary', onclick: () => run() }, 'Run backtest');
  const frame = pageFrame('Backtest', 'Test a strategy on history before risking money. Signals on a bar’s close are traded at the next bar’s open.', [symbolInput, tfSelect, stratSelect, runBtn]);
  const settings = h('section', { class: 'panel' });
  const results = h('div', { class: 'ap-body' });
  frame.body.replaceChildren(settings, results);
  symbolInput.addEventListener('keydown', (e) => e.key === 'Enter' && run());
  stratSelect.addEventListener('change', () => {
    strategy = STRATEGIES.find((s) => s.id === stratSelect.value) ?? STRATEGIES[0];
    renderSettings();
  });

  function renderSettings() {
    params = Object.fromEntries(strategy.params.map((p) => [p.key, p.default]));
    const short = h('input', { type: 'checkbox', checked: opts.allowShort });
    short.addEventListener('change', () => (opts.allowShort = short.checked));
    settings.replaceChildren(
      h('div', { class: 'panel-head' }, h('h3', {}, strategy.name)),
      h('p', { class: 'muted' }, strategy.description),
      h('div', { class: 'field-grid' }, ...strategy.params.map((p) => numberField(p.label, p.default, (v) => (params[p.key] = v), { step: p.step }))),
      h('h4', {}, 'Money and costs'),
      h(
        'div',
        { class: 'field-grid' },
        numberField('Starting capital ($)', opts.capital, (v) => (opts.capital = v)),
        numberField('Position size (% of equity)', opts.positionSize, (v) => (opts.positionSize = v), { percent: true, step: 5 }),
        numberField('Commission per trade', opts.commission, (v) => (opts.commission = v), { percent: true, step: 0.01, hint: 'Webull charges no stock commission, but regulatory fees apply on sales' }),
        numberField('Slippage per trade', opts.slippage, (v) => (opts.slippage = v), { percent: true, step: 0.01, hint: 'The gap between the price you see and the price you get' }),
        numberField('Stop-loss (0 = off)', opts.stopLoss, (v) => (opts.stopLoss = v), { percent: true }),
        numberField('Take-profit (0 = off)', opts.takeProfit, (v) => (opts.takeProfit = v), { percent: true }),
        h('label', { class: 'field' }, h('span', { class: 'muted small' }, 'Short selling'), h('span', { class: 'field-input' }, short, h('span', {}, 'Also bet on falls'))),
      ),
    );
  }

  async function run() {
    const ref = guessMarket(symbolInput.value.trim());
    if (!ref) return;
    const tf = tfSelect.value as Timeframe;
    results.replaceChildren(h('div', { class: 'muted pad' }, `Loading ${displaySymbol(ref.symbol)} history…`));
    try {
      const bars = await getProvider(ref.provider).loadHistory(ref.symbol, tf, new AbortController().signal);
      if (bars.length < 50) throw new Error('Not enough history for a backtest.');
      const signals = strategy.signals(bars, params, opts.allowShort);
      const r = backtest(bars, signals, { ...opts, stopLoss: opts.stopLoss || undefined, takeProfit: opts.takeProfit || undefined });
      const s = r.stats;
      const curve = h('div', {});
      results.replaceChildren(
        h('p', { class: 'muted small' }, `${displaySymbol(ref.symbol)} · ${bars.length} bars from ${date(bars[0].time)} to ${date(bars[bars.length - 1].time)}`),
        statCards([
          { label: 'Strategy return', value: pct(s.totalReturn, 1), hint: s.cagr != null ? `${pct(s.cagr, 1)} a year` : '', tone: s.totalReturn >= 0 ? 'up' : 'down' },
          { label: 'Buy and hold', value: pct(s.buyHoldReturn, 1), tone: s.buyHoldReturn >= 0 ? 'up' : 'down' },
          { label: 'Max drawdown', value: pct(s.maxDrawdown, 1), tone: 'down' },
          { label: 'Sharpe ratio', value: ratio(s.sharpe) },
          { label: 'Trades', value: String(s.trades), hint: `In the market ${(s.exposure * 100).toFixed(0)}% of the time` },
          { label: 'Win rate', value: s.winRate == null ? '—' : `${(s.winRate * 100).toFixed(0)}%` },
          { label: 'Profit factor', value: ratio(s.profitFactor), hint: 'Total won ÷ total lost. Above 1.5 is good.' },
          { label: 'Average trade', value: pct(s.avgTrade, 2), hint: `Wins ${pct(s.avgWin, 1)} · losses ${pct(s.avgLoss, 1)}` },
          { label: 'Costs paid', value: money(s.costs) },
        ]),
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Equity curve')), curve),
        h(
          'section',
          { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h3', {}, 'Trades'), h('span', { class: 'muted small' }, 'Newest first')),
          r.trades.length
            ? dataTable(
                ['Side', 'Entry', 'Entry price', 'Exit', 'Exit price', 'Bars', 'Return', 'P&L', 'Exit reason'],
                [...r.trades].reverse().map((t) => [
                  { v: t.side === 'long' ? 'Long' : 'Short', cls: t.side === 'long' ? 'up' : 'down' },
                  date(t.entryTime),
                  formatPrice(t.entryPrice),
                  date(t.exitTime),
                  formatPrice(t.exitPrice),
                  String(t.bars),
                  { v: pct(t.returnPct, 2), cls: t.returnPct >= 0 ? 'up' : 'down' },
                  { v: money(t.pnl), cls: t.pnl >= 0 ? 'up' : 'down' },
                  t.reason === 'signal' ? 'Signal' : t.reason === 'stop' ? 'Stop-loss' : t.reason === 'target' ? 'Take-profit' : 'Still open at end',
                ]),
              )
            : h('p', { class: 'muted' }, 'No trades. Try different settings or a longer history.'),
        ),
        h('p', { class: 'ap-note' }, 'Backtests flatter strategies: they ignore taxes, can’t include every real-world cost, and settings tuned on the past often fail later. Paper trade before using real money.'),
      );
      const chart = createLineChart(curve, { height: 340, format: money });
      chart.set([
        { name: 'Strategy', color: '#2962ff', data: r.equity.map((e) => ({ time: e.time, value: e.value })) },
        { name: 'Buy and hold', color: '#9598a1', width: 1, data: r.buyHold },
      ]);
    } catch (err) {
      results.replaceChildren(h('div', { class: 'ap-error' }, (err as Error).message));
    }
  }

  renderSettings();
  return {
    el: frame.el,
    start() {},
  };
}
