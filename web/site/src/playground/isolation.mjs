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

/**
 * What to do when the page may still be controlled by the service worker that earlier versions
 * registered at the site root (main.js has already unregistered it). Such a page is isolated, but
 * its workers would not be: a worker script is matched to a service worker by its own URL, and
 * no registration covers it any more, so the threaded start would fail. Reloading once leaves the
 * page uncontrolled, and the usual path then registers the playground's own service worker.
 *
 * @param {object} state
 * @param {boolean} state.controlledByRoot  the page's controller is the root service worker
 * @param {boolean} state.reloaded          this tab already reloaded for this reason
 * @returns {'reload' | 'continue'}
 */
export function leaveRootWorker({ controlledByRoot, reloaded }) {
  return controlledByRoot && !reloaded ? 'reload' : 'continue';
}

/** The key under which a tab remembers that it reloaded to leave the root service worker. */
export const LEFT_ROOT_KEY = 'playground-left-root-service-worker';
