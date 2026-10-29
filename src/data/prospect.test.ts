import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyForm, formToQuery } from '../prospect/logic';
import { prospectExport, prospectSearch } from './prospect';
import { clearEngineCache, engineRequest, helper } from './schwab';

describe('prospect requests through the real message path', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearEngineCache('prospect.');
  });
  it('sends the type filter as `types` (`type` is the message kind and is refused)', async () => {
    const sent: Record<string, unknown>[] = [];
    vi.spyOn(helper, 'request').mockImplementation(async (msg: Record<string, unknown>) => {
      sent.push(msg);
      return { type: 'engine', data: { total: 0, rows: [], csv: '', count: 0, columns: [] } } as never;
    });
    const fo = formToQuery({ ...emptyForm(), types: ['Likely family office', 'Multi-family office'], text: 'smith' }).query;
    await prospectSearch({ ...fo, limit: 100, offset: 0 });
    await prospectExport({ ...fo, limit: 5000 });
    expect(sent[0]).toMatchObject({ type: 'prospect.search', types: ['Likely family office', 'Multi-family office'], text: 'smith' });
    expect((sent[1].query as Record<string, unknown>).types).toEqual(['Likely family office', 'Multi-family office']);
    await expect(engineRequest('prospect.search', { type: ['Registered RIA'] })).rejects.toThrow(/reserved/);
  });
});
