/**
 * What the user can see right now, as plain text for the AI assistant: the open page plus any open pop-up
 * (trade guide, fund detail...). Only rendered text counts, so folded sections and hidden tabs are left out.
 */
const MAX_CHARS = 8000;

export function screenText(page: HTMLElement | null | undefined): string {
  const parts: string[] = [];
  for (const modal of document.querySelectorAll<HTMLElement>('.modal')) parts.push(`[Pop-up open]\n${clean(modal.innerText)}`);
  if (page && !page.hidden) parts.push(clean(page.innerText));
  const text = parts.join('\n\n');
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n[…cut off]` : text;
}

function clean(s: string) {
  return s.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

/** Example questions for the page the user is on (shown when the chat is empty). */
export const PAGE_SUGGESTIONS: Record<string, string[]> = {
  home: ['Summarize what’s on my screen in 5 bullets', 'What moved the market today and why?', 'Which news here matters most for my watchlist?'],
  chart: ['Explain what this chart and its indicators are showing', 'Where are the key support and resistance levels?', 'Is this trend getting stronger or weaker?'],
  setups: ['Why is the average loss bigger than the average win on swing trades?', 'Why are there no A-grade setups right now?', 'Walk me through the best setup on screen step by step', 'What do the rule tests in Research tell me?'],
  invest: ['Summarize this board: what’s leading and what’s lagging?', 'What stands out in these numbers?', 'Explain this fund’s NAV and fees in plain words'],
  futures: ['Summarize the futures market today in 5 bullets', 'What do the biggest moves in σ tell me?', 'Explain contango and backwardation on this curve', 'Where are commercials at an extreme, and what does that mean?'],
  flow: ['What is options flow saying about this stock?', 'Are insiders buying or selling, and does it matter?', 'Summarize the positioning shown here'],
  research: ['Is this company cheap or expensive, and why?', 'Summarize the financials on screen', 'What are the biggest risks in these numbers?'],
  macro: ['Summarize the macro picture on this page in 5 bullets', 'What do these readings mean for stocks over the next 3 months?', 'Is recession risk rising or falling?', 'Explain the yield curve shown here in plain words'],
  trade: ['Explain the difference between a limit and a stop order', 'Is my position size reasonable for this stop?', 'What does buying power mean, and why did it change?', 'When would I use GTC instead of Day?'],
  account: ['Summarize my account in 5 bullets', 'Which holdings give me the most dividend income?', 'Am I too concentrated in any stock or sector?'],
  portfolio: ['Summarize this portfolio’s risk and return', 'What is the biggest risk in this portfolio?', 'Which holdings give me the most dividend income?', 'Is my dividend income well diversified?', 'Which dividends look at risk of a cut?'],
  backtest: ['Is this backtest result trustworthy or luck?', 'Explain the Monte Carlo and random-walk results', 'Why does this strategy lose in some years?'],
  calendar: ['Which events this week matter most for stocks?', 'Explain the latest actual vs forecast surprises', 'What should I watch out for before these releases?'],
};
