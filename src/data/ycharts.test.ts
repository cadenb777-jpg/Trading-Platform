import { describe, expect, it } from 'vitest';
import { COMPANY_METRICS, FUND_METRICS, yFormat, ychartsId } from './ycharts';

describe('YCharts', () => {
  it('builds YCharts ids from tickers', () => {
    expect(ychartsId('vfiax', 'mutual_funds')).toBe('M:VFIAX');
    expect(ychartsId('M:VFIAX', 'mutual_funds')).toBe('M:VFIAX');
    expect(ychartsId('$SPX', 'indices')).toBe('^SPX');
    expect(ychartsId('aapl', 'companies')).toBe('AAPL');
  });
  it('formats figures by kind', () => {
    expect(yFormat(2.9e12, 'money')).toBe('$2.90T');
    expect(yFormat(5.234, 'pct')).toBe('5.23%');
    expect(yFormat(31.42, 'x')).toBe('31.4×');
    expect(yFormat(null, 'pct')).toBe('—');
    expect(yFormat('NASDAQ', 'num')).toBe('NASDAQ');
  });
  it('asks for valid, distinct metric codes', () => {
    for (const list of [COMPANY_METRICS, FUND_METRICS]) {
      const codes = list.map((x) => x.code);
      expect(new Set(codes).size).toBe(codes.length);
      expect(codes.every((c) => /^[a-z0-9_]+$/.test(c))).toBe(true);
      expect(codes.length).toBeLessThanOrEqual(40); // one request (the helper's limit)
    }
  });
});
