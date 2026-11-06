/**
 * Picks up new versions of the website by itself: every 2 minutes it compares this page's script with the one the
 * site serves now (a newly published version has a new file name), and also reloads when the helper is newer than
 * this page knows about (once per helper version: the site can be published a few minutes after the helper, so it
 * never reloads in a loop). The reload waits for a quiet moment: tab in the background or a minute with no clicks,
 * and never while a field has focus, a window is open (e.g. an order confirm) or on the Trade page (its ticket).
 */
const CHECK_MS = 2 * 60 * 1000; // owner's choice
const QUIET_MS = 60 * 1000;

/** The page's own script file name (changes with every published build), or '' in development. */
export function scriptName(html: string): string {
  return /<script[^>]+type="module"[^>]+src="([^"]*assets\/[^"]+\.js)"/.exec(html)?.[1].split('/').pop() ?? '';
}

/** True when the page can reload without losing anything the owner is doing. */
export function quietNow(doc: Document, lastInputAt: number, now: number, hash = ''): boolean {
  if (hash.startsWith('#trade')) return false; // an order ticket may hold typed values: wait until you leave the page
  const busyEl = doc.activeElement;
  const typing = !!busyEl && /^(INPUT|TEXTAREA|SELECT)$/.test(busyEl.tagName);
  if (typing || doc.querySelector('[role="dialog"], .modal')) return false;
  return doc.hidden || now - lastInputAt >= QUIET_MS;
}

/** helperNewer: the helper's version when it is newer than this page knows, else 0. */
export function startAutoReload(helperNewer: () => number): void {
  const mine = scriptName(document.documentElement.outerHTML);
  let lastInputAt = Date.now();
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, () => (lastInputAt = Date.now()), { passive: true, capture: true });
  let pending = false;
  const tryReload = () => {
    if (pending && quietNow(document, lastInputAt, Date.now(), location.hash)) location.reload();
  };
  const check = async () => {
    // the helper is ahead of this page: reload once for that version (the site may not be published yet)
    const ahead = helperNewer();
    if (!pending && ahead) {
      let done = '';
      try {
        done = sessionStorage.getItem('tp:reloadedForHelper') ?? '';
        if (done !== String(ahead)) sessionStorage.setItem('tp:reloadedForHelper', String(ahead));
      } catch {
        done = String(ahead); // no storage: don't risk a loop
      }
      if (done !== String(ahead)) pending = true;
    }
    if (!pending && mine) {
      try {
        const html = await (await fetch(`${location.pathname}?v=${Date.now()}`, { cache: 'no-store' })).text();
        const latest = scriptName(html);
        if (latest && latest !== mine) pending = true;
      } catch {
        /* offline: try again next time */
      }
    }
    tryReload();
  };
  window.setInterval(() => void check(), CHECK_MS);
  window.setInterval(tryReload, 15_000);
  document.addEventListener('visibilitychange', tryReload);
}
