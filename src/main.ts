import './style.css';
import { createCalendarPage } from './pages/calendarPage';
import { createChartPage } from './pages/chartPage';
import { createHomePage } from './pages/homePage';
import { h } from './ui/dom';
import { icon } from './ui/icons';

type Route = 'home' | 'chart' | 'calendar';

const chartPage = createChartPage();
const calendarPage = createCalendarPage();
const homePage = createHomePage(
  (ref) => {
    chartPage.open(ref);
    location.hash = '#chart';
  },
  () => (location.hash = '#calendar'),
);

const navButton = (route: Route, label: string, iconName: 'home' | 'chart' | 'calendar') =>
  h('a', { class: 'nav-btn', href: `#${route}`, 'data-route': route, title: label, 'aria-label': label }, icon(iconName, 26), h('span', { class: 'nav-label' }, label));

const views = h('div', { class: 'views' }, homePage.el, chartPage.el, calendarPage.el);
document.querySelector('#app')!.append(
  h(
    'nav',
    { class: 'rail', 'aria-label': 'Main' },
    h('div', { class: 'brand', title: 'Trading Platform' }, '◆'),
    navButton('home', 'Home', 'home'),
    navButton('chart', 'Chart', 'chart'),
    navButton('calendar', 'Calendar', 'calendar'),
  ),
  views,
);

function route() {
  const current: Route = location.hash === '#chart' ? 'chart' : location.hash === '#calendar' ? 'calendar' : 'home';
  homePage.el.hidden = current !== 'home';
  chartPage.el.hidden = current !== 'chart';
  calendarPage.el.hidden = current !== 'calendar';
  document.querySelectorAll<HTMLElement>('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.route === current));
  if (current === 'chart') chartPage.start();
  else if (current === 'calendar') {
    calendarPage.start();
    document.title = 'Economic calendar · Trading Platform';
  } else {
    homePage.start();
    document.title = 'Trading Platform';
  }
}

window.addEventListener('hashchange', route);
route();
