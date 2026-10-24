import { describe, expect, it } from 'vitest';
import { parseCsv } from '../invest/holdings';
import { jsonToRows, parseStatement } from './statement';

// Small made-up exports shaped like each broker's positions download (invented numbers, no real accounts).
const SCHWAB = `"Positions for account Individual ...123 as of 09:41 PM ET, 2026/10/23","","",""
"","","",""
"Symbol","Description","Qty (Quantity)","Price","Price Chng $ (Price Change $)","Mkt Val (Market Value)","Day Chng $ (Day Change $)","Cost Basis","Gain $ (Gain/Loss $)","Gain % (Gain/Loss %)","% of Acct (% of Account)","Security Type"
"SCHD","SCHWAB US DIVIDEND EQUITY ETF","150","$28.10","$0.12","$4,215.00","$18.00","$3,600.00","$615.00","17.08%","40.1%","ETF"
"O","REALTY INCOME CORP","40","$58.00","-$0.30","$2,320.00","-$12.00","$2,480.50","($160.50)","-6.47%","22.1%","Equity"
"KO","COCA-COLA CO","25","$70.00","$0.50","$1,750.00","$12.50","$1,250.00","$500.00","40.00%","16.6%","Equity"
"Cash & Cash Investments","--","--","--","--","$2,215.30","$0.00","--","--","--","21.1%","Cash and Money Market"
"Account Total","--","--","--","--","$10,500.30","$18.50","$7,330.50","$954.50","13.02%","--","--"`;

const FIDELITY = `Account Number,Account Name,Symbol,Description,Quantity,Last Price,Last Price Change,Current Value,Today's Gain/Loss Dollar,Today's Gain/Loss Percent,Total Gain/Loss Dollar,Total Gain/Loss Percent,Percent Of Account,Cost Basis Total,Average Cost Basis,Type
X12345678,Individual,SPAXX**,HELD IN MONEY MARKET,,,,$1500.25,,,,,10.00%,,,Cash,
X12345678,Individual,JNJ,JOHNSON & JOHNSON COM,10,$160.00,+$1.00,$1600.00,+$10.00,+0.63%,+$100.00,+6.67%,10.67%,$1500.00,$150.00,Cash,
X12345678,Individual,VYM,VANGUARD HIGH DIVIDEND YIELD ETF,20.5,$130.00,-$0.50,$2665.00,-$10.25,-0.38%,+$615.00,+30.00%,17.77%,$2050.00,$100.00,Cash,
Z98765432,ROTH IRA,JNJ,JOHNSON & JOHNSON COM,5,$160.00,+$1.00,$800.00,+$5.00,+0.63%,+$50.00,+6.67%,5.33%,$750.00,$150.00,Cash,
Z98765432,ROTH IRA,Pending Activity,,,,,$-25.00,,,,,,,,,

"The data and information in this spreadsheet is provided to you solely for your use and is not for distribution."
"Date downloaded 10/23/2026 9:15 PM ET"`;

const VANGUARD = `Account Number,Investment Name,Symbol,Shares,Share Price,Total Value,
12345678,VANGUARD FEDERAL MONEY MARKET INVESTOR,VMFXX,312.45,1.00,312.45,
12345678,VANGUARD TOTAL STOCK MARKET ETF,VTI,12.0000,300.00,3600.00,
12345678,VANGUARD REAL ESTATE ETF,VNQ,8.5,90.00,765.00,



Account Number,Trade Date,Settlement Date,Transaction Type,Transaction Description,Investment Name,Symbol,Shares,Share Price,Principal Amount,Commissions and Fees,Net Amount,Accrued Interest,Account Type,
12345678,2026-10-01,2026-10-02,Buy,Buy,VANGUARD TOTAL STOCK MARKET ETF,VTI,1.0000,300.00,-300.00,0.0,-300.00,0.0,CASH,`;

const ROBINHOOD = `Name,Symbol,Shares,Price,Average Cost,Total Return,Equity
Apple,AAPL,3.25,"$230.00","$150.00","$260.00","$747.50"
Main Street Capital,MAIN,30,"$60.00","$45.10","$447.00","$1,800.00"`;

const WEBULL = `Symbol,Name,Quantity,Last Price,Avg Cost,Market Value,Unrealized P&L,Unrealized P&L %
T,AT&T INC,100,22.50,18.00,"2,250.00",450.00,25.00%
PEP,PEPSICO INC,4,150.00,170.00,600.00,(80.00),-11.76%`;

const rows = (text: string) => parseCsv(text);

describe('statement import', () => {
  it('reads a Schwab positions export: title rows, cash and the total row', () => {
    const r = parseStatement(rows(SCHWAB));
    expect(r.headers[r.columns.cost!]).toBe('Cost Basis');
    expect(r.headers[r.columns.value!]).toMatch(/Mkt Val/);
    expect(r.positions.map((p) => p.symbol)).toEqual(['SCHD', 'O', 'KO', 'CASH']);
    expect(r.positions[1]).toMatchObject({ shares: 40, cost: 2480.5, value: 2320 });
    expect(r.positions[3]).toMatchObject({ cash: true, value: 2215.3 });
  });

  it('reads Fidelity: money market, the same stock in two accounts, pending and disclaimers', () => {
    const r = parseStatement(rows(FIDELITY));
    expect(r.headers[r.columns.cost!]).toBe('Cost Basis Total');
    expect(r.headers[r.columns.costPerShare!]).toBe('Average Cost Basis');
    expect(r.positions.map((p) => p.symbol)).toEqual(['JNJ', 'VYM', 'CASH']);
    expect(r.positions[0]).toMatchObject({ shares: 15, cost: 2250, value: 2400 });
    expect(r.positions[1].shares).toBe(20.5);
    expect(r.positions[2].value).toBe(1500.25);
  });

  it('reads Vanguard (no cost basis) and stops at the transactions table', () => {
    const r = parseStatement(rows(VANGUARD));
    expect(r.columns.cost).toBeUndefined();
    expect(r.positions.map((p) => p.symbol)).toEqual(['VTI', 'VNQ', 'CASH']);
    expect(r.positions[0]).toMatchObject({ shares: 12, value: 3600 });
    expect(r.positions[0].cost).toBeUndefined();
    expect(r.positions[2].value).toBe(312.45);
  });

  it('turns average cost per share into total cost (Robinhood, Webull)', () => {
    const rh = parseStatement(rows(ROBINHOOD));
    expect(rh.positions[0]).toMatchObject({ symbol: 'AAPL', shares: 3.25, cost: 487.5, value: 747.5 });
    const wb = parseStatement(rows(WEBULL));
    expect(wb.positions.map((p) => [p.symbol, p.cost])).toEqual([
      ['T', 1800],
      ['PEP', 680],
    ]);
  });

  it('lets the owner correct the column match', () => {
    const r = parseStatement(rows(WEBULL), { symbol: 0, shares: 2, cost: 5 }); // use market value as the cost
    expect(r.positions[0].cost).toBe(2250);
  });

  it('finds nothing in a file without a positions table', () => {
    expect(parseStatement(rows('Date,Amount\n2026-01-01,5')).positions).toEqual([]);
  });

  it('reads the AI’s JSON reading of a PDF', () => {
    const text = 'Here it is:\n```json\n[{"symbol":"PG","name":"Procter & Gamble","shares":12,"costBasis":1800,"marketValue":2000}]\n```';
    expect(parseStatement(jsonToRows(text)).positions[0]).toMatchObject({ symbol: 'PG', shares: 12, cost: 1800, value: 2000 });
  });
});
