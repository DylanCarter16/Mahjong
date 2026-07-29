// GENERATED — do not edit. Source: api/_src/<name>.ts. Rebuild: npm run build:api
// Self-contained bundle so Vercel deploys a function with no external app imports.

// src/engine/tiles.ts
var SUITS = ["m", "p", "s"];
var WINDS = ["E", "S", "W", "N"];
var DRAGONS = ["R", "G", "W"];
var ALL_PLAY_KINDS = [
  ...SUITS.flatMap((s) => Array.from({ length: 9 }, (_, i) => `${s}${i + 1}`)),
  ...WINDS.map((w) => `w${w}`),
  ...DRAGONS.map((d) => `d${d}`)
];
var BONUS_KINDS = [
  "bf1",
  "bf2",
  "bf3",
  "bf4",
  "bs1",
  "bs2",
  "bs3",
  "bs4"
];
var VALID = /* @__PURE__ */ new Set([...ALL_PLAY_KINDS, ...BONUS_KINDS]);
var ORDER = new Map(
  [...ALL_PLAY_KINDS, ...BONUS_KINDS].map((id, i) => [id, i])
);

// src/analysis/prompts.ts
function postRoundPrompt(logText) {
  return `You are reviewing a finished round of Hong Kong mahjong for a beginner (seat "ME"). They are weak at defensive play and discard reading, so weight your advice toward those skills when the log supports it.

Full action log of the round:

${logText}

Give EXACTLY three numbered improvements. Each must reference a specific moment ("around turn 23 when W punged...") and say what to do differently and why it matters. One sentence of praise maximum. 180 words maximum, no preamble.`;
}

// src/analysis/serialise.ts
var SEAT_LABELS = { 0: "ME", 1: "S", 2: "W", 3: "N" };
function serialiseAction(a) {
  switch (a.type) {
    case "draw":
      return `${SEAT_LABELS[a.seat]} draws`;
    case "discard":
      return `${SEAT_LABELS[a.seat]} discards ${a.tile}`;
    case "declareWin":
      return `${SEAT_LABELS[a.seat]} declares a self-drawn win`;
    case "pass":
      return `${SEAT_LABELS[a.seat]} passes`;
    case "kong":
      return `${SEAT_LABELS[a.seat]} declares ${a.style} kong of ${a.tile}`;
    case "claim":
      if (a.claim === "win") return `${SEAT_LABELS[a.seat]} wins off the discard`;
      if (a.claim === "pung") return `${SEAT_LABELS[a.seat]} pungs`;
      if (a.claim === "kong") return `${SEAT_LABELS[a.seat]} kongs the discard`;
      return `${SEAT_LABELS[a.seat]} chows with ${a.claim.chow.join(" ")}`;
  }
}
function serialiseLog(log, result) {
  const lines = log.map((a, i) => `${i + 1}. ${serialiseAction(a)}`);
  if (result) {
    if (result.kind === "draw") lines.push("RESULT: wall exhausted, nobody won");
    else {
      lines.push(
        `RESULT: ${SEAT_LABELS[result.winner]} won ${result.selfDraw ? "by self-draw" : `off ${SEAT_LABELS[result.loser]}'s discard`} for ${result.fan?.totalFaan ?? "?"} faan (${result.fan?.patterns.map((p) => p.name).join(", ") || "chicken hand"})`
      );
    }
  }
  return lines.join("\n");
}

// src/engine/fan.ts
var FAN_PATTERN_NAMES = /* @__PURE__ */ new Set([
  "All Chows",
  "All Honours",
  "All Kongs",
  "All Pungs",
  "Flower Set",
  "Great Dragons",
  "Great Winds",
  "Kong Replacement",
  "Last Wall Tile",
  "Mixed One Suit",
  "Nine Gates",
  "Own Flowers",
  "Pure One Suit",
  "Round Wind",
  "Seat Wind",
  "Self-draw",
  "Seven Pairs",
  "Small Dragons",
  "Small Winds",
  "Thirteen Orphans"
]);

