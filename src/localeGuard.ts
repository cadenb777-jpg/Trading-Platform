/**
 * Some browsers report a default locale that Intl refuses ("en-US@posix" in a Linux sandbox): every toLocaleString,
 * Intl.NumberFormat or chart label then throws "Invalid language tag" and whole panels go blank (the Setups chart
 * did). When the default is broken, this wraps the locale-taking built-ins so a refused locale falls back to US
 * English. A good default leaves everything untouched. Installed first thing in main.ts; tested in localeGuard.test.ts.
 */

export const FALLBACK_LOCALE = 'en-US';

/** Whether the browser's own locale works with Intl (with and without naming it). */
export function defaultLocaleWorks(language: string | undefined = globalThis.navigator?.language): boolean {
  try {
    new Intl.NumberFormat().format(1);
    new Intl.DateTimeFormat().format(0);
    if (language) new Intl.NumberFormat(language).format(1);
    return true;
  } catch {
    return false;
  }
}

/** Calls `run(locale)`; when the locale is refused (RangeError), runs it again with the fallback. */
export function withFallback<T>(locale: unknown, run: (locale: unknown) => T, fallback = FALLBACK_LOCALE): T {
  try {
    return run(locale);
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
    return run(fallback); // a bad option (not the locale) throws again here, as it should
  }
}

/** Installs the fallbacks when the default locale is broken (or when `force`). Returns whether it did. */
export function installLocaleGuard(force = false): boolean {
  if (!force && defaultLocaleWorks()) return false;
  const patch = <P extends object>(proto: P, name: string, localeArg: number) => {
    const original = (proto as Record<string, unknown>)[name] as ((...a: unknown[]) => unknown) | undefined;
    if (typeof original !== 'function') return;
    Object.defineProperty(proto, name, {
      configurable: true,
      writable: true,
      value: function (this: unknown, ...args: unknown[]) {
        return withFallback(args[localeArg], (loc) => {
          const a = [...args];
          a[localeArg] = loc;
          return original.apply(this, a);
        });
      },
    });
  };
  patch(Number.prototype, 'toLocaleString', 0);
  patch(BigInt.prototype, 'toLocaleString', 0);
  patch(Date.prototype, 'toLocaleString', 0);
  patch(Date.prototype, 'toLocaleDateString', 0);
  patch(Date.prototype, 'toLocaleTimeString', 0);
  patch(Array.prototype, 'toLocaleString', 0);
  patch(String.prototype, 'localeCompare', 1);
  patch(String.prototype, 'toLocaleUpperCase', 0);
  patch(String.prototype, 'toLocaleLowerCase', 0);
  const I = Intl as unknown as Record<string, unknown>;
  for (const name of ['NumberFormat', 'DateTimeFormat', 'Collator', 'PluralRules', 'RelativeTimeFormat', 'ListFormat', 'DisplayNames', 'Segmenter']) {
    const Ctor = I[name] as (new (...a: unknown[]) => object) | undefined;
    if (typeof Ctor !== 'function') continue;
    I[name] = new Proxy(Ctor, {
      construct: (target, args: unknown[], newTarget) => withFallback(args[0], (loc) => Reflect.construct(target, [loc, ...args.slice(1)], newTarget)),
      apply: (target, self, args: unknown[]) => withFallback(args[0], (loc) => Reflect.apply(target as unknown as (...a: unknown[]) => unknown, self, [loc, ...args.slice(1)])),
    });
  }
  return true;
}
