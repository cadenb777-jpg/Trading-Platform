/**
 * Family D, part 2: the 61 TA-Lib candlestick patterns, one marker indicator each, plus "All candlestick patterns".
 * The recognition is TA-Lib's own logic (d-talibCandles.ts, a literal port), so signals match TA-Lib bar for bar.
 * Bullish signals draw an up arrow under the bar, bearish ones a down arrow above it; patterns that only mean
 * indecision (doji, spinning top...) draw a dot above the bar.
 */
import type { Bar } from '../../types';
import type { IndicatorGuide } from '../info';
import type { IndicatorDef, IndicatorInput, IndicatorParams, PlotDef } from '../types';
import { runCdl } from './d-talibCandles';

const UP = '#26a69a';
const DOWN = '#ef5350';
const NEUTRAL = '#ffb300';

/** bull/bear = TA-Lib only gives that sign; both = either; neutral = indecision (shown as a dot whatever the sign). */
type Kind = 'bull' | 'bear' | 'both' | 'neutral';
/** reversal / continuation patterns, indecision candles, and single-candle shape/strength readings. */
export type PatternGroup = 'reversal' | 'continuation' | 'indecision' | 'candle';

export interface PatternInfo {
  talib: string;
  name: string;
  /** Marker text (short). */
  text: string;
  kind: Kind;
  group: PatternGroup;
  candles: number;
  what: string;
  signal: string;
  /** TA-Lib's default penetration, for the patterns that take one. */
  penetration?: number;
}

const P = (talib: string, name: string, text: string, kind: Kind, group: PatternGroup, candles: number, what: string, signal: string, penetration?: number): PatternInfo => ({
  talib,
  name,
  text,
  kind,
  group,
  candles,
  what,
  signal,
  penetration,
});

