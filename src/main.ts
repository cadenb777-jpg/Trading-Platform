import './style.css';
import { createCalendarPage } from './pages/calendarPage';
import { createChartPage } from './pages/chartPage';
import { createHomePage } from './pages/homePage';
import { createScriptsPage } from './pages/scriptsPage';
import { h } from './ui/dom';
import { icon } from './ui/icons';

type Route = 'home' | 'chart' | 'calendar' | 'scripts';

const chartPage = createChartPage();
const calendarPage = createCalendarPage();
const scriptsPage = createScriptsPage({
  onAddToChart: (defId) => {
    chartPage.addIndicatorById(defId);
    location.hash = '#chart';
  },
  onScriptSaved: (defId) => chartPage.refreshIndicatorsFor(defId),
});
const homePage = createHomePage(
  (ref) => {
    chartPage.open(ref);
    location.hash = '#chart';
  },
  () => (location.hash = '#calendar'),
);

const navButton = (route: Route, label: string, iconName: 'home' | 'chart' | 'calendar' | 'code') =>
  h('a', { class: 'nav-btn', href: `#${route}`, 'data-route': route, title: label, 'aria-label': label }, icon(iconName, 26), h('span', { class: 'nav-label' }, label));

const views = h('div', { class: 'views' }, homePage.el, chartPage.el, calendarPage.el, scriptsPage.el);
document.querySelector('#app')!.append(
  h(
    'nav',
    { class: 'rail', 'aria-label': 'Main' },
    h('div', { class: 'brand', title: 'Trading Platform' }, '◆'),
    navButton('home', 'Home', 'home'),
    navButton('chart', 'Chart', 'chart'),
    navButton('calendar', 'Calendar', 'calendar'),
    navButton('scripts', 'Scripts', 'code'),
  ),
  views,
);

function route() {
  const routes: Route[] = ['chart', 'calendar', 'scripts'];
  const current: Route = routes.find((r) => location.hash === `#${r}`) ?? 'home';
  homePage.el.hidden = current !== 'home';
  chartPage.el.hidden = current !== 'chart';
  calendarPage.el.hidden = current !== 'calendar';
  scriptsPage.el.hidden = current !== 'scripts';
  document.querySelectorAll<HTMLElement>('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.route === current));
  if (current === 'chart') chartPage.start();
  else if (current === 'scripts') {
    scriptsPage.start();
    document.title = 'Scripts · Trading Platform';
  } else if (current === 'calendar') {
    calendarPage.start();
    document.title = 'Economic calendar · Trading Platform';
  } else {
    homePage.start();
    document.title = 'Trading Platform';
  }
}

window.addEventListener('hashchange', route);
route();
