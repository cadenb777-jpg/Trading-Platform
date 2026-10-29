/**
 * Requests for website contacts, the review queue, the change watcher, the AI analyst and the do-not-contact list
 * (helper/engine/prospect_contacts.py), plus small pure helpers the UI and tests share.
 */
import { clearEngineCache, engineRequest, type EngineEvent } from '../data/schwab';

export type EmailLabel = 'published' | 'pattern + server-checked' | 'pattern + domain accepts mail' | 'guess' | "catch-all (can't verify)";
export type FactStatus = 'pending' | 'approved' | 'rejected';

interface FactBase {
  fid: number;
  sourceUrl: string | null;
  foundAt: string | null;
  origin: string;
  status: FactStatus;
  /** Set once approved in the Review tab. */
  reviewedOn: string | null;
}
export interface ContactEmail {
  email: string;
  label: EmailLabel;
  note?: string;
  pattern?: string;
  sourceUrl?: string | null;
  checkedOn?: string | null;
  doNotContact?: boolean;
  status?: FactStatus;
  reviewedOn?: string | null;
}
export interface ContactPhone extends Partial<FactBase> {
  number: string;
  kind: 'main' | 'direct';
  person?: string;
  source?: string;
  alsoOn?: string;
}
export interface ContactPerson extends FactBase {
  name: string;
  title: string;
  bio: string;
  note?: string;
  previousTitle?: string;
  email: ContactEmail | null;
  phones: ContactPhone[];
}
export interface FilingPerson {
  name: string;
  title: string;
  source: string;
  filed: string;
  email: ContactEmail | null;
}
export interface ContactsView {
  firmId: string;
  firmName: string;
  website: string | null;
  domain: string;
  crawl: { at: string | null; pages: number; status: string; note: string; skipped: { url: string; reason: string }[] } | null;
  people: ContactPerson[];
  filingPeople: FilingPerson[];
  generalEmails: (ContactEmail & FactBase)[];
  phones: ContactPhone[];
  focus: (FactBase & { tags: { tag: string; url: string }[]; sentences: { text: string; url: string }[] }) | null;
  pattern: { pattern: string; examples: string[]; matched: number } | null;
  domainCheck: { mx: string[]; mxOk: boolean | null; mxCheckedOn: string | null; via: string; catchAll: boolean | null; smtpCheckedOn: string | null; smtpNote: string } | null;
  aiFacts: (FactBase & { topic: string; text: string; quote: string })[];
  changes: (FactBase & { change: string; summary: string; date: string })[];
  optOut: { firm: boolean; byNote: boolean; emails: string[] };
  smtpCheck: boolean;
  watched: boolean;
  lastWatch: string | null;
  pagesSaved: number;
  lastCrawl?: { website: string; pages: number; status: string; note: string; counts: Record<string, number> };
}
export interface ReviewItem {
  fid: number;
  firmId: string;
  firmName: string;
  kind: 'person' | 'email' | 'phone' | 'focus' | 'ai' | 'change';
  origin: 'website' | 'ai' | 'watch';
  summary: string;
  sourceUrl: string | null;
  foundAt: string | null;
  status: FactStatus;
  decidedOn: string | null;
}
export interface WatchStatus {
  running: boolean;
  current: string | null;
  error: string | null;
  lastRun: string | null;
  nextRun: string | null;
  everyDays: number;
  max: number;
  firms: { firmId: string; name: string; starred: boolean; lastRun: string | null; note: string }[];
}
export interface AiEstimate { pages: number; sources: number; inputTokens: number; outputTokens: number; costUsd: number; model: string; aiKeySet: boolean }
export interface AiResult {
  kept: { topic: string; text: string; source: string; quote: string }[];
  dropped: { text?: string; source?: string; why: string }[];
  model: string;
}

// 'id' is reserved in helper messages, so the firm goes as firmId.
export const getContacts = (firmId: string) => engineRequest<ContactsView>('prospect.contacts', { firmId }, 30000);
export const crawlFirm = (firmId: string, website: string | undefined, onEvent?: (e: EngineEvent) => void) =>
  engineRequest<ContactsView>('prospect.crawl', { firmId, ...(website ? { website } : {}) }, 300000, onEvent);
