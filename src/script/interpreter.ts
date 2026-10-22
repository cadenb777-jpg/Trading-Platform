/**
 * A small Pine Script v5-compatible language for writing your own indicators.
 *
 * Scripts are evaluated a whole column at a time: every value is either a single number or a
 * series (one number per bar), and operators work bar-by-bar. That covers the common
 * indicator style (inputs, ta.* calculations, history references like close[1], ternaries
 * and plot/hline). Pine features that need bar-by-bar execution (if/for blocks, := on the
 * same variable's history, strategies) are reported as not supported yet.
 */
import { getIndicator } from '../indicators/library';
import { ema, highest, lowest, rma, rsi, sma, stdev, trueRange, wma } from '../indicators/math';
import { hma, linreg, rollingSum, shift } from '../indicators/more';
import type { IndicatorInput, PlotDef, PriceSource } from '../indicators/types';
import { PRICE_SOURCES } from '../indicators/types';
import type { Bar } from '../types';

export class ScriptError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(line ? `Line ${line}: ${message}` : message);
  }
}

// ---------- Lexer ----------

type TokenType = 'num' | 'str' | 'color' | 'id' | 'op' | 'nl' | 'eof';
interface Token {
  type: TokenType;
  value: string;
  line: number;
}

const OPERATORS = ['=>', ':=', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '+', '-', '*', '/', '%', '<', '>', '=', '?', ':', '(', ')', '[', ']', ','];

function lex(src: string): Token[] {
  const tokens: Token[] = [];
  let line = 1;
  let depth = 0;
  let i = 0;
  const push = (type: TokenType, value: string) => tokens.push({ type, value, line });
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      // Newlines inside brackets, or after an operator/comma, continue the statement.
      const prev = tokens[tokens.length - 1];
      const continues = depth > 0 || (prev && prev.type === 'op' && !['(', ')', ']'].includes(prev.value)) || (prev && prev.type === 'id' && ['and', 'or', 'not'].includes(prev.value));
      if (!continues && prev && prev.type !== 'nl') push('nl', '\n');
      line++;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(\d*\.?\d+(?:[eE][-+]?\d+)?)/.exec(src.slice(i))!;
      push('num', m[1]);
      i += m[1].length;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let value = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) j++;
        if (src[j] === '\n') throw new ScriptError('Text in quotes must end on the same line', line);
        value += src[j++];
      }
      if (j >= src.length) throw new ScriptError('Missing closing quote', line);
      push('str', value);
      i = j + 1;
      continue;
    }
    if (c === '#') {
      const m = /^#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/.exec(src.slice(i));
      if (!m) throw new ScriptError('Colours must look like #ff0000', line);
      push('color', m[0]);
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(src.slice(i))!;
      push('id', m[0]);
      i += m[0].length;
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (!op) throw new ScriptError(`Unexpected character "${c}"`, line);
    if (op === '(' || op === '[') depth++;
    if (op === ')' || op === ']') depth = Math.max(0, depth - 1);
    push('op', op);
    i += op.length;
  }
  push('nl', '\n');
  tokens.push({ type: 'eof', value: '', line });
  return tokens;
}

// ---------- Parser ----------

type Node =
  | { k: 'num'; v: number; line: number }
  | { k: 'str'; v: string; line: number }
  | { k: 'color'; v: string; line: number }
  | { k: 'bool'; v: boolean; line: number }
  | { k: 'na'; line: number }
  | { k: 'id'; name: string; line: number }
  | { k: 'call'; name: string; args: Node[]; named: Record<string, Node>; line: number }
  | { k: 'index'; target: Node; index: Node; line: number }
  | { k: 'unary'; op: string; e: Node; line: number }
  | { k: 'bin'; op: string; l: Node; r: Node; line: number }
  | { k: 'tern'; c: Node; a: Node; b: Node; line: number };

type Stmt =
  | { k: 'assign'; names: string[]; e: Node; line: number }
  | { k: 'func'; name: string; params: string[]; body: Node; line: number }
  | { k: 'expr'; e: Node; line: number };

