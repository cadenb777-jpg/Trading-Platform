import { describe, expect, it } from 'vitest';
import { nextStage, pipelineColumns } from './pipeline';

const note = (id: string, status: 'not contacted' | 'contacted' | 'meeting' | 'client' | 'do not contact', updated: number) => ({ id, firmName: id, status, notes: '', updated });

describe('prospect pipeline', () => {
  it('groups firms by stage, newest first', () => {
    const cols = pipelineColumns([note('a', 'contacted', 1), note('b', 'contacted', 5), note('c', 'client', 2), note('d', 'do not contact', 3)]);
    expect(cols.contacted.map((n) => n.id)).toEqual(['b', 'a']);
    expect(cols.client.map((n) => n.id)).toEqual(['c']);
    expect(cols['do not contact'].map((n) => n.id)).toEqual(['d']);
    expect(cols.meeting).toEqual([]);
  });
  it('moves one stage at a time and never past the ends', () => {
    expect(nextStage('contacted', 1)).toBe('meeting');
    expect(nextStage('contacted', -1)).toBe('not contacted');
    expect(nextStage('client', 1)).toBeNull();
    expect(nextStage('not contacted', -1)).toBeNull();
    expect(nextStage('do not contact', 1)).toBeNull();
  });
});
