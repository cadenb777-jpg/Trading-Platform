// The entry point. The clickjacking guard runs before anything else: only when this page is not inside another
// website's frame is the platform itself loaded (src/app.ts), so nothing (the helper connection included) starts framed.
import './style.css';
import './terminal.css'; // the terminal look (data-look='terminal') // styles only (no code runs): linked in the page itself, so there's no unstyled flash
import { stopIfFramed } from './frameGuard';

if (!stopIfFramed(window)) void import('./app');
