import './style.css';
import { createCalendarPage } from './pages/calendarPage';
import { createChartPage } from './pages/chartPage';
import { createFlowPage } from './pages/flowPage';
import { createHomePage } from './pages/homePage';
import { createMultiChartPage } from './pages/multiChartPage';
import { createScriptsPage } from './pages/scriptsPage';
import type { MarketRef } from './data/quotes';
import { startAlertWatcher } from './ui/alerts';
import { h } from './ui/dom';
import { icon, type IconName } from './ui/icons';

interface Page {
  el: HTMLElement;
  start(): void;
  stop?(): void;
}

const openChart = (ref: MarketRef) => {
  chartPage.open(ref);
  location.hash = '#chart';
};

const chartPage = createChartPage();
const pages: { route: string; label: string; icon: IconName; title: string; page: Page }[] = [
  { route: 'home', label: 'Home', icon: 'home', title: 'Trading Platform', page: createHomePage(openChart, () => (location.hash = '#calendar')) },
  { route: 'chart', label: 'Chart', icon: 'chart', title: '', page: chartPage },
  { route: 'multi', label: 'Multi', icon: 'grid', title: 'Multi-chart', page: createMultiChartPage(openChart) },
  { route: 'flow', label: 'Flow', icon: 'flow', title: 'Flow', page: createFlowPage() },
  { route: 'calendar', label: 'Calendar', icon: 'calendar', title: 'Economic calendar', page: createCalendarPage() },
  {
    route: 'scripts',
    label: 'Scripts',
    icon: 'code',
    title: 'Scripts',
    page: createScriptsPage({
      onAddToChart: (defId) => {
        chartPage.addIndicatorById(defId);
        location.hash = '#chart';
      },
      onScriptSaved: (defId) => chartPage.refreshIndicatorsFor(defId),
    }),
  },
];

document.querySelector('#app')!.append(
  h(
    'nav',
    { class: 'rail', 'aria-label': 'Main' },
    h('div', { class: 'brand', title: 'Trading Platform' }, '◆'),
    ...pages.map((p) =>
      h('a', { class: 'nav-btn', href: `#${p.route}`, 'data-route': p.route, title: p.label, 'aria-label': p.label }, icon(p.icon, 24), h('span', { class: 'nav-label' }, p.label)),
    ),
  ),
  h('div', { class: 'views' }, ...pages.map((p) => p.page.el)),
);

function route() {
  const current = pages.find((p) => location.hash === `#${p.route}`) ?? pages[0];
  for (const p of pages) {
    p.page.el.hidden = p !== current;
    if (p !== current) p.page.stop?.();
  }
  document.querySelectorAll<HTMLElement>('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.route === current.route));
  current.page.start();
  if (current.title) document.title = current.title === 'Trading Platform' ? current.title : `${current.title} · Trading Platform`;
}

window.addEventListener('hashchange', route);
route();
startAlertWatcher();