// api/_lib/validate.ts
var TILE_IDS = /* @__PURE__ */ new Set([...ALL_PLAY_KINDS, ...BONUS_KINDS]);
var isObj = (x) => typeof x === "object" && x !== null && !Array.isArray(x);
var isTile = (x) => typeof x === "string" && TILE_IDS.has(x);
var isSeat = (x) => x === 0 || x === 1 || x === 2 || x === 3;
function action(x) {
  if (!isObj(x) || !isSeat(x.seat)) return null;
  switch (x.type) {
    case "draw":
      return { type: "draw", seat: x.seat };
    case "declareWin":
      return { type: "declareWin", seat: x.seat };
    case "pass":
      return { type: "pass", seat: x.seat };
    case "discard":
      return isTile(x.tile) ? { type: "discard", seat: x.seat, tile: x.tile } : null;
    case "kong":
      if (!isTile(x.tile) || x.style !== "concealed" && x.style !== "added") return null;
      return { type: "kong", seat: x.seat, tile: x.tile, style: x.style };
    case "claim": {
      const c = x.claim;
      if (c === "win" || c === "pung" || c === "kong") return { type: "claim", seat: x.seat, claim: c };
      if (isObj(c) && Array.isArray(c.chow) && c.chow.length === 2 && c.chow.every(isTile)) {
        return { type: "claim", seat: x.seat, claim: { chow: [c.chow[0], c.chow[1]] } };
      }
      return null;
    }
    default:
      return null;
  }
}
function validateReview(x) {
  if (!isObj(x) || !Array.isArray(x.log) || x.log.length === 0 || x.log.length > 600) return null;
  const log = [];
  for (const raw of x.log) {
    const a = action(raw);
    if (!a) return null;
    log.push(a);
  }
  let result = null;
  if (x.result !== null && x.result !== void 0) {
    if (!isObj(x.result)) return null;
    if (x.result.kind === "draw") result = { kind: "draw" };
    else if (x.result.kind === "win" && isSeat(x.result.winner)) {
      result = { kind: "win", winner: x.result.winner, selfDraw: x.result.selfDraw === true };
      if (isSeat(x.result.loser)) result.loser = x.result.loser;
      if (isObj(x.result.fan) && typeof x.result.fan.totalFaan === "number") {
        const patterns = Array.isArray(x.result.fan.patterns) ? x.result.fan.patterns.slice(0, 20).filter(
          // Allowlist the NAME against the scorer's own labels (audit L1):
          // pattern names are cosmetic, so free-text here was a prompt-
          // injection channel. Only canonical names reach the prompt.
          (p) => isObj(p) && typeof p.name === "string" && FAN_PATTERN_NAMES.has(p.name) && typeof p.faan === "number"
        ).map((p) => ({ name: p.name, faan: p.faan })) : [];
        result.fan = { totalFaan: x.result.fan.totalFaan, patterns };
      }
    } else return null;
  }
  return { log, result };
}

// api/_lib/buildPrompts.ts
var PLAIN_PROSE = ' Write plain prose only \u2014 no Markdown or formatting syntax of any kind (no asterisks, underscores, backticks, headings, or bullet lists). Always name tiles in plain English ("West Wind", "White Dragon", "9 of Characters") and never use internal codes like wW, dW, or m9.';
var COACH_SYSTEM = "You are a concise, friendly Hong Kong mahjong coach for a beginner. You are given exact engine-computed facts about the position. Never recompute or contradict the numbers \u2014 narrate them. Follow the requested output format exactly." + PLAIN_PROSE;
var REVIEW_SYSTEM = "You are a Hong Kong mahjong teacher reviewing a finished round for a beginner. Be concrete and reference specific turns. Follow the requested output format exactly." + PLAIN_PROSE;
function buildReviewPrompt(body) {
  const payload = validateReview(body);
  if (!payload) return null;
  return { system: REVIEW_SYSTEM, prompt: postRoundPrompt(serialiseLog(payload.log, payload.result)) };
}

