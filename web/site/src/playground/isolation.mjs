// Which build the playground should use, and whether it must first enable cross-origin
// isolation. The threaded build needs `SharedArrayBuffer`, which a browser only allows on an
// isolated page; GitHub Pages cannot send the headers, so a service worker (coi-serviceworker)
// adds them and reloads the page once. Pure function: the page feeds it what it observes.

/**
 * @param {object} state
 * @param {boolean} state.isolated        `crossOriginIsolated` right now
 * @param {number}  state.attempts        how many times this tab already tried to enable isolation
 * @param {boolean} state.serviceWorkers  whether the browser has service workers at all
 * @returns {{ action: 'threads' } | { action: 'register' } | { action: 'lite', reason: string }}
 */
export function decide({ isolated, attempts, serviceWorkers }) {
  if (isolated) return { action: 'threads' };
  if (!serviceWorkers) return { action: 'lite', reason: 'this browser has no service workers, which multithreading needs' };
  if (attempts < 1) return { action: 'register' };
  return { action: 'lite', reason: 'the page is still not cross-origin isolated after enabling it (private windows and some settings block it)' };
}

/** The key under which a tab remembers that it already tried. */
export const ATTEMPTS_KEY = 'playground-isolation-attempts';
