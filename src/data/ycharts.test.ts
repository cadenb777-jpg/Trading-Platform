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

import { catalogFromRows, searchCatalog, ETF_METRICS } from './ycharts';

describe('YCharts reference workbook', () => {
  const sheets = [
    { name: 'Company | Metrics', rows: [['YCharts Excel Add-In Company Metrics'], ['Metric Name', 'Financial Statement', 'Metric Code', 'Syntax'], ['Free Cash Flow', '', 'free_cash_flow_ttm', 'YCP("MSFT","free_cash_flow_ttm")'], ['PE Ratio', '', 'pe_ratio', '']] },
    { name: 'Mutual Fund | Metrics', rows: [['Metric Name', 'Metric Code', 'Syntax'], ['Net Expense Ratio', 'expense_ratio', ''], ['bad', 'Not A Code', '']] },
    { name: 'YCS Parameter Options', rows: [['Param Name', 'Param Option'], ['start_date', 'YYYY-MM-DD']] },
  ];
  it('reads every sheet with a Metric Code column', () => {
    const cat = catalogFromRows(sheets);
    expect(cat.map((e) => e.code)).toEqual(['free_cash_flow_ttm', 'pe_ratio', 'expense_ratio']);
    expect(cat[0]).toEqual({ code: 'free_cash_flow_ttm', name: 'Free Cash Flow', group: 'Company | Metrics' });
  });
  it('finds metrics by words in any order, the right kind first', () => {
    const cat = catalogFromRows(sheets);
    expect(searchCatalog(cat, 'cash free').map((e) => e.code)).toEqual(['free_cash_flow_ttm']);
    expect(searchCatalog(cat, 'ratio', 'Mutual Fund')[0].code).toBe('expense_ratio');
    expect(searchCatalog(cat, '')).toEqual([]);
  });
  it('has valid ETF codes too', () => {
    expect(ETF_METRICS.every((m) => /^[a-z0-9_]+$/.test(m.code))).toBe(true);
  });
});

describe('YCharts client privacy', () => {
  it('leaves Model Portfolio and User Info sheets out of the catalog', () => {
    const cat = catalogFromRows([
      { name: 'Model Portfolio | Metrics', rows: [['Metric Name', 'Metric Code'], ['1 Day Returns', 'roc_1']] },
      { name: 'User Info', rows: [['Metric Name', 'Metric Code'], ['Clients', 'client']] },
      { name: 'Company | Metrics', rows: [['Metric Name', 'Metric Code'], ['Price', 'price']] },
    ]);
    expect(cat.map((e) => e.code)).toEqual(['price']);
  });
});