// api/_lib/anthropic.ts
var ENDPOINT = "https://api.anthropic.com/v1/messages";
var DEFAULT_UPSTREAM_TIMEOUT_MS = 25e3;
var TIMED_OUT = "the coach took too long to answer";
async function streamOnce(opts) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS);
  try {
    return await streamRequest(opts, ctl.signal);
  } catch (e) {
    if (ctl.signal.aborted) return { ok: false, error: TIMED_OUT, status: 504 };
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
async function streamRequest(opts, signal) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: opts.system,
      stream: true,
      messages: [{ role: "user", content: opts.prompt }]
    }),
    signal
  });
  if (!res.ok || !res.body) {
    let message = `upstream error (HTTP ${res.status})`;
    try {
      const data = await res.json();
      if (data.error?.message) message = data.error.message;
    } catch {
    }
    return { ok: false, error: message, status: res.status };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let refusal = false;
  let emitted = false;
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      let ev;
      try {
        ev = JSON.parse(raw);
      } catch {
        continue;
      }
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
        opts.onDelta(ev.delta.text);
        emitted = true;
      }
      if (ev.type === "message_delta" && ev.delta?.stop_reason === "refusal") refusal = true;
      if (ev.type === "error") return { ok: false, error: ev.error?.message ?? "upstream stream error" };
    }
  }
  if (refusal && !emitted) return { ok: false, error: "refusal", refusal: true };
  return { ok: true, model: opts.model };
}
async function streamCompletion(opts) {
  const budget = opts.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS;
  const startedAt = Date.now();
  let first;
  try {
    first = await streamOnce(opts);
  } catch {
    first = { ok: false, error: "network error reaching the model API" };
  }
  if (first.ok || !opts.fallbackModel) return first;
  const left = budget - (Date.now() - startedAt);
  if (first.status === 504 || left < 3e3) return first;
  try {
    const second = await streamOnce({ ...opts, model: opts.fallbackModel, timeoutMs: left });
    return second.ok ? second : { ok: false, error: second.error, status: second.status };
  } catch {
    return { ok: false, error: "network error reaching the model API" };
  }
}

// api/_lib/limiter.ts
function makeLimiter({ perMinute, perDay, now = Date.now }) {
  const windows = /* @__PURE__ */ new Map();
  return {
    check(key) {
      const t = now();
      let w = windows.get(key);
      if (!w) {
        w = { minuteStart: t, minuteCount: 0, dayStart: t, dayCount: 0 };
        windows.set(key, w);
      }
      if (t - w.minuteStart >= 6e4) {
        w.minuteStart = t;
        w.minuteCount = 0;
      }
      if (t - w.dayStart >= 864e5) {
        w.dayStart = t;
        w.dayCount = 0;
      }
      if (w.dayCount >= perDay) return Math.ceil((w.dayStart + 864e5 - t) / 1e3);
      if (w.minuteCount >= perMinute) return Math.ceil((w.minuteStart + 6e4 - t) / 1e3);
      w.minuteCount++;
      w.dayCount++;
      if (windows.size > 5e3) {
        for (const [k, v] of windows) if (t - v.dayStart >= 864e5) windows.delete(k);
      }
      return null;
    }
  };
}
function sameOrigin(originHeader, hostHeader) {
  if (!originHeader || !hostHeader) return false;
  try {
    const origin = new URL(originHeader);
    if (origin.host === hostHeader) return true;
    if (process.env.NODE_ENV === "production") return false;
    const localhost = (h) => h.startsWith("localhost") || h.startsWith("127.0.0.1");
    return localhost(origin.host) && localhost(hostHeader);
  } catch {
    return false;
  }
}

