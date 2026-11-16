// Seeded randomness. Every random choice in the game comes from a mulberry32
// stream, so a run with the same seed plays the same way. No Math.random in
// gameplay decisions, no wall clock in decisions: replays stay deterministic.
//
// mulberry32 is the generator: a tiny, well-tested 32-bit PRNG with a full
// period for its state size, cheap enough to call every frame. The helpers
// below are the only ways the rest of the code draws from a stream, so the
// distribution of every roll is visible in one place.
export function mulberry32(initial) {
  let a = initial | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A float in [min, max). Used for jitter — speeds, reaction times, spread.
export function range(random, min, max) {
  return min + random() * (max - min);
}

// An integer in [min, max], both ends inclusive. Used for discrete picks
// such as a burst length or a waypoint index.
export function int(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

// True with probability p (0..1). One call, one coin flip, no magic numbers
// scattered through the callers.
export function chance(random, p) {
  return random() < p;
}

// One element of an array, uniformly. Empty arrays are a caller bug, not a
// case to paper over — they return undefined and the caller sees it.
export function pick(random, array) {
  return array[Math.floor(random() * array.length)];
}

// Fisher-Yates, in place, on the seeded stream. Returns the same array so
// callers can chain it.
export function shuffle(random, array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const t = array[i];
    array[i] = array[j];
    array[j] = t;
  }
  return array;
}
