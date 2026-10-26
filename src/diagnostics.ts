/**
 * The browser's half of the diagnostics file (Settings / Data button > Send diagnostics): recent failed engine
 * requests and console errors since the page loaded, plus redaction and assembly. Pure bookkeeping, no network;
 * the file is only ever saved by the owner (src/ui/diagnostics.ts), never sent anywhere.
 * The helper redacts its own half (helper/engine/diagnostics.py); the whole file goes through `redact` again here.
 */

export interface DiagEntry {
  at: number;
  type?: string;
  message: string;
}

const MAX = 50;
export const engineErrors: DiagEntry[] = [];
export const consoleErrors: DiagEntry[] = [];

function push(list: DiagEntry[], entry: DiagEntry) {
  list.push({ ...entry, message: String(entry.message).slice(0, 500) });
  if (list.length > MAX) list.shift();
}

/** A failed helper request (engineRequest, history). */
export function recordEngineError(type: string, message: string) {
  push(engineErrors, { at: Date.now(), type, message });
}

let installed = false;
/** Starts keeping console errors, uncaught errors and unhandled promise rejections (once, at page load). */
export function captureConsoleErrors(win: Window & typeof globalThis = window) {
  if (installed) return;
  installed = true;
  const original = win.console.error.bind(win.console);
  win.console.error = (...args: unknown[]) => {
    push(consoleErrors, { at: Date.now(), message: args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : safeJson(a))).join(' ') });
    original(...args);
  };
  win.addEventListener('error', (e) => push(consoleErrors, { at: Date.now(), type: 'error', message: `${e.message}${e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''}` }));
  win.addEventListener('unhandledrejection', (e) => {
    const r = (e as PromiseRejectionEvent).reason;
    push(consoleErrors, { at: Date.now(), type: 'unhandledrejection', message: r instanceof Error ? `${r.name}: ${r.message}` : String(r) });
  });
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v)?.slice(0, 300) ?? String(v);
  } catch {
    return String(v);
  }
}

// ---------- redaction (same rules as the helper's redact) ----------

const MASK = '[redacted]';
const SECRET_NAME = /(key|secret|token|password|passwd|auth|signature|cookie|session|credential|email|contact|chat|topic)/i;
const ACCOUNT_NAME = /(account|acct|hash)/i;
const last2 = (s: string) => '••' + (s.length > 2 ? s.slice(-2) : '');
const RULES: [RegExp, string | ((...m: string[]) => string)][] = [
  [/\bbearer\s+[\w.~+/=-]+/gi, 'Bearer ' + MASK],
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]'],
  [/(https?:\/\/[^\s?#"'<>]+)\?[^\s"'<>]*/g, '$1?[query removed]'],
  [/\b([\w-]*(?:token|secret|password|passwd|api[_-]?key|app[_-]?key|authorization|signature|client[_-]?id)[\w-]*)(["']?\s*[:=]\s*["']?)(?!\[)([^\s"',;&}\]]+)/gi, `$1$2${MASK}`],
  [/\b\d{5,15}:[A-Za-z0-9_-]{30,}/g, MASK],
  [/\b(account|acct)(s?(?:[ _-]?(?:id|number|no\.?|hash))?\s*[:=#]?\s*["']?)([A-Za-z0-9-]*\d[A-Za-z0-9-]{2,})/gi, (_m, a, b, c) => a + b + last2(c)],
  [/\b[0-9a-fA-F]{24,}\b/g, '[hex]'],
  [/(?=[A-Za-z0-9+_-]*\d)[A-Za-z0-9+_-]{32,}={0,2}/g, '[long string]'],
  [/\b\d{7,}\b/g, (m) => last2(m)],
];
const HOME = /(\/Users\/|\/home\/|[A-Z]:\\Users\\|[A-Z]:\/Users\/)[^/\\\s"'<>]+/gi;

export function redactText(text: string): string {
  let s = String(text).replace(HOME, '~');
  for (const [re, repl] of RULES) s = s.replace(re, repl as string);
  return s;
}

/** A copy of `value` with secrets masked: secret-named fields, account ids (last 2 kept) and every string's contents. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[too deep]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const plain = typeof v === 'string' || typeof v === 'number';
      if (plain && SECRET_NAME.test(k) && v !== '' && v !== 0) out[k] = MASK;
      else if (plain && ACCOUNT_NAME.test(k) && String(v)) out[k] = last2(String(v));
      else out[k] = redact(v, depth + 1);
    }
    return out;
  }
  return typeof value === 'string' ? redactText(value) : value;
}

export interface BrowserSection {
  page: string;
  appVersion: string;
  browser: string;
  screen: string;
  helperConnected: boolean;
  helperVersion: number | null;
  feeds: Record<string, unknown>;
  engineErrors: DiagEntry[];
  consoleErrors: DiagEntry[];
}

/** The whole file: a header, the browser's section and the helper's (or why it's missing), redacted. */
export function assembleDiagnostics(browser: BrowserSection, helper: unknown, now = Date.now()) {
  return redact({
    kind: 'trading-platform-diagnostics',
    createdAt: new Date(now).toISOString(),
    note: 'Saved by the owner from Settings. Secrets, account numbers, emails and home-folder paths are masked.',
    browser,
    helper,
  }) as Record<string, unknown>;
}

/** Plain-language lines for the preview: what the file contains. */
export function summarise(file: Record<string, unknown>): string[] {
  const b = (file.browser ?? {}) as Partial<BrowserSection>;
  const hp = (file.helper ?? {}) as Record<string, unknown>;
  const lines: string[] = [];
  if (hp.unavailable) lines.push(`Helper: ${String(hp.unavailable)}`);
  else {
    const rs = (hp.requestSummary ?? {}) as { count?: number; failed?: number };
    lines.push(`Helper version ${hp.helperVersion ?? '?'}; settings switches (on/off only, no keys)`);
    lines.push(`${rs.count ?? 0} recent requests (${rs.failed ?? 0} failed), with error messages`);
    lines.push(`${Object.keys((hp.feedHealth ?? {}) as object).length} data sources' health and ${((hp.externalCalls ?? []) as unknown[]).length} recent outside calls (status and timing)`);
    lines.push(`Feature notes: ${Object.keys((hp.notes ?? {}) as object).join(', ') || 'none yet'}`);
    lines.push(`The last ${((hp.logTail ?? []) as unknown[]).length} lines of the helper log`);
  }
  lines.push(`This page (${b.page || 'home'}), browser, ${b.engineErrors?.length ?? 0} failed requests and ${b.consoleErrors?.length ?? 0} page errors since it opened`);
  return lines;
}
