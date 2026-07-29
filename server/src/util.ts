// Constant-time string equality for secrets (seat tokens, ADMIN_KEY) — audit
// L5. A plain `===` short-circuits on the first differing byte, which leaks a
// timing signal about how much of the secret matched. This compares over the
// full length regardless. (Timing attacks over the network against a 128-bit
// random token aren't practically exploitable, but this removes the question.)
export function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0
    const cb = i < b.length ? b.charCodeAt(i) : 0
    diff |= ca ^ cb
  }
  return diff === 0
}

/** Max bytes we'll parse from a WebSocket frame — no legitimate ClientMsg is
 *  large (audit L7). Cloudflare already caps frames at ~1 MB; this is tighter. */
export const MAX_WS_MESSAGE_BYTES = 8 * 1024