export const PATTERNS: PatternInfo[] = [
  P('CDL2CROWS', 'Two Crows', '2 Crows', 'bear', 'reversal', 3, 'A long white candle, then a black candle that gaps up, then a second black candle that opens inside the second body and closes inside the first body.', 'Bearish: the gap up failed twice; a top may be forming after a rise.'),
  P('CDL3BLACKCROWS', 'Three Black Crows', '3 Crows', 'bear', 'reversal', 3, 'Three falling black candles in a row (after a white one), each opening inside the prior body and closing near its low.', 'Bearish: steady selling after a rise; a strong sign of a top.'),
  P('CDL3INSIDE', 'Three Inside Up/Down', '3 Inside', 'both', 'reversal', 3, 'A harami (a long candle with a small candle inside its body) confirmed by a third candle closing beyond the first candle’s open.', 'Up version (after a fall) is bullish; down version (after a rise) is bearish. It is a confirmed harami.'),
  P('CDL3LINESTRIKE', 'Three-Line Strike', '3 Strike', 'both', 'continuation', 4, 'Three candles moving the same way, then a fourth opposite candle that wipes out all three (opens beyond the third close and closes beyond the first open).', 'TA-Lib signals in the direction of the first three candles (+ after three white, - after three black); traders debate it, so wait for the next bar.'),
  P('CDL3OUTSIDE', 'Three Outside Up/Down', '3 Outside', 'both', 'reversal', 3, 'An engulfing pattern confirmed by a third candle that closes further in the engulfing direction.', 'Up version is bullish, down version bearish: a confirmed engulfing.'),
  P('CDL3STARSINSOUTH', 'Three Stars in the South', '3 Stars S', 'bull', 'reversal', 3, 'In a fall: a long black candle with a long lower shadow, a smaller black candle with a higher low, then a small black candle with tiny shadows inside the second one’s range.', 'Bullish: each down day is weaker than the last; selling is drying up. Rare.'),
  P('CDL3WHITESOLDIERS', 'Three White Soldiers', '3 Soldiers', 'bull', 'reversal', 3, 'Three rising white candles in a row, each opening within or near the prior body and closing near its high, none much shorter than the last.', 'Bullish: steady buying, often the start of a new uptrend after a fall.'),
  P('CDLABANDONEDBABY', 'Abandoned Baby', 'Aband. Baby', 'both', 'reversal', 3, 'A long candle, a doji that gaps away from it (shadows do not touch), then a candle that gaps back the other way and closes well into the first body.', 'Bullish after a fall, bearish after a rise; a rare, strong reversal.', 0.3),
  P('CDLADVANCEBLOCK', 'Advance Block', 'Adv. Block', 'bear', 'reversal', 3, 'Three rising white candles where the bodies shrink and/or the upper shadows grow: the advance is losing strength.', 'Bearish warning in an uptrend: buyers are tiring; protect profits.'),
  P('CDLBELTHOLD', 'Belt-hold', 'Belt-hold', 'both', 'reversal', 1, 'One long candle that opens at its extreme: a white candle opening at its low (bullish) or a black candle opening at its high (bearish).', 'Bullish belt-hold after a fall, bearish after a rise; stronger when the body is very long.'),
  P('CDLBREAKAWAY', 'Breakaway', 'Breakaway', 'both', 'reversal', 5, 'A long candle, a gap in the same direction, two more candles continuing that way, then a long opposite candle closing inside the gap.', 'Bullish after a fall (closes back into the down gap), bearish after a rise.'),
  P('CDLCLOSINGMARUBOZU', 'Closing Marubozu', 'Cl. Marubozu', 'both', 'candle', 1, 'A long candle with no shadow at the close end: a white candle closing at its high or a black candle closing at its low.', '+ for white (buyers held control into the close), - for black (sellers did).'),
  P('CDLCONCEALBABYSWALL', 'Concealing Baby Swallow', 'Baby Swallow', 'bull', 'reversal', 4, 'In a fall: two black marubozu candles, a black candle that gaps down but trades up into the prior body, then a black candle that engulfs it, shadows included.', 'Bullish: sellers are exhausted despite the black candles. Very rare.'),
  P('CDLCOUNTERATTACK', 'Counterattack', 'Counter', 'both', 'reversal', 2, 'A long candle followed by a long opposite candle that closes at the same price as the first.', 'Bullish (white after black) or bearish (black after white): the second side fought back to even.'),
  P('CDLDARKCLOUDCOVER', 'Dark Cloud Cover', 'Dark Cloud', 'bear', 'reversal', 2, 'After a long white candle, a black candle opens above its high and closes deep into its body (more than half by default).', 'Bearish after a rise; stronger the deeper the close penetrates.', 0.5),
  P('CDLDOJI', 'Doji', 'Doji', 'neutral', 'indecision', 1, 'Open and close are almost equal (body under 10% of the average range).', 'Indecision: buyers and sellers are balanced. After a strong move it can warn of a turn.'),
  P('CDLDOJISTAR', 'Doji Star', 'Doji Star', 'both', 'reversal', 2, 'A long candle followed by a doji whose body gaps away from it in the trend’s direction.', 'Bearish after a long white candle, bullish after a long black one; confirm with the next bar.'),
  P('CDLDRAGONFLYDOJI', 'Dragonfly Doji', 'Dragonfly', 'bull', 'reversal', 1, 'A doji with open and close at the high and a long lower shadow: sellers pushed down but buyers took it all back.', 'Bullish after a fall (TA-Lib gives +100 wherever it appears).'),
  P('CDLENGULFING', 'Engulfing', 'Engulf', 'both', 'reversal', 2, 'A candle whose body completely covers the previous opposite-coloured body (TA-Lib gives 80 when only one end matches).', 'Bullish engulfing after a fall, bearish engulfing after a rise; one of the most watched patterns.'),
  P('CDLEVENINGDOJISTAR', 'Evening Doji Star', 'Eve. Doji', 'bear', 'reversal', 3, 'A long white candle, a doji that gaps up, then a black candle closing well into the white body.', 'Bearish top reversal after a rise.', 0.3),
  P('CDLEVENINGSTAR', 'Evening Star', 'Eve. Star', 'bear', 'reversal', 3, 'A long white candle, a small-bodied "star" that gaps up, then a black candle closing well into the white body.', 'Bearish top reversal after a rise.', 0.3),
  P('CDLGAPSIDESIDEWHITE', 'Side-by-Side White Lines', 'Side-by-side', 'both', 'continuation', 3, 'A gap followed by two white candles of similar size that open at about the same price, without closing the gap.', 'Continuation: bullish after an up gap, bearish after a down gap.'),
  P('CDLGRAVESTONEDOJI', 'Gravestone Doji', 'Gravestone', 'neutral', 'reversal', 1, 'A doji with open and close at the low and a long upper shadow: buyers pushed up but sellers took it all back.', 'Bearish after a rise (TA-Lib gives +100, so it is shown as a dot: read it by context).'),
  P('CDLHAMMER', 'Hammer', 'Hammer', 'bull', 'reversal', 1, 'A small body near the top of the range with a long lower shadow (at least twice the body) and little or no upper shadow, near the prior bar’s lows.', 'Bullish after a fall: sellers were rejected. Wait for a higher close to confirm.'),
  P('CDLHANGINGMAN', 'Hanging Man', 'Hang. Man', 'bear', 'reversal', 1, 'The hammer shape (small body, long lower shadow) appearing near the highs of the prior bar.', 'Bearish warning after a rise; needs a lower close next to confirm.'),
  P('CDLHARAMI', 'Harami', 'Harami', 'both', 'reversal', 2, 'A long candle followed by a small body that sits completely inside the first body (TA-Lib gives 80 when an edge is shared).', 'Bullish after a fall, bearish after a rise: the trend has paused. Confirmation helps.'),
  P('CDLHARAMICROSS', 'Harami Cross', 'Harami X', 'both', 'reversal', 2, 'A harami where the second candle is a doji inside the first long body.', 'Stronger than a plain harami: bullish after a fall, bearish after a rise.'),
  P('CDLHIGHWAVE', 'High-Wave Candle', 'High Wave', 'neutral', 'indecision', 1, 'A small body with very long upper and lower shadows.', 'Indecision: the market swung both ways. After a trend it can warn of a turn.'),
  P('CDLHIKKAKE', 'Hikkake', 'Hikkake', 'both', 'reversal', 3, 'An inside bar followed by a bar that breaks out of it (a "fake" breakout). ±100 marks the setup; ±200 marks confirmation when price closes back through the inside bar within 3 bars.', 'Bullish when the fake breakdown is reversed, bearish when a fake breakout is reversed.'),
  P('CDLHIKKAKEMOD', 'Modified Hikkake', 'Hikkake M', 'both', 'reversal', 4, 'A hikkake where the bar before the inside bar closes near its low (bullish) or high (bearish). ±200 = confirmed within 3 bars.', 'Same as hikkake with a stricter setup: bullish or bearish false-breakout trap.'),
  P('CDLHOMINGPIGEON', 'Homing Pigeon', 'Pigeon', 'bull', 'reversal', 2, 'A long black candle followed by a short black candle whose body is inside the first body.', 'Bullish after a fall: the selling is shrinking.'),
  P('CDLIDENTICAL3CROWS', 'Identical Three Crows', 'Ident. Crows', 'bear', 'reversal', 3, 'Three falling black candles, each opening at (or very near) the previous close and closing near its low.', 'Bearish: a strong, panicky decline after a rise.'),
  P('CDLINNECK', 'In-Neck', 'In-Neck', 'bear', 'continuation', 2, 'After a long black candle, a white candle opens below its low but closes only just inside its body.', 'Bearish continuation: the bounce was weak.'),
  P('CDLINVERTEDHAMMER', 'Inverted Hammer', 'Inv. Hammer', 'bull', 'reversal', 1, 'A small body at the bottom of the range with a long upper shadow and little lower shadow, gapping down from the prior body.', 'Bullish after a fall if the next bar confirms with a higher close.'),
  P('CDLKICKING', 'Kicking', 'Kicking', 'both', 'reversal', 2, 'A marubozu (no shadows) followed by an opposite-coloured marubozu that gaps away from it.', 'Bullish when a black marubozu is followed by a white one gapping up; bearish the other way. Very strong.'),
  P('CDLKICKINGBYLENGTH', 'Kicking (by length)', 'Kick (len)', 'both', 'reversal', 2, 'The kicking pattern, with bull or bear decided by whichever of the two marubozu candles is longer.', '+ when the longer marubozu is white, - when it is black.'),
  P('CDLLADDERBOTTOM', 'Ladder Bottom', 'Ladder', 'bull', 'reversal', 5, 'Three falling black candles, a fourth black candle with an upper shadow, then a white candle that gaps up and closes above the prior high.', 'Bullish bottom reversal after a fall.'),
  P('CDLLONGLEGGEDDOJI', 'Long-Legged Doji', 'Long Doji', 'neutral', 'indecision', 1, 'A doji with long upper and/or lower shadows.', 'Strong indecision; after a big move it can mark a turning point.'),
  P('CDLLONGLINE', 'Long Line Candle', 'Long Line', 'both', 'candle', 1, 'A candle with a long body and short shadows.', '+ for a long white candle (strong buying), - for a long black one (strong selling).'),
  P('CDLMARUBOZU', 'Marubozu', 'Marubozu', 'both', 'candle', 1, 'A long body with no or very short shadows on both ends.', '+ white marubozu = buyers controlled the whole bar; - black = sellers did.'),
  P('CDLMATCHINGLOW', 'Matching Low', 'Match Low', 'bull', 'reversal', 2, 'Two black candles that close at the same price.', 'Bullish after a fall: the same low held twice (support).'),
  P('CDLMATHOLD', 'Mat Hold', 'Mat Hold', 'bull', 'continuation', 5, 'A long white candle, a small black candle that gaps up, two more small candles that hold inside the white body, then a white candle closing at a new high.', 'Bullish continuation: the pause did not give back the gains.', 0.5),
  P('CDLMORNINGDOJISTAR', 'Morning Doji Star', 'Morn. Doji', 'bull', 'reversal', 3, 'A long black candle, a doji that gaps down, then a white candle closing well into the black body.', 'Bullish bottom reversal after a fall.', 0.3),
  P('CDLMORNINGSTAR', 'Morning Star', 'Morn. Star', 'bull', 'reversal', 3, 'A long black candle, a small-bodied "star" that gaps down, then a white candle closing well into the black body.', 'Bullish bottom reversal after a fall.', 0.3),
  P('CDLONNECK', 'On-Neck', 'On-Neck', 'bear', 'continuation', 2, 'After a long black candle, a white candle opens below its low and closes right at that low.', 'Bearish continuation: buyers could not get back into the black body.'),
  P('CDLPIERCING', 'Piercing', 'Piercing', 'bull', 'reversal', 2, 'After a long black candle, a long white candle opens below its low and closes above the middle of its body.', 'Bullish after a fall (the mirror of dark cloud cover).'),
  P('CDLRICKSHAWMAN', 'Rickshaw Man', 'Rickshaw', 'neutral', 'indecision', 1, 'A long-legged doji with the body near the middle of the range.', 'Pure indecision; wait for the next bars to show direction.'),
  P('CDLRISEFALL3METHODS', 'Rising/Falling Three Methods', '3 Methods', 'both', 'continuation', 5, 'A long candle, three small candles drifting against it inside its range, then a long candle closing beyond the first one.', 'Rising version is bullish continuation, falling version bearish continuation.'),
  P('CDLSEPARATINGLINES', 'Separating Lines', 'Sep. Lines', 'both', 'continuation', 2, 'Two opposite-coloured candles with the same open; the second is a belt-hold in the trend’s direction.', 'Continuation: bullish when the second is white, bearish when it is black.'),
  P('CDLSHOOTINGSTAR', 'Shooting Star', 'Shoot. Star', 'bear', 'reversal', 1, 'A small body at the bottom of the range with a long upper shadow, gapping up from the prior body.', 'Bearish after a rise: buyers were rejected at the highs.'),
  P('CDLSHORTLINE', 'Short Line Candle', 'Short Line', 'neutral', 'candle', 1, 'A candle with a short body and short shadows.', 'A quiet bar: little conviction either way (sign = candle colour).'),
  P('CDLSPINNINGTOP', 'Spinning Top', 'Spin Top', 'neutral', 'indecision', 1, 'A small body with shadows longer than the body on both sides.', 'Indecision; after a long trend it can be an early warning.'),
  P('CDLSTALLEDPATTERN', 'Stalled Pattern', 'Stalled', 'bear', 'reversal', 3, 'Two long white candles followed by a small white candle that opens near the top of the second body: the rally is stalling.', 'Bearish warning after a rise (also called deliberation).'),
  P('CDLSTICKSANDWICH', 'Stick Sandwich', 'Sandwich', 'bull', 'reversal', 3, 'Two black candles with the same close around a white candle that traded above the first close.', 'Bullish: the matching closes show support.'),
  P('CDLTAKURI', 'Takuri', 'Takuri', 'bull', 'reversal', 1, 'A dragonfly doji (open and close at the high) with a very long lower shadow.', 'Bullish after a fall: strong rejection of lower prices.'),
  P('CDLTASUKIGAP', 'Tasuki Gap', 'Tasuki', 'both', 'continuation', 3, 'A gap, a candle in the gap’s direction, then an opposite candle of similar size that closes inside the gap without filling it.', 'Continuation: bullish for an upside gap, bearish for a downside gap.'),
  P('CDLTHRUSTING', 'Thrusting', 'Thrusting', 'bear', 'continuation', 2, 'After a long black candle, a white candle opens below its low and closes inside its body but below the middle.', 'Bearish continuation (weaker than in-neck/on-neck, stronger bounce).'),
  P('CDLTRISTAR', 'Tristar', 'Tristar', 'both', 'reversal', 3, 'Three dojis in a row, the middle one gapping away from the other two.', 'Bullish at bottoms (middle doji gaps down), bearish at tops (gaps up). Rare.'),
  P('CDLUNIQUE3RIVER', 'Unique Three River', 'Unique 3', 'bull', 'reversal', 3, 'A long black candle, a black harami that makes a lower low, then a small white candle opening above that low.', 'Bullish bottom reversal after a fall. Rare.'),
  P('CDLUPSIDEGAP2CROWS', 'Upside Gap Two Crows', 'Gap 2 Crows', 'bear', 'reversal', 3, 'A white candle, a small black candle gapping up, then a larger black candle that engulfs it but still closes above the white close.', 'Bearish after a rise: the gap is being sold.'),
  P('CDLXSIDEGAP3METHODS', 'Upside/Downside Gap Three Methods', 'Gap 3 Meth.', 'both', 'continuation', 3, 'Two candles in the trend’s direction with a gap between them, then an opposite candle that closes the gap.', 'Continuation: bullish after an upside gap, bearish after a downside gap.'),
];

