import { describe, expect, it } from 'vitest';
import { parseCsv } from '../invest/holdings';
import { nyTime, parseExport, parseWhen, readSide } from './importers';

const read = (csv: string) => parseExport(parseCsv(csv));
const at = (y: number, mo: number, d: number, hh = 12, mm = 0, ss = 0) => nyTime(y, mo, d, hh, mm, ss);

describe('dates and sides', () => {
  it('reads the date formats brokers use, in New York time', () => {
    expect(parseWhen('10/21/2024 09:31:05 EDT')).toEqual({ time: Date.UTC(2024, 9, 21, 13, 31, 5) / 1000, hasTime: true });
    expect(parseWhen('20241021;093105')!.time).toBe(Date.UTC(2024, 9, 21, 13, 31, 5) / 1000);
    expect(parseWhen('2024-01-16, 10:00:00')!.time).toBe(Date.UTC(2024, 0, 16, 15, 0, 0) / 1000); // winter: UTC-5
    expect(parseWhen('10/21/24')).toEqual({ time: at(2024, 10, 21), hasTime: false });
    expect(parseWhen('10/21/2024 as of 10/18/2024')!.time).toBe(at(2024, 10, 21));
    expect(parseWhen('2024-10-21T13:31:05Z')!.time).toBe(Date.UTC(2024, 9, 21, 13, 31, 5) / 1000);
    expect(parseWhen('3:15 PM', '')).toBeNull();
    expect(parseWhen('')).toBeNull();
  });
  it('reads buy, sell, short and cover', () => {
    expect(readSide('YOU BOUGHT APPLE INC (AAPL) (Cash)', 10)).toEqual({ side: 'BUY' });
    expect(readSide('Sell Short', -5)).toEqual({ side: 'SELL', open: 'short' });
    expect(readSide('Buy to Cover', 5)).toEqual({ side: 'BUY' });
    expect(readSide('', -3, 'O')).toEqual({ side: 'SELL', open: 'short' });
    expect(readSide('', 3)).toEqual({ side: 'BUY' });
    expect(readSide('Qualified Dividend', null)).toBeNull();
  });
});

