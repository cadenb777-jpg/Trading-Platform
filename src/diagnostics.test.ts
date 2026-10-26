import { describe, expect, it } from 'vitest';
import { assembleDiagnostics, recordEngineError, engineErrors, redact, redactText, summarise, type BrowserSection } from './diagnostics';

const SECRETS = {
  anthropic: 'sk-ant-api03-FAKEanthropicKEYvalue0123456789',
  token: 'FakeRefreshToken-zz9',
  email: 'ownerfake@example.org',
  account: 'WB4XK29QZ7Q81',
  number: '5LT90417',
  long: 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo5ODc2',
  hex: '0123456789abcdef0123456789abcdef01',
  user: 'ownerfakename',
};

function browser(): BrowserSection {
  return {
    page: '#trade',
    appVersion: 'site for helper v34',
    browser: 'Mozilla/5.0 test',
    screen: '1280x800',
    helperConnected: true,
    helperVersion: 34,
    feeds: { webull: { state: 'error', lastError: `account ${SECRETS.account} refused` } },
    engineErrors: [{ at: 1, type: 'webull.snapshot', message: `Webull said refresh_token=${SECRETS.token} for ${SECRETS.email}` }],
    consoleErrors: [{ at: 2, message: `Failed at /Users/${SECRETS.user}/x.json with Bearer ${SECRETS.anthropic} https://x.com/a?apikey=${SECRETS.hex}` }],
  };
}

describe('diagnostics redaction', () => {
  it('masks seeded secrets in the assembled file', () => {
    const helper = {
      helperVersion: 34,
      requestSummary: { count: 2, failed: 1 },
      notes: { webull: [{ accountId: SECRETS.account, appKey: 'abc12345' }] },
      logTail: [`blob ${SECRETS.long} account number ${SECRETS.number}`],
    };
    const file = assembleDiagnostics(browser(), helper, 0);
    const text = JSON.stringify(file);
    for (const s of Object.values(SECRETS)) expect(text).not.toContain(s);
    expect(text).toContain('webull.snapshot');
    expect(text).toContain('account ••81 refused');
    expect(text).toContain('"accountId":"••81"');
    expect(text).toContain('"appKey":"[redacted]"');
    expect(text).toContain('?[query removed]');
    expect(file.kind).toBe('trading-platform-diagnostics');
  });

  it('keeps ordinary text and flags', () => {
    const plain = 'Sent 120 1D bars for AAPL at /trading/orders/historical-orders/list';
    expect(redactText(plain)).toBe(plain);
    expect(redact({ aiKeySet: true, count: 3 })).toEqual({ aiKeySet: true, count: 3 });
  });

  it('masks Windows paths with doubled backslashes and user names with spaces', () => {
    const t = redactText(String.raw`'C:\\Users\\Caden Fake\\Documents\\x.csv' C:\Users\Caden Fake\a /Users/Caden Fake/b /home/caden fake/c`);
    expect(t).not.toMatch(/caden/i);
    expect(t).toContain('Documents');
  });

  it('masks the Webull account-number shape in Webull lines only', () => {
    expect(redactText('Webull positions for 5LT90417 failed')).not.toContain('5LT90417');
    expect(redactText('Webull order AAPL ok')).toContain('AAPL');
  });

  it('masks /bot<token>/ paths and escaped name/value pairs', () => {
    const tok = '123456789:AAFakeTelegramBotTokenValue_abcdefghij';
    const t = redactText(`POST https://api.telegram.org/bot${tok}/sendMessage {\\"chat_id\\": \\"77665544\\", \\"topic\\": \\"zz\\"} key=abc12`);
    expect(t).not.toContain('AAFakeTelegram');
    expect(t).not.toContain('77665544');
    expect(t).not.toContain('"zz');
    expect(t).not.toContain('abc12');
  });

  it('records engine errors and summarises the file', () => {
    recordEngineError('futures.board', 'Schwab answered HTTP 500');
    expect(engineErrors.at(-1)?.type).toBe('futures.board');
    const lines = summarise(assembleDiagnostics(browser(), { unavailable: 'the helper isn’t running' }));
    expect(lines[0]).toContain('isn’t running');
    expect(lines.at(-2)).toContain('#trade');
    expect(lines.at(-1)).toContain('Not included: client or portfolio names');
  });
});