const penetrationInput = (def: number): IndicatorInput => ({ key: 'penetration', label: 'Penetration (share of the first body)', type: 'number', default: def, min: 0, max: 1, step: 0.05 });

/** Splits TA-Lib's +/- values into the bullish and bearish plots (or one indecision plot). */
function plotsFor(info: Pick<PatternInfo, 'kind' | 'text'>): PlotDef[] {
  if (info.kind === 'neutral') return [{ key: 'signal', title: 'Pattern', type: 'marker', color: NEUTRAL, marker: { shape: 'circle', position: 'aboveBar', text: info.text } }];
  const plots: PlotDef[] = [];
  if (info.kind !== 'bear') plots.push({ key: 'bull', title: 'Bullish', type: 'marker', color: UP, marker: { shape: 'arrowUp', position: 'belowBar', text: info.text } });
  if (info.kind !== 'bull') plots.push({ key: 'bear', title: 'Bearish', type: 'marker', color: DOWN, marker: { shape: 'arrowDown', position: 'aboveBar', text: info.text } });
  return plots;
}

/** TA-Lib's raw output for one pattern (+100/-100, Hikkake +-200, Engulfing/Harami +-80, 0 none). */
export function patternValues(info: PatternInfo, bars: Bar[], params: IndicatorParams = {}): number[] {
  const pen = info.penetration === undefined ? 0 : Number(params.penetration ?? info.penetration);
  return runCdl(
    info.talib,
    bars.map((b) => b.open),
    bars.map((b) => b.high),
    bars.map((b) => b.low),
    bars.map((b) => b.close),
    pen,
  );
}