export const checkEmails = (firmId: string) => engineRequest<ContactsView & { lastCheck: { checked: number; catchAll: boolean | null; note: string } }>('prospect.email_check', { firmId }, 120000);
export const aiEstimate = (firmId: string) => engineRequest<AiEstimate>('prospect.ai_profile', { firmId }, 20000);
export const aiProfile = (firmId: string, onEvent?: (e: EngineEvent) => void) => engineRequest<AiResult>('prospect.ai_profile', { firmId, run: true }, 600000, onEvent);
export const reviewList = (status: FactStatus = 'pending') => engineRequest<{ items: ReviewItem[]; counts: Record<FactStatus, number> }>('prospect.review.list', { status }, 20000);
export const reviewDecide = (fids: number[], decision: 'approve' | 'reject' | 'undo') => engineRequest<{ updated: number }>('prospect.review.decide', { fids, decision }, 20000);
export const watchStatus = () => engineRequest<WatchStatus>('prospect.watch.status', {}, 20000);
export const watchRun = (firmId?: string, onEvent?: (e: EngineEvent) => void) => engineRequest<WatchStatus & { note?: string; started?: boolean }>('prospect.watch.run', firmId ? { firmId } : {}, firmId ? 300000 : 20000, onEvent);
export const watchSet = (firmId: string, on: boolean) => engineRequest<{ watched: boolean }>('prospect.watch.set', { firmId, on }, 20000);
export async function optOutSet(target: { firmId: string } | { email: string }, on: boolean, reason = '') {
  const r = await engineRequest<{ on: boolean }>('prospect.optout.set', { ...target, on, reason }, 20000);
  clearEngineCache('prospect.');
  return r;
}
export const contactsExport = (firmIds?: string[], guesses = true) =>
  engineRequest<{ csv: string; rows: number; skippedFirms: number; skippedEmails: number }>('prospect.contacts_export', { ...(firmIds ? { firmIds } : {}), guesses }, 120000);

/** Badge tone per label: only a published address is "up"; nothing is ever called verified. */
export function labelTone(label: EmailLabel): string {
  return label === 'published' ? 'up' : label === 'pattern + server-checked' ? 'accent' : label === 'pattern + domain accepts mail' ? '' : 'warn';
}

export const LABEL_HELP: Record<EmailLabel, string> = {
  published: 'The firm prints this address on its own website.',
  'pattern + server-checked': 'Built from the firm\'s address pattern, and the mail server accepted the mailbox. Not the same as published: it may not be read.',
  'pattern + domain accepts mail': 'Built from the firm\'s address pattern; the domain receives email. The mailbox itself was not checked.',
  guess: 'A guess (the most common format, or a pattern the server could not confirm). Check before using.',
  "catch-all (can't verify)": 'This mail server accepts every address, so no check can tell whether the mailbox exists.',
};

/** "Reviewed by you on 29 Oct 2026" or "Not reviewed yet". */
export function reviewText(f: { status?: FactStatus; reviewedOn?: string | null }): string {
  if (f.status === 'approved' && f.reviewedOn) {
    const d = new Date(`${f.reviewedOn}T12:00:00`);
    return `Reviewed by you on ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  return 'Not reviewed yet';
}

/** "About 6 pages · ~$0.12" for the AI analyst's button (cost shown before running). */
export function estimateText(e: Pick<AiEstimate, 'pages' | 'costUsd'>): string {
  const cost = e.costUsd < 0.01 ? 'under $0.01' : `~$${e.costUsd.toFixed(2)}`;
  return `About ${e.pages} page${e.pages === 1 ? '' : 's'} · ${cost}`;
}

/** A helper without these requests answers "unknown request": say how to get them instead. */
export function contactsError(err: unknown): string {
  const text = (err as Error)?.message ?? String(err);
  return /unknown request|unknown engine|not supported/i.test(text) ? 'Contacts need the newest helper: download it again (Settings shows the update).' : text;
}