const TYPE_WORDS = new Set(['float', 'int', 'bool', 'color', 'string', 'series', 'simple', 'const', 'var', 'varip']);
const UNSUPPORTED_KEYWORDS: Record<string, string> = {
  if: '"if" blocks',
  for: '"for" loops',
  while: '"while" loops',
  switch: '"switch" blocks',
  type: 'custom types',
  method: 'methods',
  import: 'library imports',
  export: 'library exports',
};

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(offset = 0) {
    return this.tokens[this.pos + offset];
  }
  private next() {
    return this.tokens[this.pos++];
  }
  private isOp(value: string, offset = 0) {
    const t = this.peek(offset);
    return t.type === 'op' && t.value === value;
  }
  private expectOp(value: string) {
    const t = this.next();
    if (t.type !== 'op' || t.value !== value) throw new ScriptError(`Expected "${value}" but found "${t.value || 'end of line'}"`, t.line);
  }

  program(): Stmt[] {
    const out: Stmt[] = [];
    while (this.peek().type !== 'eof') {
      if (this.peek().type === 'nl') {
        this.next();
        continue;
      }
      out.push(this.statement());
      const t = this.peek();
      if (t.type !== 'nl' && t.type !== 'eof') throw new ScriptError(`Unexpected "${t.value}"`, t.line);
    }
    return out;
  }

  private statement(): Stmt {
    const t = this.peek();
    if (t.type === 'id' && UNSUPPORTED_KEYWORDS[t.value]) {
      throw new ScriptError(`${UNSUPPORTED_KEYWORDS[t.value]} aren't supported yet. Use the ? : ternary for conditions, or ask Claude to convert this script.`, t.line);
    }
    // Skip type and "var" words: `var float x = ...` behaves like `x = ...` here.
    while (this.peek().type === 'id' && TYPE_WORDS.has(this.peek().value) && this.peek(1).type === 'id') this.next();

    // Tuple: [a, b, c] = ...
    if (this.isOp('[')) {
      const save = this.pos;
      this.next();
      const names: string[] = [];
      while (this.peek().type === 'id') {
        names.push(this.next().value);
        if (this.isOp(',')) this.next();
        else break;
      }
      if (this.isOp(']') && this.isOp('=', 1)) {
        this.next();
        this.next();
        return { k: 'assign', names, e: this.expr(), line: t.line };
      }
      this.pos = save;
    }
    // Function definition: name(a, b) => expr
    if (this.peek().type === 'id' && this.isOp('(', 1)) {
      const save = this.pos;
      const name = this.next().value;
      this.next();
      const params: string[] = [];
      let ok = true;
      while (!this.isOp(')')) {
        const p = this.next();
        if (p.type !== 'id') {
          ok = false;
          break;
        }
        params.push(p.value);
        if (this.isOp(',')) this.next();
      }
      if (ok && this.isOp(')') && this.isOp('=>', 1)) {
        this.next();
        this.next();
        if (this.peek().type === 'nl') throw new ScriptError('Multi-line functions aren\'t supported yet; write the function on one line', t.line);
        return { k: 'func', name, params, body: this.expr(), line: t.line };
      }
      this.pos = save;
    }
    // Assignment: x = ..., x := ..., x += ...
    if (this.peek().type === 'id' && this.peek(1).type === 'op' && ['=', ':=', '+=', '-=', '*=', '/='].includes(this.peek(1).value)) {
      const name = this.next().value;
      const op = this.next().value;
      let e = this.expr();
      if (op.length === 2 && op !== ':=') e = { k: 'bin', op: op[0], l: { k: 'id', name, line: t.line }, r: e, line: t.line };
      return { k: 'assign', names: [name], e, line: t.line };
    }
    return { k: 'expr', e: this.expr(), line: t.line };
  }

  expr(): Node {
    const c = this.or();
    if (this.isOp('?')) {
      this.next();
      const a = this.expr();
      this.expectOp(':');
      const b = this.expr();
      return { k: 'tern', c, a, b, line: c.line };
    }
    return c;
  }
  private or(): Node {
    let l = this.and();
    while (this.peek().type === 'id' && this.peek().value === 'or') {
      this.next();
      l = { k: 'bin', op: 'or', l, r: this.and(), line: l.line };
    }
    return l;
  }
  private and(): Node {
    let l = this.not();
    while (this.peek().type === 'id' && this.peek().value === 'and') {
      this.next();
      l = { k: 'bin', op: 'and', l, r: this.not(), line: l.line };
    }
    return l;
  }
  private not(): Node {
    if (this.peek().type === 'id' && this.peek().value === 'not') {
      const t = this.next();
      return { k: 'unary', op: 'not', e: this.not(), line: t.line };
    }
    return this.compare();
  }
  private compare(): Node {
    let l = this.additive();
    while (this.peek().type === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(this.peek().value)) {
      const op = this.next().value;
      l = { k: 'bin', op, l, r: this.additive(), line: l.line };
    }
    return l;
  }
  private additive(): Node {
    let l = this.mult();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.next().value;
      l = { k: 'bin', op, l, r: this.mult(), line: l.line };
    }
    return l;
  }
  private mult(): Node {
    let l = this.unary();
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
      const op = this.next().value;
      l = { k: 'bin', op, l, r: this.unary(), line: l.line };
    }
    return l;
  }
  private unary(): Node {
    if (this.isOp('-') || this.isOp('+')) {
      const t = this.next();
      return { k: 'unary', op: t.value, e: this.unary(), line: t.line };
    }
    return this.postfix();
  }
  private postfix(): Node {
    let e = this.primary();
    for (;;) {
      if (this.isOp('(')) {
        if (e.k !== 'id') throw new ScriptError('Only named functions can be called', e.line);
        this.next();
        const args: Node[] = [];
        const named: Record<string, Node> = {};
        while (!this.isOp(')')) {
          if (this.peek().type === 'id' && this.isOp('=', 1)) {
            const key = this.next().value;
            this.next();
            named[key] = this.expr();
          } else {
            args.push(this.expr());
          }
          if (this.isOp(',')) this.next();
          else if (!this.isOp(')')) throw new ScriptError(`Expected "," or ")" in call to ${e.name}`, this.peek().line);
        }
        this.next();
        e = { k: 'call', name: e.name, args, named, line: e.line };
      } else if (this.isOp('[')) {
        this.next();
        const index = this.expr();
        this.expectOp(']');
        e = { k: 'index', target: e, index, line: e.line };
      } else {
        return e;
      }
    }
  }
  private primary(): Node {
    const t = this.next();
    switch (t.type) {
      case 'num':
        return { k: 'num', v: Number(t.value), line: t.line };
      case 'str':
        return { k: 'str', v: t.value, line: t.line };
      case 'color':
        return { k: 'color', v: t.value, line: t.line };
      case 'id':
        if (t.value === 'true' || t.value === 'false') return { k: 'bool', v: t.value === 'true', line: t.line };
        if (t.value === 'na') return { k: 'na', line: t.line };
        return { k: 'id', name: t.value, line: t.line };
      case 'op':
        if (t.value === '(') {
          const e = this.expr();
          this.expectOp(')');
          return e;
        }
    }
    throw new ScriptError(`Unexpected "${t.value || 'end of line'}"`, t.line);
  }
}

