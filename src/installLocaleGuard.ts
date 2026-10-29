/** Runs the locale fallback before any other module (imported first by main.ts). */
import { installLocaleGuard } from './localeGuard';

installLocaleGuard();
