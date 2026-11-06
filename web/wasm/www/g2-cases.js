// The 29 cases of the g2 gate, shared by the threaded and lite workers.
export function g2Cases() {
  const cases = [];
  for (const n of [256, 512]) {
    cases.push({ level: 0, n, threads: 1, tile_k: 32, tile_j: 64 });
    for (const level of [1, 2, 3, 4]) {
      for (const threads of [1, 2, 4]) {
        cases.push({ level, n, threads, tile_k: 32, tile_j: 64 });
      }
    }
  }
  cases.push({ level: 3, n: 256, threads: 4, tile_k: 7, tile_j: 2 });
  cases.push({ level: 2, n: 256, threads: 4, tile_k: 1, tile_j: 1 });
  cases.push({ level: 4, n: 256, threads: 4, tile_k: 7, tile_j: 2 });
  return cases;
}