// ---------- Values ----------

type Series = number[];
type Value = number | Series | string | string[] | Value[] | { fn: (args: Value[]) => Value };

const isSeries = (v: Value): v is Series => Array.isArray(v) && (v.length === 0 || typeof v[0] === 'number');
const isTuple = (v: Value): v is Value[] => Array.isArray(v) && v.length > 0 && typeof v[0] !== 'number' && typeof v[0] !== 'string';

const COLORS: Record<string, string> = {
  aqua: '#00bcd4', black: '#363a45', blue: '#2962ff', fuchsia: '#e040fb', gray: '#787b86', green: '#4caf50', lime: '#00e676',
  maroon: '#880e4f', navy: '#311b92', olive: '#808000', orange: '#ff9800', purple: '#9c27b0', red: '#f23645', silver: '#b2b5be',
  teal: '#089981', white: '#ffffff', yellow: '#ffeb3b',
};

function withAlpha(color: string, transparency: number): string {
  let hex = color.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const alpha = Math.round((Math.max(0, Math.min(100, 100 - transparency)) * 255) / 100);
  return `#${hex.slice(0, 6)}${alpha.toString(16).padStart(2, '0')}`;
}

export interface ScriptRunResult {
  name: string;
  shortName: string;
  overlay: boolean;
  inputs: IndicatorInput[];
  plots: (PlotDef & { values: number[] })[];
  levels: number[];
  warnings: string[];
}

const IGNORED_CALLS = new Set(['plotshape', 'plotchar', 'plotarrow', 'plotcandle', 'plotbar', 'bgcolor', 'barcolor', 'fill', 'alertcondition', 'alert', 'label.new', 'line.new', 'box.new', 'table.new', 'runtime.error', 'log.info']);

