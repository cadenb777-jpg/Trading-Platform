import { describe, expect, it } from 'vitest';
import { contactsError, estimateText, LABEL_HELP, labelTone, reviewText, type EmailLabel } from './contactsApi';

describe('prospect contacts helpers', () => {
  it('only a published address gets the "up" tone; nothing is called verified', () => {
    const labels = Object.keys(LABEL_HELP) as EmailLabel[];
    expect(labels).toHaveLength(5);
    expect(labels.some((l) => /verified/i.test(l))).toBe(false);
    expect(labels.filter((l) => labelTone(l) === 'up')).toEqual(['published']);
    expect(labelTone('guess')).toBe('warn');
    expect(labelTone("catch-all (can't verify)")).toBe('warn');
  });
  it('review text', () => {
    expect(reviewText({ status: 'approved', reviewedOn: '2026-10-29' })).toBe('Reviewed by you on 29 Oct 2026');
    expect(reviewText({ status: 'pending', reviewedOn: null })).toBe('Not reviewed yet');
  });
  it('cost before running', () => {
    expect(estimateText({ pages: 6, costUsd: 0.1234 })).toBe('About 6 pages · ~$0.12');
    expect(estimateText({ pages: 1, costUsd: 0.004 })).toBe('About 1 page · under $0.01');
  });
  it('old helper message', () => {
    expect(contactsError(new Error('This helper doesn\'t know "prospect.crawl". Download the latest helper from GitHub and restart it.'))).toMatch(/newest helper/);
    expect(contactsError(new Error('No website on file'))).toBe('No website on file');
  });
});