const split = (values: number[]) => ({ bull: values.map((v) => (v > 0 ? v : 0)), bear: values.map((v) => (v < 0 ? v : 0)) });

export const patternId = (info: PatternInfo) => 'cdl_' + info.talib.slice(3).toLowerCase();

const GROUP_LABEL: Record<PatternGroup, string> = { reversal: 'reversal', continuation: 'continuation', indecision: 'indecision', candle: 'candle shape' };

export const CANDLE_DEFS: IndicatorDef[] = PATTERNS.map((info) => ({
  id: patternId(info),
  name: `${info.name} (candlestick)`,
  shortName: info.text,
  category: 'Candlestick Patterns',
  description: `${info.candles}-candle ${GROUP_LABEL[info.group]} pattern (TA-Lib ${info.talib}). ${info.signal}`,
  placement: 'overlay',
  inputs: info.penetration === undefined ? [] : [penetrationInput(info.penetration)],
  plots: plotsFor(info),
  compute: (bars, p): Record<string, number[]> => {
    const values = patternValues(info, bars, p);
    if (info.kind === 'neutral') return { signal: values };
    const { bull, bear } = split(values);
    return info.kind === 'bull' ? { bull } : info.kind === 'bear' ? { bear } : { bull, bear };
  },
}));

const toggle = (key: string, label: string, def: 0 | 1): IndicatorInput => ({ key, label, type: 'number', default: def, min: 0, max: 1, step: 1 });