/** Runs a parsed script over the bars. `params` overrides input values (keyed in0, in1, ...). */
function run(program: Stmt[], bars: Bar[], params: Record<string, number | string>): ScriptRunResult {
  const n = bars.length;
  const result: ScriptRunResult = { name: 'My indicator', shortName: '', overlay: false, inputs: [], plots: [], levels: [], warnings: [] };
  const col = (f: (b: Bar, i: number) => number) => bars.map(f);
  const builtins: Record<string, () => Value> = {
    open: () => col((b) => b.open),
    high: () => col((b) => b.high),
    low: () => col((b) => b.low),
    close: () => col((b) => b.close),
    volume: () => col((b) => b.volume),
    hl2: () => col((b) => (b.high + b.low) / 2),
    hlc3: () => col((b) => (b.high + b.low + b.close) / 3),
    ohlc4: () => col((b) => (b.open + b.high + b.low + b.close) / 4),
    hlcc4: () => col((b) => (b.high + b.low + 2 * b.close) / 4),
    time: () => col((b) => b.time * 1000),
    bar_index: () => col((_, i) => i),
    'ta.tr': () => trueRange(col((b) => b.high), col((b) => b.low), col((b) => b.close)),
    'ta.obv': () => obv(bars),
    'ta.vwap': () => vwap(bars, col((b) => (b.high + b.low + b.close) / 3)),
    'math.pi': () => Math.PI,
    'math.e': () => Math.E,
  };
  for (const [name, hex] of Object.entries(COLORS)) builtins[`color.${name}`] = () => hex;
  for (const style of ['line', 'linebr', 'stepline', 'histogram', 'columns', 'circles', 'cross', 'area', 'areabr']) builtins[`plot.style_${style}`] = () => style;
  for (const style of ['solid', 'dashed', 'dotted']) builtins[`hline.style_${style}`] = () => style;

  const env = new Map<string, Value>();
  const funcs = new Map<string, { params: string[]; body: Node }>();
  let inputCount = 0;

  const series = (v: Value, line: number): Series => {
    if (typeof v === 'number') return new Array<number>(n).fill(v);
    if (isSeries(v)) return v;
    throw new ScriptError('Expected a number or series here', line);
  };
  const scalar = (v: Value, line: number): number => {
    if (typeof v === 'number') return v;
    if (isSeries(v)) {
      for (let i = v.length - 1; i >= 0; i--) if (Number.isFinite(v[i])) return v[i];
      return NaN;
    }
    throw new ScriptError('Expected a number here', line);
  };
  const text = (v: Value | undefined, fallback = '') => (typeof v === 'string' ? v : fallback);
  const colorOf = (v: Value | undefined): string | undefined => {
    if (typeof v === 'string' && v.startsWith('#')) return v;
    if (Array.isArray(v)) for (let i = v.length - 1; i >= 0; i--) if (typeof v[i] === 'string') return v[i] as string;
    return undefined;
  };
  const zip = (a: Value, b: Value, line: number, f: (x: number, y: number) => number): Value => {
    if (typeof a === 'number' && typeof b === 'number') return f(a, b);
    const sa = series(a, line);
    const sb = series(b, line);
    return sa.map((x, i) => f(x, sb[i]));
  };
  const map = (a: Value, line: number, f: (x: number) => number): Value => (typeof a === 'number' ? f(a) : series(a, line).map(f));
  const clean = (x: number) => (Number.isFinite(x) ? x : NaN);
  const truthy = (x: number) => !Number.isNaN(x) && x !== 0;

  // ta.* and math.* functions. Each receives evaluated arguments (named arguments merged by position).
  const lengthArg = (v: Value, line: number) => {
    const len = Math.round(scalar(v, line));
    if (!(len >= 1)) throw new ScriptError('Length must be 1 or more', line);
    return len;
  };
  type Fn = (a: Value[], line: number) => Value;
  const fromDef = (id: string, p: Record<string, number>, keys: string[]): Value[] => {
    const def = getIndicator(id)!;
    const out = def.compute(bars, { ...Object.fromEntries(def.inputs.map((i) => [i.key, i.default])), ...p });
    return keys.map((k) => out[k]);
  };
  const FUNCS: Record<string, { params: string[]; fn: Fn }> = {
    'ta.sma': { params: ['source', 'length'], fn: (a, l) => sma(series(a[0], l), lengthArg(a[1], l)) },
    'ta.ema': { params: ['source', 'length'], fn: (a, l) => ema(series(a[0], l), lengthArg(a[1], l)) },
    'ta.wma': { params: ['source', 'length'], fn: (a, l) => wma(series(a[0], l), lengthArg(a[1], l)) },
    'ta.rma': { params: ['source', 'length'], fn: (a, l) => rma(series(a[0], l), lengthArg(a[1], l)) },
    'ta.hma': { params: ['source', 'length'], fn: (a, l) => hma(series(a[0], l), lengthArg(a[1], l)) },
    'ta.vwma': {
      params: ['source', 'length'],
      fn: (a, l) => {
        const s = series(a[0], l);
        const len = lengthArg(a[1], l);
        const pv = sma(s.map((v, i) => v * bars[i].volume), len);
        const vv = sma(bars.map((b) => b.volume), len);
        return pv.map((v, i) => clean(v / vv[i]));
      },
    },
    'ta.rsi': { params: ['source', 'length'], fn: (a, l) => rsi(series(a[0], l), lengthArg(a[1], l)) },
    'ta.stdev': { params: ['source', 'length'], fn: (a, l) => stdev(series(a[0], l), lengthArg(a[1], l)) },
    'ta.highest': { params: ['source', 'length'], fn: (a, l) => (a.length === 1 ? highest(col((b) => b.high), lengthArg(a[0], l)) : highest(series(a[0], l), lengthArg(a[1], l))) },
    'ta.lowest': { params: ['source', 'length'], fn: (a, l) => (a.length === 1 ? lowest(col((b) => b.low), lengthArg(a[0], l)) : lowest(series(a[0], l), lengthArg(a[1], l))) },
    'ta.change': { params: ['source', 'length'], fn: (a, l) => { const s = series(a[0], l); const len = a[1] === undefined ? 1 : lengthArg(a[1], l); return s.map((v, i) => (i >= len ? v - s[i - len] : NaN)); } },
    'ta.mom': { params: ['source', 'length'], fn: (a, l) => { const s = series(a[0], l); const len = lengthArg(a[1], l); return s.map((v, i) => (i >= len ? v - s[i - len] : NaN)); } },
    'ta.roc': { params: ['source', 'length'], fn: (a, l) => { const s = series(a[0], l); const len = lengthArg(a[1], l); return s.map((v, i) => (i >= len ? clean((100 * (v - s[i - len])) / s[i - len]) : NaN)); } },
    'ta.atr': { params: ['length'], fn: (a, l) => rma(builtins['ta.tr']() as Series, lengthArg(a[0], l)) },
    'ta.cci': {
      params: ['source', 'length'],
      fn: (a, l) => {
        const s = series(a[0], l);
        const len = lengthArg(a[1], l);
        const mean = sma(s, len);
        return s.map((v, i) => {
          if (Number.isNaN(mean[i])) return NaN;
          let dev = 0;
          for (let j = i - len + 1; j <= i; j++) dev += Math.abs(s[j] - mean[i]);
          return dev ? (v - mean[i]) / (0.015 * (dev / len)) : 0;
        });
      },
    },
    'ta.macd': {
      params: ['source', 'fastlen', 'slowlen', 'siglen'],
      fn: (a, l) => {
        const s = series(a[0], l);
        const fast = ema(s, lengthArg(a[1], l));
        const slow = ema(s, lengthArg(a[2], l));
        const macd = fast.map((f, i) => f - slow[i]);
        const signal = ema(macd, lengthArg(a[3], l));
        return [macd, signal, macd.map((m, i) => m - signal[i])];
      },
    },
    'ta.bb': {
      params: ['series', 'length', 'mult'],
      fn: (a, l) => {
        const s = series(a[0], l);
        const len = lengthArg(a[1], l);
        const basis = sma(s, len);
        const dev = stdev(s, len);
        const m = scalar(a[2], l);
        return [basis, basis.map((b, i) => b + m * dev[i]), basis.map((b, i) => b - m * dev[i])];
      },
    },
    'ta.kc': { params: ['series', 'length', 'mult'], fn: (a, l) => { const r = fromDef('keltner', { length: lengthArg(a[1], l), atr: lengthArg(a[1], l), mult: scalar(a[2], l) }, ['basis', 'upper', 'lower']); return r; } },
    'ta.stoch': {
      params: ['source', 'high', 'low', 'length'],
      fn: (a, l) => {
        const s = series(a[0], l);
        const len = lengthArg(a[3], l);
        const hh = highest(series(a[1], l), len);
        const ll = lowest(series(a[2], l), len);
        return s.map((v, i) => clean((100 * (v - ll[i])) / (hh[i] - ll[i])));
      },
    },
    'ta.wpr': { params: ['length'], fn: (a, l) => { const len = lengthArg(a[0], l); const hh = highest(col((b) => b.high), len); const ll = lowest(col((b) => b.low), len); return bars.map((b, i) => clean((-100 * (hh[i] - b.close)) / (hh[i] - ll[i]))); } },
    'ta.mfi': { params: ['series', 'length'], fn: (a, l) => fromDef('mfi', { length: lengthArg(a[1], l) }, ['mfi'])[0] },
    'ta.supertrend': {
      params: ['factor', 'atrPeriod'],
      fn: (a, l) => {
        const [up, down] = fromDef('supertrend', { mult: scalar(a[0], l), atr: lengthArg(a[1], l) }, ['up', 'down']) as Series[];
        return [up.map((u, i) => (Number.isNaN(u) ? down[i] : u)), up.map((u, i) => (Number.isNaN(u) ? (Number.isNaN(down[i]) ? NaN : 1) : -1))];
      },
    },
    'ta.dmi': { params: ['diLength', 'adxSmoothing'], fn: (a, l) => fromDef('adx', { length: lengthArg(a[0], l), smoothing: lengthArg(a[1], l) }, ['plus', 'minus', 'adx']) },
    'ta.sar': { params: ['start', 'inc', 'max'], fn: (a, l) => fromDef('psar', { start: scalar(a[0], l), increment: scalar(a[1], l), max: scalar(a[2], l) }, ['sar'])[0] },
    'ta.linreg': { params: ['source', 'length', 'offset'], fn: (a, l) => shift(linreg(series(a[0], l), lengthArg(a[1], l)), a[2] === undefined ? 0 : Math.round(scalar(a[2], l))) },
    'ta.alma': { params: ['series', 'length', 'offset', 'sigma'], fn: (a, l) => { const s = series(a[0], l); const len = lengthArg(a[1], l); const m = scalar(a[2], l) * (len - 1); const sig = len / scalar(a[3], l); const w = Array.from({ length: len }, (_, i) => Math.exp(-((i - m) ** 2) / (2 * sig * sig))); const norm = w.reduce((x, y) => x + y, 0); return s.map((_, i) => (i < len - 1 ? NaN : w.reduce((acc, wi, j) => acc + wi * s[i - len + 1 + j], 0) / norm)); } },
    'ta.vwap': { params: ['source'], fn: (a, l) => vwap(bars, series(a[0], l)) },
    'ta.crossover': { params: ['a', 'b'], fn: (a, l) => { const x = series(a[0], l); const y = series(a[1], l); return x.map((v, i) => (i && v > y[i] && x[i - 1] <= y[i - 1] ? 1 : 0)); } },
    'ta.crossunder': { params: ['a', 'b'], fn: (a, l) => { const x = series(a[0], l); const y = series(a[1], l); return x.map((v, i) => (i && v < y[i] && x[i - 1] >= y[i - 1] ? 1 : 0)); } },
    'ta.cross': { params: ['a', 'b'], fn: (a, l) => { const x = series(a[0], l); const y = series(a[1], l); return x.map((v, i) => (i && Math.sign(v - y[i]) !== Math.sign(x[i - 1] - y[i - 1]) && !Number.isNaN(v - y[i] + x[i - 1] - y[i - 1]) ? 1 : 0)); } },
    'ta.cum': { params: ['source'], fn: (a, l) => { let t = 0; return series(a[0], l).map((v) => (Number.isNaN(v) ? t : (t += v))); } },
    'ta.rising': { params: ['source', 'length'], fn: (a, l) => { const s = series(a[0], l); const len = lengthArg(a[1], l); return s.map((v, i) => (i < len ? 0 : s.slice(i - len, i).every((p) => v > p) ? 1 : 0)); } },
    'ta.falling': { params: ['source', 'length'], fn: (a, l) => { const s = series(a[0], l); const len = lengthArg(a[1], l); return s.map((v, i) => (i < len ? 0 : s.slice(i - len, i).every((p) => v < p) ? 1 : 0)); } },
    'ta.barssince': { params: ['condition'], fn: (a, l) => { let last = -1; return series(a[0], l).map((v, i) => { if (truthy(v)) last = i; return last < 0 ? NaN : i - last; }); } },
    'ta.valuewhen': { params: ['condition', 'source', 'occurrence'], fn: (a, l) => { const c = series(a[0], l); const s = series(a[1], l); const occ = a[2] === undefined ? 0 : Math.round(scalar(a[2], l)); const hits: number[] = []; return c.map((v, i) => { if (truthy(v)) hits.push(s[i]); return hits.length > occ ? hits[hits.length - 1 - occ] : NaN; }); } },
    'math.sum': { params: ['source', 'length'], fn: (a, l) => rollingSum(series(a[0], l), lengthArg(a[1], l)) },
    'math.abs': { params: ['x'], fn: (a, l) => map(a[0], l, Math.abs) },
    'math.sqrt': { params: ['x'], fn: (a, l) => map(a[0], l, (x) => clean(Math.sqrt(x))) },
    'math.log': { params: ['x'], fn: (a, l) => map(a[0], l, (x) => clean(Math.log(x))) },
    'math.log10': { params: ['x'], fn: (a, l) => map(a[0], l, (x) => clean(Math.log10(x))) },
    'math.exp': { params: ['x'], fn: (a, l) => map(a[0], l, Math.exp) },
    'math.floor': { params: ['x'], fn: (a, l) => map(a[0], l, Math.floor) },
    'math.ceil': { params: ['x'], fn: (a, l) => map(a[0], l, Math.ceil) },
    'math.sign': { params: ['x'], fn: (a, l) => map(a[0], l, Math.sign) },
    'math.pow': { params: ['base', 'exponent'], fn: (a, l) => zip(a[0], a[1], l, (x, y) => clean(x ** y)) },
    'math.round': { params: ['x', 'precision'], fn: (a, l) => { const p = a[1] === undefined ? 0 : scalar(a[1], l); const k = 10 ** p; return map(a[0], l, (x) => Math.round(x * k) / k); } },
    'math.max': { params: [], fn: (a, l) => a.reduce((acc, v) => zip(acc, v, l, (x, y) => (Number.isNaN(x) || Number.isNaN(y) ? NaN : Math.max(x, y)))) },
    'math.min': { params: [], fn: (a, l) => a.reduce((acc, v) => zip(acc, v, l, (x, y) => (Number.isNaN(x) || Number.isNaN(y) ? NaN : Math.min(x, y)))) },
    'math.avg': { params: [], fn: (a, l) => map(a.reduce((acc, v) => zip(acc, v, l, (x, y) => x + y)), l, (x) => x / a.length) },
    nz: { params: ['source', 'replacement'], fn: (a, l) => { const r = a[1] === undefined ? 0 : scalar(a[1], l); return map(a[0], l, (x) => (Number.isNaN(x) ? r : x)); } },
    na: { params: ['x'], fn: (a, l) => map(a[0], l, (x) => (Number.isNaN(x) ? 1 : 0)) },
    fixnan: { params: ['source'], fn: (a, l) => { let last = NaN; return series(a[0], l).map((v) => (Number.isNaN(v) ? last : (last = v))); } },
  };

  const evalNode = (node: Node): Value => {
    switch (node.k) {
      case 'num':
        return node.v;
      case 'str':
      case 'color':
        return node.v;
      case 'bool':
        return node.v ? 1 : 0;
      case 'na':
        return NaN;
      case 'id': {
        if (env.has(node.name)) return env.get(node.name)!;
        const b = builtins[node.name];
        if (b) return b();
        if (FUNCS[node.name] || FUNCS[`ta.${node.name}`]) throw new ScriptError(`${node.name} is a function; call it with ( )`, node.line);
        throw new ScriptError(`Unknown name "${node.name}"`, node.line);
      }
      case 'index': {
        const target = evalNode(node.target);
        const offset = Math.round(scalar(evalNode(node.index), node.line));
        if (typeof target === 'number') return target;
        if (isSeries(target)) return shift(target, offset);
        throw new ScriptError('Only numbers and series can use [ ] history', node.line);
      }
      case 'unary': {
        const v = evalNode(node.e);
        if (node.op === 'not') return map(v, node.line, (x) => (truthy(x) ? 0 : 1));
        return node.op === '-' ? map(v, node.line, (x) => -x) : v;
      }
      case 'bin': {
        const l = evalNode(node.l);
        const r = evalNode(node.r);
        if (node.op === '+' && (typeof l === 'string' || typeof r === 'string')) return `${typeof l === 'number' ? l : text(l)}${typeof r === 'number' ? r : text(r)}`;
        const ops: Record<string, (x: number, y: number) => number> = {
          '+': (x, y) => x + y,
          '-': (x, y) => x - y,
          '*': (x, y) => x * y,
          '/': (x, y) => clean(x / y),
          '%': (x, y) => clean(x % y),
          '==': (x, y) => (x === y ? 1 : 0),
          '!=': (x, y) => (Number.isNaN(x) || Number.isNaN(y) ? 0 : x !== y ? 1 : 0),
          '<': (x, y) => (x < y ? 1 : 0),
          '<=': (x, y) => (x <= y ? 1 : 0),
          '>': (x, y) => (x > y ? 1 : 0),
          '>=': (x, y) => (x >= y ? 1 : 0),
          and: (x, y) => (truthy(x) && truthy(y) ? 1 : 0),
          or: (x, y) => (truthy(x) || truthy(y) ? 1 : 0),
        };
        return zip(l, r, node.line, ops[node.op]);
      }
      case 'tern': {
        const c = evalNode(node.c);
        const a = evalNode(node.a);
        const b = evalNode(node.b);
        if (typeof c === 'number') return truthy(c) ? a : b;
        const cs = series(c, node.line);
        if (typeof a === 'string' || typeof b === 'string' || (Array.isArray(a) && typeof a[0] === 'string')) {
          return cs.map((x, i) => {
            const v = truthy(x) ? a : b;
            return (Array.isArray(v) ? v[i] : v) as string;
          });
        }
        const sa = series(a, node.line);
        const sb = series(b, node.line);
        return cs.map((x, i) => (truthy(x) ? sa[i] : sb[i]));
      }
      case 'call':
        return call(node);
    }
  };

  const argsFor = (node: Extract<Node, { k: 'call' }>, params: string[]): Value[] => {
    const values = node.args.map(evalNode);
    params.forEach((p, i) => {
      if (node.named[p] && values[i] === undefined) values[i] = evalNode(node.named[p]);
    });
    return values;
  };

  const sourceName = (node: Node | undefined): PriceSource => (node && node.k === 'id' && (PRICE_SOURCES as string[]).includes(node.name) ? (node.name as PriceSource) : 'close');

  const call = (node: Extract<Node, { k: 'call' }>): Value => {
    let name = node.name;
    const named = node.named;
    const arg = (i: number, key: string) => (node.args[i] ? evalNode(node.args[i]) : named[key] ? evalNode(named[key]) : undefined);

    if (name === 'indicator' || name === 'study') {
      result.name = text(arg(0, 'title'), 'My indicator');
      result.shortName = text(arg(1, 'shorttitle'), '');
      const overlay = arg(2, 'overlay');
      result.overlay = overlay !== undefined && truthy(scalar(overlay, node.line));
      return 0;
    }
    if (name === 'strategy') throw new ScriptError('Strategies aren\'t supported yet; they\'re coming with backtesting. Change strategy(...) to indicator(...) to chart the lines.', node.line);
    if (name === 'input' || name.startsWith('input.')) return input(node, name);
    if (name === 'plot') {
      const values = series(arg(0, 'series') ?? NaN, node.line);
      const width = Math.round(scalar(arg(3, 'linewidth') ?? 2, node.line));
      const style = text(arg(4, 'style'), 'line');
      const index = result.plots.length;
      result.plots.push({
        key: `p${index}`,
        title: text(arg(1, 'title'), `Plot ${index + 1}`),
        type: style === 'histogram' || style === 'columns' ? 'histogram' : 'line',
        style: style === 'circles' || style === 'cross' ? 'dots' : 'line',
        color: colorOf(arg(2, 'color')) ?? ['#2962ff', '#ff6d00', '#26a69a', '#e91e63', '#9c27b0'][index % 5],
        lineWidth: Math.min(4, Math.max(1, width)) as 1 | 2 | 3 | 4,
        values,
      });
      return values;
    }
    if (name === 'hline') {
      result.levels.push(scalar(arg(0, 'price') ?? NaN, node.line));
      return 0;
    }
    if (name === 'color.new') return withAlpha(colorOf(arg(0, 'color')) ?? '#2962ff', scalar(arg(1, 'transp') ?? 0, node.line));
    if (name === 'color.rgb') {
      const [r, g, b] = [0, 1, 2].map((i) => Math.round(scalar(arg(i, ['red', 'green', 'blue'][i]) ?? 0, node.line)));
      const hex = `#${[r, g, b].map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('')}`;
      return withAlpha(hex, scalar(arg(3, 'transp') ?? 0, node.line));
    }
    if (IGNORED_CALLS.has(name)) {
      if (!result.warnings.includes(name)) result.warnings.push(name);
      return 0;
    }
    const user = funcs.get(name);
    if (user) {
      const values = node.args.map(evalNode);
      const saved = new Map(env);
      user.params.forEach((p, i) => env.set(p, values[i] ?? NaN));
      try {
        return evalNode(user.body);
      } finally {
        env.clear();
        for (const [k, v] of saved) env.set(k, v);
      }
    }
    // Pine v4 names without the "ta." or "math." prefix (sma, crossover, abs...) still work.
    if (!FUNCS[name] && FUNCS[`ta.${name}`]) name = `ta.${name}`;
    else if (!FUNCS[name] && FUNCS[`math.${name}`]) name = `math.${name}`;
    else if (name === 'sum') name = 'math.sum';
    const f = FUNCS[name];
    if (!f) throw new ScriptError(`The function ${node.name}() isn't supported yet`, node.line);
    return f.fn(f.params.length ? argsFor({ ...node, name }, f.params) : node.args.map(evalNode), node.line);
  };

  const input = (node: Extract<Node, { k: 'call' }>, name: string): Value => {
    const key = `in${inputCount++}`;
    const defNode = node.args[0] ?? node.named.defval;
    const title = node.args[1] ? text(evalNode(node.args[1])) : node.named.title ? text(evalNode(node.named.title)) : `Input ${inputCount}`;
    const kind = name === 'input' ? (defNode && defNode.k === 'id' && sourceName(defNode) !== 'close' ? 'source' : 'number') : name.slice(6);
    if (kind === 'source' || (name === 'input' && defNode?.k === 'id')) {
      const def = sourceName(defNode);
      result.inputs.push({ key, label: title, type: 'source', default: def });
      const chosen = (params[key] as PriceSource) ?? def;
      return builtins[chosen]();
    }
    if (kind === 'int' || kind === 'float' || kind === 'bool' || kind === 'number') {
      const def = defNode ? scalar(evalNode(defNode), node.line) : 0;
      const minNode = node.named.minval;
      const maxNode = node.named.maxval;
      const stepNode = node.named.step;
      const isBool = kind === 'bool';
      result.inputs.push({
        key,
        label: isBool ? `${title} (1 = on, 0 = off)` : title,
        type: 'number',
        default: def,
        min: isBool ? 0 : minNode ? scalar(evalNode(minNode), node.line) : undefined,
        max: isBool ? 1 : maxNode ? scalar(evalNode(maxNode), node.line) : undefined,
        step: stepNode ? scalar(evalNode(stepNode), node.line) : kind === 'float' ? 0.1 : 1,
      });
      const value = params[key];
      return value === undefined || value === '' ? def : Number(value);
    }
    // Text, colour and time inputs aren't adjustable yet; use their default value.
    return defNode ? evalNode(defNode) : 0;
  };

  for (const stmt of program) {
    if (stmt.k === 'func') {
      funcs.set(stmt.name, { params: stmt.params, body: stmt.body });
    } else if (stmt.k === 'assign') {
      const v = evalNode(stmt.e);
      if (stmt.names.length > 1) {
        if (!isTuple(v) && !(Array.isArray(v) && v.length && Array.isArray(v[0]))) throw new ScriptError('This function returns a single value, not a [list]', stmt.line);
        stmt.names.forEach((name, i) => env.set(name, (v as Value[])[i] ?? NaN));
      } else {
        env.set(stmt.names[0], v);
      }
    } else {
      evalNode(stmt.e);
    }
  }
  if (!result.shortName) result.shortName = result.name.length > 18 ? result.name.slice(0, 16) + '…' : result.name;
  return result;
}

