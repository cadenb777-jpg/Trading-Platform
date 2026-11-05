/**
 * Links into the journal from other pages. Pages dispatch `tp:open-journal` ({symbol, orderId?, sync?}); main.ts opens
 * the Journal page on that symbol. `journalSymbols` holds the symbols with journal trades once the journal has been
 * read (the ticker card shows "My trades" only for those).
 */
export const journalSymbols = new Set<string>();

export function openJournal(detail: { symbol?: string; orderId?: string; sync?: boolean } = {}) {
  window.dispatchEvent(new CustomEvent('tp:open-journal', { detail }));
}