/** Patterns the combined indicator would include for these filter settings. */
export function selectedPatterns(params: IndicatorParams): PatternInfo[] {
  const on = (k: string, def: number) => Number(params[k] ?? def) === 1;
  return PATTERNS.filter((info) => on(info.group, info.group === 'reversal' || info.group === 'continuation' ? 1 : 0) && (info.candles > 1 || on('single', 1)));
}

export const ALL_CANDLES_DEF: IndicatorDef = {
  id: 'cdl_all',
  name: 'All Candlestick Patterns',
  shortName: 'Candles',
  category: 'Candlestick Patterns',
  description: 'Every TA-Lib candlestick pattern on one layer, filtered by type. Value = how many patterns fired on the bar (bullish, bearish, indecision). Hover a single pattern indicator to see which one.',
  placement: 'overlay',
  inputs: [
    toggle('reversal', 'Reversal patterns (1 on, 0 off)', 1),
    toggle('continuation', 'Continuation patterns', 1),
    toggle('indecision', 'Indecision (doji, spinning top...)', 0),
    toggle('candle', 'Candle shapes (marubozu, long/short line)', 0),
    toggle('single', 'Include one-candle patterns', 1),
    toggle('bullish', 'Show bullish', 1),
    toggle('bearish', 'Show bearish', 1),
  ],
  plots: [
    { key: 'bull', title: 'Bullish patterns', type: 'marker', color: UP, marker: { shape: 'arrowUp', position: 'belowBar' } },
    { key: 'bear', title: 'Bearish patterns', type: 'marker', color: DOWN, marker: { shape: 'arrowDown', position: 'aboveBar' } },
    { key: 'neutral', title: 'Indecision', type: 'marker', color: NEUTRAL, marker: { shape: 'circle', position: 'aboveBar' } },
  ],
  compute: (bars, p) => {
    const n = bars.length;
    const bull = new Array<number>(n).fill(0);
    const bear = new Array<number>(n).fill(0);
    const neutral = new Array<number>(n).fill(0);
    const showBull = Number(p.bullish ?? 1) === 1;
    const showBear = Number(p.bearish ?? 1) === 1;
    for (const info of selectedPatterns(p)) {
      const values = patternValues(info, bars);
      values.forEach((v, i) => {
        if (!v) return;
        if (info.kind === 'neutral') neutral[i]++;
        else if (v > 0 && showBull) bull[i]++;
        else if (v < 0 && showBear) bear[i]++;
      });
    }
    return { bull, bear, neutral };
  },
};

