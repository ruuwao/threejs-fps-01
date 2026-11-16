// Seeded randomness. Every random choice in the game comes from a mulberry32
// stream, so a run with the same seed plays the same way. No Math.random in
// gameplay code, no wall clock in decisions: replays stay deterministic.
export function mulberry32(initial) {
  let a = initial | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(random, array) {
  return array[Math.floor(random() * array.length)];
}

export function shuffle(random, array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const t = array[i]; array[i] = array[j]; array[j] = t;
  }
  return array;
}