describe('broker presets', () => {
  it('Webull orders export: filled orders only, times with zone', () => {
    const r = read(`Name,Symbol,Side,Status,Filled,Total Qty,Price,Avg Price,Time-in-Force,Placed Time,Filled Time
NVIDIA CORP,NVDA,Sell,Filled,10,10,@135.00,135.20,DAY,10/22/2024 10:01:00 EDT,10/22/2024 10:01:02 EDT
NVIDIA CORP,NVDA,Buy,Cancelled,0,10,@120.00,,DAY,10/21/2024 09:40:00 EDT,
NVIDIA CORP,NVDA,Buy,Filled,10,10,@130.00,129.95,DAY,10/21/2024 09:31:00 EDT,10/21/2024 09:31:05 EDT
`);
    expect(r.preset.id).toBe('webull');
    expect(r.fills).toEqual([
      { symbol: 'NVDA', side: 'BUY', qty: 10, price: 129.95, time: Date.UTC(2024, 9, 21, 13, 31, 5) / 1000, fees: 0 },
      { symbol: 'NVDA', side: 'SELL', qty: 10, price: 135.2, time: Date.UTC(2024, 9, 22, 14, 1, 2) / 1000, fees: 0 },
    ]);
    expect(r.skipped).toBe(1);
  });

  it('Schwab transactions: actions, $ amounts, dividends skipped, newest first put in order', () => {
    const r = read(`"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"
"10/23/2024","Buy to Cover","TSLA","TESLA INC","5","$210.00","","-$1,050.00"
"10/22/2024 as of 10/21/2024","Sell Short","TSLA","TESLA INC","5","$220.50","$0.03","$1,102.47"
"10/21/2024","Qualified Dividend","AAPL","APPLE INC","","","","$12.00"
"10/18/2024","Sell","AAPL","APPLE INC","10","$235.10","$0.02","$2,350.98"
"10/17/2024","Buy","AAPL","APPLE INC","10","$232.00","","-$2,320.00"
`);
    expect(r.preset.id).toBe('schwab');
    expect(r.fills.map((f) => [f.symbol, f.side, f.open ?? '', f.qty, f.price, f.fees])).toEqual([
      ['AAPL', 'BUY', '', 10, 232, 0],
      ['AAPL', 'SELL', '', 10, 235.1, 0.02],
      ['TSLA', 'SELL', 'short', 5, 220.5, 0.03],
      ['TSLA', 'BUY', '', 5, 210, 0],
    ]);
    expect(r.fills[0].time).toBeLessThan(r.fills[1].time);
    expect(r.skipped).toBe(1);
  });

  it('TD Ameritrade: side and symbol from the description, transaction id kept', () => {
    const r = read(`DATE,TRANSACTION ID,DESCRIPTION,QUANTITY,SYMBOL,PRICE,COMMISSION,AMOUNT,REG FEE,SHORT-TERM RDM FEE,FUND REDEMPTION FEE, DEFERRED SALES CHARGE
03/02/2023,48213307542,Bought 20 AMD @ 78.10,20,AMD,78.10,0.00,-1562.00,,,,
03/09/2023,48299901234,Sold 20 AMD @ 81.00,20,AMD,81.00,0.00,1619.95,0.05,,,
03/10/2023,48300000001,ORDINARY DIVIDEND (AMD),,AMD,,,4.00,,,,
***END OF FILE***
`);
    expect(r.preset.id).toBe('tda');
    expect(r.fills.map((f) => [f.side, f.qty, f.price, f.fees, f.orderId])).toEqual([
      ['BUY', 20, 78.1, 0, '48213307542'],
      ['SELL', 20, 81, 0.05, '48299901234'],
    ]);
  });

  it('Fidelity history: preamble lines, negative sold quantity', () => {
    const r = read(`
Brokerage

Run Date,Action,Symbol,Description,Type,Quantity,Price ($),Commission ($),Fees ($),Accrued Interest ($),Amount ($),Settlement Date
10/18/2024,YOU SOLD MICROSOFT CORP (MSFT) (Cash),MSFT,MICROSOFT CORP,Cash,-3,416.50,,0.01,,1249.49,10/21/2024
10/16/2024,YOU BOUGHT MICROSOFT CORP (MSFT) (Cash),MSFT,MICROSOFT CORP,Cash,3,410.00,,,,-1230.00,10/18/2024
10/15/2024,DIVIDEND RECEIVED MICROSOFT CORP (MSFT) (Cash),MSFT,MICROSOFT CORP,Cash,0.000,,,,,2.49,

"The data and information in this spreadsheet is provided to you solely for your use"
`);
    expect(r.preset.id).toBe('fidelity');
    expect(r.fills.map((f) => [f.side, f.qty, f.price, f.fees])).toEqual([
      ['BUY', 3, 410, 0],
      ['SELL', 3, 416.5, 0.01],
    ]);
  });

  it('Interactive Brokers Flex: futures multiplier, commission, open/close, trade id', () => {
    const r = read(`ClientAccountID,Symbol,AssetClass,Buy/Sell,Quantity,TradePrice,DateTime,IBCommission,Multiplier,TradeID,Open/CloseIndicator,Currency
U1234567,MESZ4,FUT,SELL,-2,5850.25,20241021;093105,-1.24,5,701111,O,USD
U1234567,MESZ4,FUT,BUY,2,5840.00,20241021;101500,-1.24,5,701112,C,USD
U1234567,AAPL,STK,BUY,100,232.10,20241021;094000,-0.50,1,701113,O,USD
`);
    expect(r.preset.id).toBe('ibkr');
    expect(r.fills[0]).toEqual({ symbol: 'MESZ4', side: 'SELL', open: 'short', qty: 2, price: 5850.25, time: Date.UTC(2024, 9, 21, 13, 31, 5) / 1000, fees: 1.24,
      orderId: '701111', account: 'U1234567', assetClass: 'futures', multiplier: 5 });
    expect(r.fills[2]).toMatchObject({ symbol: 'AAPL', side: 'BUY', assetClass: 'stock', multiplier: 1 });
  });

  it('Interactive Brokers Activity Statement: only the Trades section, signed quantities', () => {
    const r = read(`Statement,Header,Field Name,Field Value
Statement,Data,Title,Activity Statement
Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code
Trades,Data,Order,Stocks,USD,SPY,"2024-10-21, 09:45:00",50,581.2,582,-29060,-1,29061,0,40,O
Trades,Data,Order,Stocks,USD,SPY,"2024-10-21, 15:10:00",-50,583.0,582,29150,-1,-29061,88,0,C
Trades,SubTotal,,Stocks,USD,SPY,,0,,,90,-2,,88,,
Trades,Total,,Stocks,USD,,,,,,90,-2,,88,,
Dividends,Header,Currency,Date,Description,Amount
`);
    expect(r.preset.id).toBe('ibkr_activity');
    expect(r.fills.map((f) => [f.symbol, f.side, f.qty, f.price, f.fees, f.assetClass])).toEqual([
      ['SPY', 'BUY', 50, 581.2, 1, 'stock'],
      ['SPY', 'SELL', 50, 583, 1, 'stock'],
    ]);
  });

  it('Robinhood activity: trade codes only', () => {
    const r = read(`"Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"
"10/22/2024","10/22/2024","10/23/2024","AMZN","Amazon
CUSIP: 023135106","Sell","4","$189.50","$757.98"
"10/21/2024","10/21/2024","10/22/2024","AMZN","Amazon","Buy","4","$186.00","($744.00)"
"10/21/2024","10/21/2024","10/21/2024","","ACH Deposit","ACH","","","$1,000.00"
"10/18/2024","10/18/2024","10/18/2024","AMZN","Cash Div: R/D 2024-10-18","CDIV","","","$0.40"
`);
    expect(r.preset.id).toBe('robinhood');
    expect(r.fills.map((f) => [f.symbol, f.side, f.qty, f.price])).toEqual([
      ['AMZN', 'BUY', 4, 186],
      ['AMZN', 'SELL', 4, 189.5],
    ]);
    expect(r.skipped).toBe(2);
  });

  it('E*TRADE transactions: Bought / Sold Short / Bought To Cover', () => {
    const r = read(`TransactionDate,TransactionType,SecurityType,Symbol,Quantity,Amount,Price,Commission,Description
10/24/24,Bought To Cover,EQ,META,5,-2850.00,570.00,0,META PLATFORMS INC
10/22/24,Sold Short,EQ,META,-5,2900.00,580.00,0,META PLATFORMS INC
10/21/24,Dividend,EQ,KO,0,12.10,0,0,COCA COLA
10/21/24,Bought,EQ,KO,10,-700,70.00,0,COCA COLA
`);
    expect(r.preset.id).toBe('etrade');
    expect(r.fills.map((f) => [f.symbol, f.side, f.open ?? '', f.qty, f.price, f.assetClass])).toEqual([
      ['KO', 'BUY', '', 10, 70, 'stock'],
      ['META', 'SELL', 'short', 5, 580, 'stock'],
      ['META', 'BUY', '', 5, 570, 'stock'],
    ]);
  });

  it('any other export falls back to a generic column match', () => {
    const r = read(`Trade Date,Ticker,Type,Shares,Fill Price,Commission
2024-10-21 10:00,QQQ,BUY,5,490.10,0.35
2024-10-21 11:00,QQQ,SELL,5,492.00,0.35
`);
    expect(r.preset.id).toBe('generic');
    expect(r.fills).toHaveLength(2);
    expect(r.fills[1]).toMatchObject({ symbol: 'QQQ', side: 'SELL', qty: 5, price: 492, fees: 0.35 });
  });
});
