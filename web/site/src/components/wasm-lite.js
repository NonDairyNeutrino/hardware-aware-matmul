// Loads the stable single-threaded build of the wrapper once per page. It has no
// thread pool, so it needs no cross-origin isolation and no service worker.
import init, { env_info, partition_plan } from '../../../wasm/pkg-lite/naive_matmul_web.js';

let ready;

/** Resolves to `{ partitionPlan, envInfo }` once the module is instantiated. */
export function loadPlans() {
  ready ??= init().then(() => ({ partitionPlan: partition_plan, envInfo: env_info }));
  return ready;
}
