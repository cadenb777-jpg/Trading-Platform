/**
 * The Prospecting map (geofencing): firms as clustered pins on free OpenStreetMap tiles (Leaflet), the search radius
 * as a circle, click a pin for the firm profile, click the map to search around that point.
 *
 * Tiles: tile.openstreetmap.org, which its usage policy allows for light use with visible attribution (the browser
 * sends the page as Referer; tiles are cached by the browser). The page only asks for tiles while the map is shown.
 * When tiles can't load (offline, blocked), the pins still show on a plain background and a note says so.
 * Leaflet is loaded with this module (only when the map is first opened).
 */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { ProspectFirm } from '../data/prospect';
import { clusterPoints, moneyText, TYPE_SHORT } from './logic';

export interface ProspectMap {
  /** Shows these firms (those with a location); the radius circle when a centre is given. */
  setFirms(firms: ProspectFirm[], centre?: { lat: number; lon: number; miles: number } | null): void;
  /** Call after the map's box changes size or becomes visible. */
  resize(): void;
  destroy(): void;
}

const TYPE_CLASS: Record<string, string> = {
  'Registered RIA': 'ria',
  'Exempt reporting adviser': 'era',
  'Likely family office': 'fo',
  'Multi-family office': 'mfo',
  'Other 13F filer': 'other',
  'Form D issuer': 'other',
  'State-registered RIA': 'ria',
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function createProspectMap(container: HTMLElement, opts: { onOpen: (firmId: string) => void; onPickCentre: (lat: number, lon: number) => void; milesForPick: () => number; onTiles?: (ok: boolean) => void }): ProspectMap {
  const map = L.map(container, { zoomControl: true, worldCopyJump: true, attributionControl: true }).setView([39.5, -96], 4);
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  });
  let loaded = 0;
  let failed = 0;
  let reported: boolean | null = null;
  const report = (ok: boolean) => {
    if (reported === ok) return;
    reported = ok;
    container.classList.toggle('pr-map-notiles', !ok);
    opts.onTiles?.(ok);
  };
  tiles.on('tileload', () => (loaded++, report(true)));
  tiles.on('tileerror', () => {
    failed++;
    if (!loaded && failed >= 3) report(false);
  });
  tiles.addTo(map);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');

  const pins = L.layerGroup().addTo(map);
  let circle: L.Circle | null = null;
  let firms: ProspectFirm[] = [];

  map.on('click', (e: L.LeafletMouseEvent) => {
    const miles = opts.milesForPick();
    const box = document.createElement('div');
    box.className = 'pr-map-pick';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn small primary';
    btn.textContent = `Search within ${miles} miles of here`;
    btn.onclick = () => {
      map.closePopup();
      opts.onPickCentre(+e.latlng.lat.toFixed(5), +e.latlng.lng.toFixed(5));
    };
    box.append(btn);
    L.popup({ closeButton: true }).setLatLng(e.latlng).setContent(box).openOn(map);
  });

  function draw() {
    pins.clearLayers();
    const located = firms.filter((f) => f.lat != null && f.lon != null);
    const groups = clusterPoints(located, (f) => map.latLngToLayerPoint([f.lat!, f.lon!]), 44);
    for (const g of groups) {
      if (g.items.length === 1) {
        const f = g.items[0];
        const marker = L.marker([f.lat!, f.lon!], {
          keyboard: true,
          title: f.name,
          alt: f.name,
          icon: L.divIcon({ className: `pr-pin pr-pin-${TYPE_CLASS[f.type] ?? 'other'}${f.geo === 'zip' ? ' approx' : ''}`, iconSize: [14, 14], html: '' }),
        });
        marker.bindTooltip(`<b>${esc(f.name)}</b><br>${esc(TYPE_SHORT[f.type] ?? f.type)} · ${esc([f.city, f.state].filter(Boolean).join(', '))}<br>${f.aumTotal != null ? `AUM ${moneyText(f.aumTotal)}` : f.value13f != null ? `13F ${moneyText(f.value13f)}` : 'AUM not reported'}${f.geo === 'zip' ? '<br><i>Placed at its ZIP centre</i>' : ''}`, { direction: 'top', offset: [0, -6] });
        marker.on('click', () => opts.onOpen(f.id));
        marker.addTo(pins);
      } else {
        const ll = map.layerPointToLatLng(L.point(g.x, g.y));
        const n = g.items.length;
        const size = n < 10 ? 28 : n < 100 ? 34 : 42;
        const marker = L.marker(ll, {
          keyboard: true,
          title: `${n} firms here: click to zoom in`,
          alt: `${n} firms`,
          icon: L.divIcon({ className: 'pr-cluster', iconSize: [size, size], html: `<span>${n}</span>` }),
        });
        marker.on('click', () => {
          const bounds = L.latLngBounds(g.items.map((f) => [f.lat!, f.lon!] as [number, number]));
          const same = bounds.getNorthEast().equals(bounds.getSouthWest(), 1e-6);
          if (!same && map.getZoom() < map.getMaxZoom()) map.fitBounds(bounds.pad(0.3), { maxZoom: map.getMaxZoom() });
          else {
            // all at one point (e.g. one ZIP centre): list them
            const list = document.createElement('div');
            list.className = 'pr-map-list';
            for (const f of g.items.slice(0, 40)) {
              const b = document.createElement('button');
              b.type = 'button';
              b.className = 'link-btn';
              b.textContent = f.name;
              b.onclick = () => (map.closePopup(), opts.onOpen(f.id));
              list.append(b);
            }
            L.popup().setLatLng(ll).setContent(list).openOn(map);
          }
        });
        marker.addTo(pins);
      }
    }
  }
  map.on('zoomend', draw);

  return {
    setFirms(next, centre) {
      firms = next;
      circle?.remove();
      circle = null;
      if (centre) {
        circle = L.circle([centre.lat, centre.lon], { radius: centre.miles * 1609.34, className: 'pr-radius', interactive: false }).addTo(map);
        map.fitBounds(circle.getBounds(), { maxZoom: 13 });
      } else {
        const pts = next.filter((f) => f.lat != null && f.lon != null).map((f) => [f.lat!, f.lon!] as [number, number]);
        if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 11 });
      }
      draw();
    },
    resize() {
      map.invalidateSize();
      draw();
    },
    destroy() {
      map.remove();
    },
  };
}
