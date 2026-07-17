// Room codes and seat tokens (spec §4).
//
// Codes are read aloud across a table: 6 characters from an alphabet with no
// O/0, no I/1/L, so nothing is ambiguous in speech or handwriting.
//
// Seat tokens are the ONLY way to reclaim a seat — anyone with the room code
// can otherwise sit down. Opaque, crypto-random, issued once per seat, stored
// client-side in localStorage and server-side in the room's storage.

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 6

/** Uniform pick via rejection sampling — no modulo bias in something a
 * stranger could try to predict. */
function uniform(bytes: () => Uint8Array, bound: number): number {
  const limit = 256 - (256 % bound)
  for (;;) {
    const [b] = bytes()
    if (b < limit) return b % bound
  }
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  crypto.getRandomValues(out)
  return out
}

export function makeRoomCode(rng: () => Uint8Array = () => randomBytes(1)): string {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[uniform(rng, CODE_ALPHABET.length)]
  }
  return code
}

/** Normalise what a human typed: uppercase, strip separators. Lookalike
 * characters (O/0/I/1/L) are simply not in the alphabet, so a code containing
 * one fails isValidRoomCode and the UI says "check the code". */
export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '').slice(0, CODE_LENGTH + 2)
}

export function isValidRoomCode(code: string): boolean {
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c))
}

/** 128-bit opaque seat token, hex-encoded. */
export function makeSeatToken(): string {
  return [...randomBytes(16)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Crypto wall seed (§2.3): generated server-side, consumed by createGame,
 * never stored, logged, or transmitted. 256 bits. */
export function makeSecretSeed(): string {
  return [...randomBytes(32)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