function obv(bars: Bar[]): number[] {
  let total = 0;
  return bars.map((b, i) => {
    if (i && b.close > bars[i - 1].close) total += b.volume;
    else if (i && b.close < bars[i - 1].close) total -= b.volume;
    return total;
  });
}

function vwap(bars: Bar[], src: number[]): number[] {
  let day = -1;
  let pv = 0;
  let vol = 0;
  return bars.map((b, i) => {
    const d = Math.floor(b.time / 86400);
    if (d !== day) {
      day = d;
      pv = 0;
      vol = 0;
    }
    pv += src[i] * b.volume;
    vol += b.volume;
    return vol ? pv / vol : src[i];
  });
}

/** Sample bars used to check a script and discover its inputs and plots. */
function sampleBars(): Bar[] {
  let price = 100;
  return Array.from({ length: 300 }, (_, i) => {
    const open = price;
    price = Math.max(1, price + Math.sin(i / 7) * 1.5 + Math.cos(i / 3) * 0.7);
    return { time: 1_700_000_000 + i * 3600, open, high: Math.max(open, price) + 0.5, low: Math.min(open, price) - 0.5, close: price, volume: 1000 + ((i * 37) % 500) };
  });
}

export interface CompiledScript extends Omit<ScriptRunResult, 'plots'> {
  plots: PlotDef[];
  run(bars: Bar[], params: Record<string, number | string>): Record<string, number[]>;
}

/** Parses and test-runs a script. Throws ScriptError with a line number if something is wrong. */
export function compileScript(source: string): CompiledScript {
  const program = new Parser(lex(source)).program();
  const described = run(program, sampleBars(), {});
  if (!described.plots.length) throw new ScriptError('The script doesn\'t plot anything yet. Add a line like: plot(close)', 0);
  return {
    ...described,
    plots: described.plots.map(({ values: _values, ...plot }) => plot),
    run: (bars, params) => {
      if (!bars.length) return {};
      const out = run(program, bars, params);
      return Object.fromEntries(out.plots.map((p) => [p.key, p.values]));
    },
  };
}
