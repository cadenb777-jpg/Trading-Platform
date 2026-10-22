/** Favourite timeframes as buttons, plus a menu with every timeframe where you can star favourites. */
import { TIMEFRAME_DEFS, type Timeframe, type TimeframeGroup } from '../types';
import { h, openPopover } from './dom';
import { icon } from './icons';

const GROUPS: TimeframeGroup[] = ['Seconds', 'Minutes', 'Hours', 'Days'];

export function createTimeframePicker(opts: {
  getCurrent: () => Timeframe;
  getFavorites: () => Timeframe[];
  onSelect: (tf: Timeframe) => void;
  onFavoritesChange: (favorites: Timeframe[]) => void;
}) {
  const buttons = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Timeframe' });
  const moreBtn = h('button', { class: 'icon-btn tf-more', title: 'All timeframes', 'aria-label': 'All timeframes' }, icon('chevron', 20));
  const el = h('div', { class: 'tf-picker' }, buttons, moreBtn);
  const ordered = (list: Timeframe[]) => TIMEFRAME_DEFS.map((d) => d.id).filter((id) => list.includes(id));

  const render = () => {
    const current = opts.getCurrent();
    const shown = ordered([...new Set([...opts.getFavorites(), current])]);
    buttons.replaceChildren(
      ...shown.map((tf) =>
        h('button', { class: tf === current ? 'active' : '', 'aria-pressed': tf === current, title: TIMEFRAME_DEFS.find((d) => d.id === tf)!.label, onclick: () => opts.onSelect(tf) }, tf),
      ),
    );
  };

  moreBtn.addEventListener('click', () => {
    const menu = h('div', { class: 'tf-menu' });
    const renderMenu = () => {
      const current = opts.getCurrent();
      const favorites = opts.getFavorites();
      menu.replaceChildren(
        ...GROUPS.flatMap((group) => [
          h('div', { class: 'menu-heading' }, group),
          ...TIMEFRAME_DEFS.filter((d) => d.group === group).map((d) => {
            const fav = favorites.includes(d.id);
            return h(
              'div',
              { class: `menu-item${d.id === current ? ' active' : ''}` },
              h('button', { class: 'menu-label', onclick: () => (opts.onSelect(d.id), close()) }, d.label),
              h(
                'button',
                {
                  class: `star${fav ? ' on' : ''}`,
                  title: fav ? 'Remove from favourites' : 'Add to favourites',
                  'aria-pressed': fav,
                  onclick: () => {
                    opts.onFavoritesChange(fav ? favorites.filter((f) => f !== d.id) : ordered([...favorites, d.id]));
                    renderMenu();
                    render();
                  },
                },
                icon('star', 17),
              ),
            );
          }),
        ]),
      );
    };
    renderMenu();
    const close = openPopover(moreBtn, menu);
  });

  render();
  return { el, render };
}
