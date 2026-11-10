/**
 * Clickjacking guard: the platform never runs inside another website's frame. A hostile page could otherwise load it
 * invisibly and trick clicks (an order's Confirm button) through its own page. GitHub Pages can't send the
 * frame-ancestors header and a <meta> CSP can't set it, so the page checks itself. main.ts runs this before loading
 * the platform (src/app.ts) at all; when framed, only a short note shows.
 */

/** True when this window is inside a frame (or the browser won't even say, which counts as framed). */
export function isFramed(win: Pick<Window, 'self' | 'top'>): boolean {
  try {
    return win.self !== win.top;
  } catch {
    return true;
  }
}

/** When framed: replaces the page with a short note and returns true (the caller then loads nothing else). */
export function stopIfFramed(win: Window): boolean {
  if (!isFramed(win)) return false;
  const doc = win.document;
  const p = doc.createElement('p');
  p.textContent = 'For your safety the Trading Platform only opens in its own tab or app window, not inside another website.';
  p.style.cssText = 'font:16px system-ui;padding:24px;color:#e8eef6;background:#0a1a2e;margin:0;min-height:100vh';
  doc.body.replaceChildren(p);
  return true;
}
