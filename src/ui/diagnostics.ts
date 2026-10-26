/**
 * "Send diagnostics": collects one redacted file (the helper's request log, feed health, notes and log tail plus this
 * page's errors), shows what is in it and saves it to the owner's computer. Nothing is uploaded automatically.
 */
import { FEEDS, feedState, health, type FeedId } from '../data/health';
import { LATEST_HELPER_VERSION, engineRequest, helper } from '../data/schwab';
import { assembleDiagnostics, consoleErrors, engineErrors, summarise, type BrowserSection } from '../diagnostics';
import { h, openModal, toast } from './dom';

export const DIAGNOSTICS_HELPER_VERSION = 34;

function browserSection(): BrowserSection {
  const feeds: Record<string, unknown> = {};
  for (const id of Object.keys(FEEDS) as FeedId[]) {
    const s = feedState(id);
    feeds[id] = { state: health(id), lastOk: s.lastOk, lastError: s.lastError, lastErrorAt: s.lastErrorAt };
  }
  return {
    page: location.hash || '#home',
    appVersion: `site for helper v${LATEST_HELPER_VERSION}`,
    browser: navigator.userAgent,
    screen: `${window.innerWidth}x${window.innerHeight}`,
    helperConnected: helper.isConnected,
    helperVersion: helper.version ?? null,
    feeds,
    engineErrors: [...engineErrors],
    consoleErrors: [...consoleErrors],
  };
}

async function helperSection(): Promise<unknown> {
  if (!helper.isConnected) return { unavailable: 'the helper isn’t running, so only this page’s part is included' };
  if ((helper.version ?? 0) < DIAGNOSTICS_HELPER_VERSION) return { unavailable: `helper version ${helper.version} is too old for diagnostics (update it for the full file)` };
  try {
    return await engineRequest('diagnostics.collect', {}, 20000);
  } catch (err) {
    return { unavailable: `the helper couldn’t collect its part (${(err as Error).message})` };
  }
}

/** Builds the redacted file (exported for tests and the Playwright check). */
export async function buildDiagnostics() {
  return assembleDiagnostics(browserSection(), await helperSection());
}

function save(file: Record<string, unknown>) {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `trading-platform-diagnostics-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** Opens the preview window; "Save file" downloads it. */
export async function openDiagnostics() {
  const body = h('div', { class: 'diag' }, h('div', { class: 'muted pad' }, 'Collecting…'));
  openModal('Send diagnostics', body);
  const file = await buildDiagnostics();
  const saveBtn = h('button', { class: 'btn primary', onclick: () => (save(file), toast('Saved to your Downloads folder')) }, 'Save file');
  body.replaceChildren(
    h('p', {}, 'This file helps fix problems with your real data (Schwab, Webull, SEC, futures quotes…). Keys, tokens, account numbers, emails and folder names are masked before you see it.'),
    h('b', {}, 'What’s included'),
    h('ul', { class: 'diag-list' }, ...summarise(file).map((line) => h('li', {}, line))),
    h('details', {}, h('summary', {}, 'Show the whole file'), h('pre', { class: 'diag-pre' }, JSON.stringify(file, null, 2))),
    h('p', { class: 'diag-upload' }, h('b', {}, 'Upload this file in your Claude chat.'), ' Nothing is sent anywhere by itself: the file is only saved to your computer.'),
    h('div', { class: 'ap-controls' }, saveBtn),
  );
  saveBtn.focus();
}

/** The button used in Settings and the Data popover. */
export function diagnosticsButton(cls = 'btn') {
  return h('button', { class: cls, type: 'button', onclick: () => void openDiagnostics() }, 'Send diagnostics');
}
