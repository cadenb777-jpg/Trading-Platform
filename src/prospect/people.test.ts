import { describe, expect, it } from 'vitest';
import { displayName, IAPD_SOURCE, levelCounts, mergePeople, seniority, type Person } from './people';

const person = (name: string, title: string, source = 'ADV Schedule A'): Person => ({ name, title, source, sourceRef: '', keyTitle: false, filed: '', ownership: '' });

describe('seniority', () => {
  it('sorts titles into levels', () => {
    expect(seniority('Chief Executive Officer')).toBe('exec');
    expect(seniority('Managing Partner')).toBe('exec');
    expect(seniority('Managing Director')).toBe('senior');
    expect(seniority('Senior Vice President')).toBe('senior');
    expect(seniority('Vice President, Portfolio Manager')).toBe('mid');
    expect(seniority('Vice President')).toBe('mid');
    expect(seniority('Investment adviser representative (Austin, TX; 12 yrs in the industry)', IAPD_SOURCE)).toBe('mid');
    expect(seniority('Registered representative', IAPD_SOURCE)).toBe('staff');
    expect(seniority('Research Analyst')).toBe('staff');
    expect(seniority('', 'ADV Schedule A')).toBe('exec');
    expect(seniority('', '13F signature')).toBe('unknown');
  });
  it('ignores words inside the IAPD brackets', () => {
    expect(seniority('Investment adviser representative (also a registered broker; Chief, TX)', IAPD_SOURCE)).toBe('mid');
  });
});

describe('people list', () => {
  it('drops IAPD rows already named in a filing and counts levels', () => {
    const list = mergePeople([person('DOE, JANE QUINCY', 'CEO'), person('JANE Q DOE', 'Investment adviser representative', IAPD_SOURCE), person('BOB ROE', 'Investment adviser representative', IAPD_SOURCE)]);
    expect(list.map((p) => p.name)).toEqual(['DOE, JANE QUINCY', 'BOB ROE']);
    expect(levelCounts(list)).toEqual({ exec: 1, senior: 0, mid: 1, staff: 0, unknown: 0 });
  });
  it('title-cases upper-case names only', () => {
    expect(displayName('JANE Q DOE')).toBe('Jane Q Doe');
    expect(displayName("MARY O'NEIL-SMITH")).toBe("Mary O'Neil-Smith");
    expect(displayName('McDonald, Ann')).toBe('McDonald, Ann');
  });
});
