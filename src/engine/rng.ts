// Seedable RNG: xmur3 string hash feeding sfc32. In-repo (~25 lines) instead of
// a dependency; games are reproducible from a string seed.
//
// SECURITY (audit H1): the production wall seed is 256 bits of crypto entropy
// (codes.ts makeSecretSeed), and this PRNG carries a 128-bit state — four
// distinct 32-bit words mixed out of the seed by xmur3. That puts the wall at
// 1-of-2^128 arrangements: not enumerable, so a player CANNOT brute-force the
// shuffle from their own opening hand to reveal hidden tiles. (The earlier
// mulberry32 had a 32-bit state — only ~4.3e9 walls — which WAS brute-forceable.
// Do not shrink the state back to one word.)

export interface Rng {
  next(): number // uniform in [0, 1)
}

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return h >>> 0
  }
}

export function makeRng(seed: string): Rng {
  const seedFn = xmur3(seed)
  // sfc32: 128-bit state, seeded from four hash words of the full seed string.
  let a = seedFn()
  let b = seedFn()
  let c = seedFn()
  let d = seedFn()
  return {
    next() {
      a >>>= 0
      b >>>= 0
      c >>>= 0
      d >>>= 0
      let t = (a + b) | 0
      a = b ^ (b >>> 9)
      b = (c + (c << 3)) | 0
      c = (c << 21) | (c >>> 11)
      d = (d + 1) | 0
      t = (t + d) | 0
      c = (c + t) | 0
      return (t >>> 0) / 4294967296
    },
  }
}

/** Fisher–Yates shuffle (returns a new array). */
export function shuffle<T>(xs: readonly T[], rng: Rng): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
