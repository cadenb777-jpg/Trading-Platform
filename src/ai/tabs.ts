/**
 * Which platform tab carries out the pop-out AI window's actions. Only one tab must answer (or an alert would be
 * created twice): the main tab the owner focused last claims the role by writing its id under ACTION_TAB_KEY, and
 * the pop-out addresses every request to that id. Undo ids carry the id of the tab that holds them ("<tab>.<n>").
 *
 * Pure: tested in tabs.test.ts.
 */
export const ACTION_TAB_KEY = 'tp:ai:action-tab';

export interface TabMessage {
  kind?: string;
  /** The tab that should answer; others ignore the message. */
  target?: string;
}

/** True when this tab should carry out (and answer) a request from the pop-out. */
export function addressedTo(msg: TabMessage, tabId: string): boolean {
  return !!msg.target && msg.target === tabId;
}

/** The tab that holds an undo id ("abc.3" -> "abc"). */
export function undoOwner(undoId: string): string {
  const dot = undoId.lastIndexOf('.');
  return dot > 0 ? undoId.slice(0, dot) : '';
}

/** Undo ids grouped by the tab holding them, keeping their order. */
export function groupByOwner(undoIds: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const id of undoIds) {
    const owner = undoOwner(id);
    if (!owner) continue;
    out.set(owner, [...(out.get(owner) ?? []), id]);
  }
  return out;
}