// api/_lib/handler.ts
var limiter = makeLimiter({ perMinute: 20, perDay: 200 });
var roomLimiter = makeLimiter({ perMinute: 15, perDay: 150 });
var globalLimiter = makeLimiter({ perMinute: 60, perDay: 1e3 });
var byoLimiter = makeLimiter({ perMinute: 30, perDay: 500 });
var BYO_KEY_SHAPE = /^sk-ant-[A-Za-z0-9_-]{8,}$/;
function firstHeader(req, name) {
  const h = req.headers[name];
  return Array.isArray(h) ? h[0] : h;
}
function clientIp(req) {
  const real = firstHeader(req, "x-real-ip")?.trim();
  return real && real.length > 0 ? real : req.socket?.remoteAddress || "unknown";
}
function roomBucket(req) {
  const code = firstHeader(req, "x-room-code")?.replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
  return code && code.length > 0 ? `room:${code}` : null;
}
function createHandler(cfg) {
  return async function handler(req, res) {
    try {
      if (req.method !== "POST") {
        res.status(405).json({ error: "POST only" });
        return;
      }
      const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
      if (!sameOrigin(origin, req.headers.host)) {
        res.status(403).json({ error: "same-origin requests only" });
        return;
      }
      const byoHeader = firstHeader(req, "x-byo-key");
      let byoKey = null;
      if (byoHeader !== void 0 && byoHeader !== "") {
        if (byoHeader.length >= 250 || !BYO_KEY_SHAPE.test(byoHeader)) {
          res.status(400).json({ error: "invalid API key format" });
          return;
        }
        byoKey = byoHeader;
      }
      if (byoKey) {
        const byoRetry = byoLimiter.check(clientIp(req));
        if (byoRetry !== null) {
          res.setHeader("Retry-After", String(byoRetry));
          res.status(429).json({ error: "rate limited", retryAfter: byoRetry });
          return;
        }
      } else {
        const room = roomBucket(req);
        const roomRetry = room ? roomLimiter.check(room) : null;
        const ipRetry = roomRetry ?? limiter.check(clientIp(req));
        const retryAfter = ipRetry ?? globalLimiter.check("shared-key");
        if (retryAfter !== null) {
          res.setHeader("Retry-After", String(retryAfter));
          res.status(429).json({
            error: roomRetry !== null ? "this room has hit its shared coach limit" : ipRetry === null ? "the coach is busy right now \u2014 try again shortly" : "rate limited",
            retryAfter
          });
          return;
        }
      }
      const built = cfg.buildPrompt(req.body);
      if (!built) {
        res.status(400).json({ error: "invalid request body" });
        return;
      }
      const apiKey = byoKey ?? process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        res.status(503).json({ error: "coach not configured on this deployment" });
        return;
      }
      let full = "";
      const outcome = await streamCompletion({
        apiKey,
        model: cfg.model,
        ...cfg.fallbackModel ? { fallbackModel: cfg.fallbackModel } : {},
        system: built.system,
        prompt: built.prompt,
        maxTokens: cfg.maxTokens,
        ...cfg.timeoutMs ? { timeoutMs: cfg.timeoutMs } : {},
        onDelta: (text) => {
          full += text;
        }
      });
      if (!outcome.ok) {
        res.status(outcome.status === 401 ? 401 : outcome.status === 504 ? 504 : 502).json({
          error: outcome.error
        });
        return;
      }
      if (full.trim().length === 0) {
        res.status(502).json({ error: "the coach returned an empty answer" });
        return;
      }
      res.status(200).json({ text: full, model: outcome.model });
    } catch {
      if (!res.headersSent) {
        res.status(500).json({ error: "internal error" });
      } else {
        try {
          res.end();
        } catch {
        }
      }
    }
  };
}

// api/_src/review.ts
var maxDuration = 60;
var UPSTREAM_TIMEOUT_MS = 5e4;
var review_default = createHandler({
  buildPrompt: buildReviewPrompt,
  model: "claude-sonnet-5",
  // The coach has always had a fallback model; the review had none, so one bad
  // upstream response was terminal. Same ladder, one rung faster.
  fallbackModel: "claude-haiku-4-5-20251001",
  maxTokens: 700,
  timeoutMs: UPSTREAM_TIMEOUT_MS
});
export {
  review_default as default,
  maxDuration
};
