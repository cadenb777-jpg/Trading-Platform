import './style.css';
import { createChartPage } from './pages/chartPage';
import { createHomePage } from './pages/homePage';
import { h } from './ui/dom';
import { icon } from './ui/icons';

type Route = 'home' | 'chart';

const chartPage = createChartPage();
const homePage = createHomePage((ref) => {
  chartPage.open(ref);
  location.hash = '#chart';
});

const navButton = (route: Route, label: string, iconName: 'home' | 'chart') =>
  h('a', { class: 'nav-btn', href: `#${route}`, 'data-route': route, title: label, 'aria-label': label }, icon(iconName, 22), h('span', { class: 'nav-label' }, label));

const views = h('div', { class: 'views' }, homePage.el, chartPage.el);
document.querySelector('#app')!.append(
  h(
    'nav',
    { class: 'rail', 'aria-label': 'Main' },
    h('div', { class: 'brand', title: 'Trading Platform' }, '◆'),
    navButton('home', 'Home', 'home'),
    navButton('chart', 'Chart', 'chart'),
  ),
  views,
);

function route() {
  const current: Route = location.hash === '#chart' ? 'chart' : 'home';
  homePage.el.hidden = current !== 'home';
  chartPage.el.hidden = current !== 'chart';
  document.querySelectorAll<HTMLElement>('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.route === current));
  if (current === 'chart') chartPage.start();
  else {
    homePage.start();
    document.title = 'Trading Platform';
  }
}

window.addEventListener('hashchange', route);
route();
