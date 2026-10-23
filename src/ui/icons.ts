/** Small line icons (24×24, drawn with the current text colour). */
const PATHS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>',
  chart: '<path d="M4 4v16h16"/><path d="M8 15l4-5 3 3 5-6"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  cursor: '<path d="M6 3l12 9-5.5 1.2L15 19l-2.4 1.2-2.6-5.8L6 18z"/>',
  trend: '<path d="M5 19L19 5"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/>',
  ray: '<path d="M5 18L21 7"/><circle cx="5" cy="18" r="2"/><circle cx="12" cy="13.2" r="2"/>',
  hline: '<path d="M2 12h20"/><circle cx="12" cy="12" r="2"/>',
  vline: '<path d="M12 2v20"/><circle cx="12" cy="12" r="2"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1"/><circle cx="4" cy="6" r="1.6"/><circle cx="20" cy="18" r="1.6"/>',
  fib: '<path d="M3 5h18M3 10h18M3 14.5h18M3 19h18" /><path d="M5 19L19 5" stroke-dasharray="2 2"/>',
  magnet: '<path d="M6 3v8a6 6 0 0012 0V3"/><path d="M6 7h3.5M14.5 7H18"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  candles: '<path d="M7 3v18M17 3v18"/><rect x="5" y="7" width="4" height="9" rx=".5"/><rect x="15" y="5" width="4" height="8" rx=".5"/>',
  news: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/>',
  long: '<path d="M4 20h16"/><rect x="5" y="5" width="14" height="7" rx="1"/><rect x="5" y="12" width="14" height="4" rx="1" stroke-dasharray="2 2"/>',
  short: '<path d="M4 4h16"/><rect x="5" y="12" width="14" height="7" rx="1"/><rect x="5" y="8" width="14" height="4" rx="1" stroke-dasharray="2 2"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h2M14 14h2M8 17h2"/>',
  code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><path d="M8 14l3-3 2 2 3-4"/>',
  profile: '<path d="M4 3v18"/><path d="M4 6h9M4 10h14M4 14h11M4 18h6"/>',
  bell: '<path d="M6 16V11a6 6 0 0112 0v5l2 2H4z"/><path d="M10 21h4"/>',
  grid: '<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="1"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="1"/><rect x="13" y="13" width="7.5" height="7.5" rx="1"/>',
  flow: '<path d="M3 7h11l-3-3M21 17H10l3 3"/><path d="M3 12h6M15 12h6"/>',
  research: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/><path d="M8 12.5V10M10.5 12.5V8M13 12.5v-3"/>',
  macro: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5M12 3.5C9.4 5.9 8.2 8.7 8.2 12s1.2 6.1 3.8 8.5"/>',
  portfolio: '<path d="M12 3v9h9"/><path d="M19.5 15.5A8.5 8.5 0 1110 3.7"/>',
  backtest: '<path d="M3 12a9 9 0 109-9"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/>',
  clients: '<path d="M6 3.5h9l3.5 3.5v13.5H6z"/><path d="M15 3.5V7h3.5"/><path d="M9 12h6M9 15.5h6M9 8.5h3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  popout: '<path d="M14 4h6v6M20 4l-8 8"/><path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
  clip: '<path d="M20.5 11.5l-8.2 8.2a5 5 0 01-7.1-7.1l8.6-8.6a3.4 3.4 0 014.8 4.8l-8.6 8.6a1.7 1.7 0 01-2.4-2.4l7.9-7.9"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  positioning: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  invest: '<path d="M12 3l9 4.5-9 4.5-9-4.5z"/><path d="M3 12l9 4.5 9-4.5"/><path d="M3 16.5l9 4.5 9-4.5"/>',
  refresh: '<path d="M20 11a8 8 0 10-2.3 5.7"/><path d="M20 4v7h-7"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, size = 18): SVGSVGElement {
  const template = document.createElement('template');
  template.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
  return template.content.firstElementChild as SVGSVGElement;
}