const GROUP_USE: Record<PatternGroup, string[]> = {
  reversal: ['Look for it after a clear move: a bullish reversal matters after a fall, a bearish one after a rise.', 'Treat it as a warning, then wait for the next bar to confirm before acting.'],
  continuation: ['Look for it inside an existing trend: it suggests the pause is over and the trend goes on.', 'Use it to join or add to a trend, with a stop beyond the pattern.'],
  indecision: ['Read it as a pause: buyers and sellers are balanced.', 'Most useful after a long move or at support/resistance; in the middle of a range it means little.'],
  candle: ['Read it as a description of one bar’s strength rather than a trade signal.', 'Useful to confirm breakouts (a long white bar through resistance) or as part of bigger patterns.'],
};

const PATTERN_TIP = 'Candlestick patterns work best with context: the trend before them, support/resistance and volume. On their own they are weak signals, so test them (Backtest page) before trading them.';

export const CANDLE_GUIDES: Record<string, IndicatorGuide> = Object.fromEntries(
  PATTERNS.map((info) => [
    patternId(info),
    {
      what: info.what,
      use: GROUP_USE[info.group],
      signals: [info.signal, info.kind === 'neutral' ? 'Shown as a dot above the bar.' : 'Up arrow under the bar = bullish signal; down arrow above the bar = bearish signal.'],
      tip: PATTERN_TIP,
    } satisfies IndicatorGuide,
  ]),
);

CANDLE_GUIDES.cdl_all = {
  what: 'All 61 TA-Lib candlestick patterns on one layer: green arrows for bullish patterns, red for bearish, dots for indecision.',
  use: ['Choose which kinds to show with the inputs (1 = on, 0 = off): reversal, continuation, indecision, candle shapes, one-candle patterns.', 'Add a single pattern indicator when you want to know exactly which pattern fired.'],
  signals: ['Several patterns on the same bar (higher value) = stronger evidence.', 'A bullish reversal at support after a fall, or a bearish one at resistance after a rise, is the classic setup.'],
  tip: 'Candle shapes and indecision are off by default because they appear on many bars.',
};
