var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../src/room/codes.ts
var CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
var CODE_LENGTH = 6;
function uniform(bytes, bound) {
  const limit = 256 - 256 % bound;
  for (; ; ) {
    const [b] = bytes();
    if (b < limit) return b % bound;
  }
}
__name(uniform, "uniform");
function randomBytes(n) {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}
__name(randomBytes, "randomBytes");
function makeRoomCode(rng = () => randomBytes(1)) {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[uniform(rng, CODE_ALPHABET.length)];
  }
  return code;
}
__name(makeRoomCode, "makeRoomCode");
function normalizeRoomCode(input) {
  return input.toUpperCase().replace(/[\s-]/g, "").slice(0, CODE_LENGTH + 2);
}
__name(normalizeRoomCode, "normalizeRoomCode");
function isValidRoomCode(code) {
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));
}
__name(isValidRoomCode, "isValidRoomCode");
function makeSeatToken() {
  return [...randomBytes(16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(makeSeatToken, "makeSeatToken");
function makeSecretSeed() {
  return [...randomBytes(32)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(makeSecretSeed, "makeSecretSeed");

// src/RoomDO.ts
import { DurableObject } from "cloudflare:workers";

// ../src/engine/types.ts
var SEATS = [0, 1, 2, 3];
var nextSeat = /* @__PURE__ */ __name((s) => (s + 1) % 4, "nextSeat");

// ../src/room/clock.ts
var systemClock = {
  now: /* @__PURE__ */ __name(() => Date.now(), "now"),
  setTimeout: /* @__PURE__ */ __name((fn, ms) => ({ _h: globalThis.setTimeout(fn, ms) }), "setTimeout"),
  clearTimeout: /* @__PURE__ */ __name((h) => globalThis.clearTimeout(h._h), "clearTimeout")
};

// ../src/room/protocol.ts
var DEFAULT_HOUSE_RULES = {
  faanMinimum: 0,
  flowers: true,
  faanCap: null,
  claimWindowSec: 4,
  turnTimerSec: 30,
  coachAllowed: true
};
function sanitizeHouseRules(r) {
  const raw = typeof r === "object" && r !== null ? r : {};
  const d = DEFAULT_HOUSE_RULES;
  const num = /* @__PURE__ */ __name((v, fallback) => typeof v === "number" && Number.isFinite(v) ? v : fallback, "num");
  const faanMinimum = [0, 1, 3].includes(raw.faanMinimum) ? raw.faanMinimum : d.faanMinimum;
  return {
    faanMinimum,
    flowers: typeof raw.flowers === "boolean" ? raw.flowers : d.flowers,
    faanCap: raw.faanCap === null || raw.faanCap === void 0 ? null : Math.max(1, Math.min(64, num(raw.faanCap, 13))),
    claimWindowSec: Math.max(3, Math.min(8, num(raw.claimWindowSec, d.claimWindowSec))),
    turnTimerSec: Math.max(10, Math.min(120, num(raw.turnTimerSec, d.turnTimerSec))),
    coachAllowed: typeof raw.coachAllowed === "boolean" ? raw.coachAllowed : d.coachAllowed
  };
}
__name(sanitizeHouseRules, "sanitizeHouseRules");

// ../src/engine/tiles.ts
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
function sortTiles(tiles) {
  return [...tiles].sort((a, b) => ORDER.get(a) - ORDER.get(b));
}
__name(sortTiles, "sortTiles");
var isSuit = /* @__PURE__ */ __name((id) => id[0] === "m" || id[0] === "p" || id[0] === "s", "isSuit");
var isHonour = /* @__PURE__ */ __name((id) => id[0] === "w" || id[0] === "d", "isHonour");
var isBonus = /* @__PURE__ */ __name((id) => id[0] === "b", "isBonus");
var isTerminal = /* @__PURE__ */ __name((id) => isSuit(id) && (rankOf(id) === 1 || rankOf(id) === 9), "isTerminal");
var suitOf = /* @__PURE__ */ __name((id) => isSuit(id) ? id[0] : null, "suitOf");
var rankOf = /* @__PURE__ */ __name((id) => isSuit(id) ? Number(id[1]) : null, "rankOf");

// ../src/engine/shanten.ts
var suitCache = /* @__PURE__ */ new Map();
function suitOptions(counts) {
  const key = counts.join("");
  const hit = suitCache.get(key);
  if (hit) return hit;
  const found = /* @__PURE__ */ new Set();
  const out = [];
  const record = /* @__PURE__ */ __name((s, p, q) => {
    const k = `${s},${p},${q}`;
    if (!found.has(k)) {
      found.add(k);
      out.push([s, p, q]);
    }
  }, "record");
  const dfs = /* @__PURE__ */ __name((r, s, p, q) => {
    while (r <= 9 && counts[r] === 0) r++;
    if (r > 9) {
      record(s, p, q);
      return;
    }
    const c = counts[r];
    counts[r] = c - 1;
    dfs(r, s, p, q);
    counts[r] = c;
    if (c >= 3) {
      counts[r] = c - 3;
      dfs(r, s + 1, p, q);
      counts[r] = c;
    }
    if (r <= 7 && counts[r + 1] > 0 && counts[r + 2] > 0) {
      counts[r] = c - 1;
      counts[r + 1]--;
      counts[r + 2]--;
      dfs(r, s + 1, p, q);
      counts[r] = c;
      counts[r + 1]++;
      counts[r + 2]++;
    }
    if (c >= 2) {
      counts[r] = c - 2;
      if (q === 0) dfs(r, s, p, 1);
      dfs(r, s, p + 1, q);
      counts[r] = c;
    }
    if (r <= 8 && counts[r + 1] > 0) {
      counts[r] = c - 1;
      counts[r + 1]--;
      dfs(r, s, p + 1, q);
      counts[r] = c;
      counts[r + 1]++;
    }
    if (r <= 7 && counts[r + 2] > 0) {
      counts[r] = c - 1;
      counts[r + 2]--;
      dfs(r, s, p + 1, q);
      counts[r] = c;
      counts[r + 2]++;
    }
  }, "dfs");
  dfs(1, 0, 0, 0);
  suitCache.set(key, out);
  return out;
}
__name(suitOptions, "suitOptions");
function honourOptions(count) {
  const out = [[0, 0, 0]];
  if (count >= 3) out.push([1, 0, 0]);
  if (count >= 2) out.push([0, 1, 0], [0, 0, 1]);
  return out;
}
__name(honourOptions, "honourOptions");
function standardShanten(concealed, meldCount) {
  const suitCounts = {
    m: new Array(10).fill(0),
    p: new Array(10).fill(0),
    s: new Array(10).fill(0)
  };
  const honourCounts = /* @__PURE__ */ new Map();
  for (const t of concealed) {
    if (isSuit(t)) suitCounts[suitOf(t)][rankOf(t)]++;
    else honourCounts.set(t, (honourCounts.get(t) ?? 0) + 1);
  }
  const groups = [
    suitOptions(suitCounts.m),
    suitOptions(suitCounts.p),
    suitOptions(suitCounts.s),
    ...[...honourCounts.values()].map(honourOptions)
  ];
  let best = 8;
  let states = /* @__PURE__ */ new Map([["0,0,0", [0, 0, 0]]]);
  for (const options of groups) {
    const next = /* @__PURE__ */ new Map();
    for (const [, [s0, p0, q0]] of states) {
      for (const [s, p, q] of options) {
        if (q0 + q > 1) continue;
        const ns = Math.min(4, s0 + s + meldCount) - meldCount;
        const st = [ns, Math.min(6, p0 + p), q0 + q];
        next.set(st.join(","), st);
      }
    }
    states = next;
  }
  for (const [, [s, p, q]] of states) {
    const sets = s + meldCount;
    const usable = Math.min(p, 4 - sets);
    const shantenValue = 8 - 2 * sets - usable - q;
    if (shantenValue < best) best = shantenValue;
  }
  return best;
}
__name(standardShanten, "standardShanten");
function sevenPairsShanten(concealed) {
  const counts = /* @__PURE__ */ new Map();
  for (const t of concealed) counts.set(t, (counts.get(t) ?? 0) + 1);
  let pairs = 0;
  for (const c of counts.values()) if (c >= 2) pairs++;
  const kinds = counts.size;
  return 6 - pairs + Math.max(0, 7 - kinds);
}
__name(sevenPairsShanten, "sevenPairsShanten");
var ORPHANS = [
  "m1",
  "m9",
  "p1",
  "p9",
  "s1",
  "s9",
  "wE",
  "wS",
  "wW",
  "wN",
  "dR",
  "dG",
  "dW"
];
function thirteenOrphansShanten(concealed) {
  const counts = /* @__PURE__ */ new Map();
  for (const t of concealed) counts.set(t, (counts.get(t) ?? 0) + 1);
  let kinds = 0;
  let hasPair = false;
  for (const o of ORPHANS) {
    const c = counts.get(o) ?? 0;
    if (c >= 1) kinds++;
    if (c >= 2) hasPair = true;
  }
  return 13 - kinds - (hasPair ? 1 : 0);
}
__name(thirteenOrphansShanten, "thirteenOrphansShanten");
function shanten(concealed, melds) {
  let best = standardShanten(concealed, melds.length);
  if (melds.length === 0) {
    best = Math.min(best, sevenPairsShanten(concealed), thirteenOrphansShanten(concealed));
  }
  return best;
}
__name(shanten, "shanten");
function usefulTiles(concealed, melds) {
  const base = shanten(concealed, melds);
  if (base === -1) return [];
  const inHand = /* @__PURE__ */ new Map();
  for (const t of concealed) inHand.set(t, (inHand.get(t) ?? 0) + 1);
  const useful = [];
  for (const kind of ALL_PLAY_KINDS) {
    if ((inHand.get(kind) ?? 0) >= 4) continue;
    if (shanten([...concealed, kind], melds) < base) useful.push(kind);
  }
  return useful;
}
__name(usefulTiles, "usefulTiles");

// ../src/engine/bots.ts
var discardsIn = /* @__PURE__ */ __name((legal) => legal.filter((a) => a.type === "discard"), "discardsIn");
var claimsIn = /* @__PURE__ */ __name((legal) => legal.filter((a) => a.type === "claim"), "claimsIn");
function copiesInHand(hand, tile) {
  return hand.filter((t) => t === tile).length;
}
__name(copiesInHand, "copiesInHand");
function isIsolated(hand, tile) {
  if (copiesInHand(hand, tile) > 1) return false;
  if (isHonour(tile)) return true;
  const suit = suitOf(tile);
  const r = rankOf(tile);
  return !hand.some(
    (t) => t !== tile && suitOf(t) === suit && Math.abs(rankOf(t) - r) <= 2
  );
}
__name(isIsolated, "isIsolated");
function visibleCopies(view, kind) {
  let n = copiesInHand(view.concealed, kind);
  for (const seat of SEATS) {
    n += view.discards[seat].filter((t) => t === kind).length;
    for (const m of view.melds[seat]) n += m.tiles.filter((t) => t === kind).length;
  }
  if (view.pendingDiscard?.tile === kind) n++;
  return n;
}
__name(visibleCopies, "visibleCopies");
function liveUsefulCount(view, concealed, melds) {
  let total = 0;
  for (const kind of usefulTiles(concealed, melds)) {
    total += Math.max(0, 4 - visibleCopies(view, kind));
  }
  return total;
}
__name(liveUsefulCount, "liveUsefulCount");
function easyDiscard(view, candidates) {
  const hand = view.concealed;
  const rank = /* @__PURE__ */ __name((t) => {
    if (isHonour(t) && copiesInHand(hand, t) === 1) return 0;
    if (isTerminal(t) && isIsolated(hand, t)) return 1;
    if (isSuit(t) && isIsolated(hand, t)) return 2;
    return 3;
  }, "rank");
  let best = candidates[0];
  let bestRank = rank(best);
  for (const c of candidates) {
    const r = rank(c);
    if (r <= bestRank) {
      best = c;
      bestRank = r;
    }
  }
  return best;
}
__name(easyDiscard, "easyDiscard");
function evalDiscards(view, candidates) {
  const melds = view.melds[view.seat];
  return candidates.map((tile) => {
    const rest = [...view.concealed];
    rest.splice(rest.indexOf(tile), 1);
    return { tile, shantenAfter: shanten(rest, melds) };
  });
}
__name(evalDiscards, "evalDiscards");
function efficientDiscard(view, candidates) {
  const evals = evalDiscards(view, candidates);
  const minSh = Math.min(...evals.map((e) => e.shantenAfter));
  let pool = evals.filter((e) => e.shantenAfter === minSh).map((e) => e.tile);
  if (view.lastClaimed && pool.length > 1) {
    const safer = pool.filter((t) => t !== view.lastClaimed);
    if (safer.length > 0) pool = safer;
  }
  if (pool.length === 1) return pool[0];
  const melds = view.melds[view.seat];
  let best = pool[0];
  let bestLive = -1;
  for (const tile of pool) {
    const rest = [...view.concealed];
    rest.splice(rest.indexOf(tile), 1);
    const liveCount = liveUsefulCount(view, rest, melds);
    if (liveCount > bestLive) {
      best = tile;
      bestLive = liveCount;
    }
  }
  return best;
}
__name(efficientDiscard, "efficientDiscard");
function claimReducesShanten(view, claim) {
  if (claim === "win") return true;
  const tile = view.pendingDiscard.tile;
  const melds = view.melds[view.seat];
  const before = shanten(view.concealed, melds);
  const rest = [...view.concealed];
  let newMeld;
  if (claim === "pung" || claim === "kong") {
    const n = claim === "pung" ? 2 : 3;
    for (let i = 0; i < n; i++) rest.splice(rest.indexOf(tile), 1);
    newMeld = { type: claim, tiles: Array(n + 1).fill(tile), concealed: false };
  } else {
    for (const t of claim.chow) rest.splice(rest.indexOf(t), 1);
    newMeld = { type: "chow", tiles: [...claim.chow, tile], concealed: false };
  }
  return shanten(rest, [...melds, newMeld]) < before;
}
__name(claimReducesShanten, "claimReducesShanten");
function threatScore(view, opp) {
  const exposed = view.melds[opp].filter((m) => !m.concealed).length;
  if (exposed < 2) return 0;
  return exposed * 2 + (view.discards[opp].length < 10 ? 1 : 0) + (view.wallCount < 30 ? 1 : 0);
}
__name(threatScore, "threatScore");
function dangerScore(view, tile, opp) {
  const oppDiscards = view.discards[opp];
  if (oppDiscards.includes(tile)) return 0;
  if (isHonour(tile)) return visibleCopies(view, tile) >= 3 ? 1 : 4;
  const suit = suitOf(tile);
  const r = rankOf(tile);
  const sameSuit = oppDiscards.filter((t) => suitOf(t) === suit);
  if (sameSuit.some((t) => Math.abs(rankOf(t) - r) <= 1)) return 2;
  if (sameSuit.length >= 3) return 3;
  return 5 + (r >= 4 && r <= 6 ? 1 : 0);
}
__name(dangerScore, "dangerScore");
function botAction(view, difficulty, rng) {
  const legal = view.legal;
  if (legal.length === 0) throw new Error("botAction called with no legal actions");
  const win = legal.find(
    (a) => a.type === "declareWin" || a.type === "claim" && a.claim === "win"
  );
  if (win) return win;
  if (view.phase === "draw") return legal[0];
  if (view.phase === "claims") {
    const pass = legal.find((a) => a.type === "pass");
    const claims = claimsIn(legal);
    if (difficulty === "easy") {
      return claims.length > 0 && rng.next() < 0.15 ? claims[0] : pass;
    }
    const good = claims.find((c) => claimReducesShanten(view, c.claim));
    return good ?? pass;
  }
  const discards = discardsIn(legal);
  const candidates = discards.map((d) => d.tile);
  const pick = /* @__PURE__ */ __name((tile) => discards.find((d) => d.tile === tile), "pick");
  if (difficulty === "easy") return pick(easyDiscard(view, candidates));
  const kongs = legal.filter((a) => a.type === "kong");
  if (kongs.length > 0) {
    const melds = view.melds[view.seat];
    const currentBest = Math.min(...evalDiscards(view, candidates).map((e) => e.shantenAfter));
    for (const k of kongs) {
      const rest = [...view.concealed];
      const n = k.style === "concealed" ? 4 : 1;
      for (let i = 0; i < n; i++) rest.splice(rest.indexOf(k.tile), 1);
      const meld = { type: "kong", tiles: Array(4).fill(k.tile), concealed: k.style === "concealed" };
      if (shanten(rest, [...melds, meld]) <= currentBest) return k;
    }
  }
  if (difficulty === "advanced") {
    const threats = SEATS.filter((o) => o !== view.seat).map((o) => ({ o, score: threatScore(view, o) }));
    const top = threats.reduce((a, b) => b.score > a.score ? b : a);
    const evals = evalDiscards(view, candidates);
    const ownShanten = Math.min(...evals.map((e) => e.shantenAfter));
    if (top.score >= 6 && ownShanten >= 1) {
      let safest = candidates[0];
      let bestDanger = Infinity;
      for (const tile of candidates) {
        const d = dangerScore(view, tile, top.o);
        if (d < bestDanger) {
          safest = tile;
          bestDanger = d;
        }
      }
      return pick(safest);
    }
  }
  return pick(efficientDiscard(view, candidates));
}
__name(botAction, "botAction");

// ../src/engine/fanTable.ts
var defaultFanTable = {
  allChows: 1,
  allPungs: 3,
  mixedOneSuit: 3,
  pureOneSuit: 7,
  allHonours: 10,
  smallDragons: 4,
  greatDragons: 8,
  smallWinds: 6,
  greatWinds: 13,
  seatWindPung: 1,
  roundWindPung: 1,
  dragonPung: 1,
  selfDraw: 1,
  sevenPairs: 4,
  thirteenOrphans: 13,
  allKongs: 13,
  nineGates: 13,
  ownFlower: 1,
  flowerSetBonus: 2,
  lastWallTile: 1,
  kongReplacementWin: 1,
  faanCap: null
};

// ../src/engine/fan.ts
var DRAGON_NAMES = {
  R: "Red Dragon Pung",
  G: "Green Dragon Pung",
  W: "White Dragon Pung"
};
var OWN_INDEX = { E: 1, S: 2, W: 3, N: 4 };
function allTilesOf(d) {
  if (d.shape === "standard") return [...d.sets.flatMap((s) => s.tiles), ...d.pair];
  if (d.shape === "sevenPairs") return d.pairs.flat();
  return [];
}
__name(allTilesOf, "allTilesOf");
function isNineGates(d, ctx) {
  if (d.shape !== "standard" || !ctx.fullyConcealed) return false;
  if (d.sets.some((s) => s.fromMeld)) return false;
  const tiles = allTilesOf(d);
  const suit = suitOf(tiles[0]);
  if (!suit || tiles.some((t) => suitOf(t) !== suit)) return false;
  const counts = new Array(10).fill(0);
  for (const t of tiles) counts[rankOf(t)]++;
  if (counts[1] < 3 || counts[9] < 3) return false;
  for (let r = 2; r <= 8; r++) if (counts[r] < 1) return false;
  return true;
}
__name(isNineGates, "isNineGates");
function score(d, ctx) {
  const table = ctx.table ?? defaultFanTable;
  const patterns = [];
  const add = /* @__PURE__ */ __name((name, faan) => {
    if (faan !== 0) patterns.push({ name, faan });
  }, "add");
  if (d.shape === "thirteenOrphans") {
    add("Thirteen Orphans", table.thirteenOrphans);
  } else {
    const tiles = allTilesOf(d);
    const suits = new Set(tiles.filter(isSuit).map((t) => suitOf(t)));
    const hasHonours = tiles.some(isHonour);
    if (suits.size === 0 && hasHonours) add("All Honours", table.allHonours);
    else if (suits.size === 1 && hasHonours) add("Mixed One Suit", table.mixedOneSuit);
    else if (suits.size === 1 && !hasHonours) add("Pure One Suit", table.pureOneSuit);
    if (d.shape === "sevenPairs") add("Seven Pairs", table.sevenPairs);
    if (d.shape === "standard") {
      const sets = d.sets;
      if (sets.every((s) => s.type === "kong")) add("All Kongs", table.allKongs);
      if (sets.every((s) => s.type !== "chow")) add("All Pungs", table.allPungs);
      if (sets.every((s) => s.type === "chow") && !isHonour(d.pair[0]))
        add("All Chows", table.allChows);
      const pungKind = /* @__PURE__ */ __name((s) => s.tiles[0], "pungKind");
      const windPungs = sets.filter((s) => s.type !== "chow" && pungKind(s)[0] === "w");
      const dragonPungs = sets.filter((s) => s.type !== "chow" && pungKind(s)[0] === "d");
      const windPair = d.pair[0][0] === "w";
      const dragonPair = d.pair[0][0] === "d";
      for (const s of windPungs) {
        const w = pungKind(s)[1];
        if (w === ctx.seatWind) add("Seat Wind", table.seatWindPung);
        if (w === ctx.roundWind) add("Round Wind", table.roundWindPung);
      }
      for (const s of dragonPungs) add(DRAGON_NAMES[pungKind(s)[1]], table.dragonPung);
      if (dragonPungs.length === 3) add("Great Dragons", table.greatDragons);
      else if (dragonPungs.length === 2 && dragonPair) add("Small Dragons", table.smallDragons);
      if (windPungs.length === 4) add("Great Winds", table.greatWinds);
      else if (windPungs.length === 3 && windPair) add("Small Winds", table.smallWinds);
      if (isNineGates(d, ctx)) add("Nine Gates", table.nineGates);
    }
  }
  if (ctx.selfDraw) add("Self-draw", table.selfDraw);
  if (ctx.lastWallTile) add("Last Wall Tile", table.lastWallTile);
  if (ctx.kongReplacement) add("Kong Replacement", table.kongReplacementWin);
  const ownIdx = OWN_INDEX[ctx.seatWind];
  const own = ctx.flowers.filter((f) => Number(f[2]) === ownIdx).length;
  if (own > 0) add("Own Flowers", own * table.ownFlower);
  const flowerCount = ctx.flowers.filter((f) => f[1] === "f").length;
  const seasonCount = ctx.flowers.filter((f) => f[1] === "s").length;
  const fullSets = (flowerCount === 4 ? 1 : 0) + (seasonCount === 4 ? 1 : 0);
  if (fullSets > 0) add("Flower Set", fullSets * table.flowerSetBonus);
  const SUBSUMES = {
    "All Honours": ["All Pungs"],
    "All Kongs": ["All Pungs"],
    "Nine Gates": ["Pure One Suit"],
    "Great Dragons": ["Small Dragons", "Red Dragon Pung", "Green Dragon Pung", "White Dragon Pung"],
    "Small Dragons": ["Red Dragon Pung", "Green Dragon Pung", "White Dragon Pung"],
    "Great Winds": ["Small Winds", "Seat Wind", "Round Wind"],
    "Small Winds": ["Seat Wind", "Round Wind"]
  };
  const present = new Set(patterns.map((p) => p.name));
  const dropped = /* @__PURE__ */ new Set();
  for (const name of present) for (const loser of SUBSUMES[name] ?? []) dropped.add(loser);
  const kept = patterns.filter((p) => !dropped.has(p.name));
  let totalFaan = kept.reduce((sum, p) => sum + p.faan, 0);
  if (table.faanCap !== null) totalFaan = Math.min(totalFaan, table.faanCap);
  return { totalFaan, patterns: kept };
}
__name(score, "score");
function scoreBest(ds, ctx) {
  let bestResult = { totalFaan: 0, patterns: [] };
  let found = false;
  for (const d of ds) {
    const r = score(d, ctx);
    if (!found || r.totalFaan > bestResult.totalFaan) {
      bestResult = r;
      found = true;
    }
  }
  return bestResult;
}
__name(scoreBest, "scoreBest");
function winDeclarable(totalFaan, minimum) {
  return totalFaan >= minimum;
}
__name(winDeclarable, "winDeclarable");

// ../src/engine/rng.ts
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = h << 13 | h >>> 19;
  }
  return () => {
    h = Math.imul(h ^ h >>> 16, 2246822507);
    h = Math.imul(h ^ h >>> 13, 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}
__name(xmur3, "xmur3");
function makeRng(seed) {
  const seedFn = xmur3(seed);
  let a = seedFn();
  return {
    next() {
      a |= 0;
      a = a + 1831565813 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
  };
}
__name(makeRng, "makeRng");
function shuffle(xs, rng) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
__name(shuffle, "shuffle");

// ../src/engine/wall.ts
function buildWall(opts, rng) {
  const tiles = [];
  for (const kind of ALL_PLAY_KINDS) tiles.push(kind, kind, kind, kind);
  if (opts.flowers) tiles.push(...BONUS_KINDS);
  return shuffle(tiles, rng);
}
__name(buildWall, "buildWall");

// ../src/engine/win.ts
var ORPHAN_KINDS = [
  "m1",
  "m9",
  "p1",
  "p9",
  "s1",
  "s9",
  "wE",
  "wS",
  "wW",
  "wN",
  "dR",
  "dG",
  "dW"
];
function histogram(tiles) {
  const h = /* @__PURE__ */ new Map();
  for (const t of tiles) h.set(t, (h.get(t) ?? 0) + 1);
  return h;
}
__name(histogram, "histogram");
function meldToDecompSet(m) {
  return { type: m.type, tiles: [...m.tiles], concealed: m.concealed, fromMeld: true };
}
__name(meldToDecompSet, "meldToDecompSet");
var nextInSuit = /* @__PURE__ */ __name((id, step) => {
  if (!isSuit(id)) return null;
  const r = rankOf(id) + step;
  return r >= 1 && r <= 9 ? `${id[0]}${r}` : null;
}, "nextInSuit");
function extractMelds(hist, acc, out) {
  let lowest = null;
  for (const kind of ALL_PLAY_KINDS) {
    if ((hist.get(kind) ?? 0) > 0) {
      lowest = kind;
      break;
    }
  }
  if (lowest === null) {
    out.push(acc.map((s) => ({ ...s, tiles: [...s.tiles] })));
    return;
  }
  const count = hist.get(lowest);
  if (count >= 3) {
    hist.set(lowest, count - 3);
    acc.push({ type: "pung", tiles: [lowest, lowest, lowest], concealed: true, fromMeld: false });
    extractMelds(hist, acc, out);
    acc.pop();
    hist.set(lowest, count);
  }
  const t2 = nextInSuit(lowest, 1);
  const t3 = nextInSuit(lowest, 2);
  if (t2 && t3 && (hist.get(t2) ?? 0) > 0 && (hist.get(t3) ?? 0) > 0) {
    hist.set(lowest, count - 1);
    hist.set(t2, hist.get(t2) - 1);
    hist.set(t3, hist.get(t3) - 1);
    acc.push({ type: "chow", tiles: [lowest, t2, t3], concealed: true, fromMeld: false });
    extractMelds(hist, acc, out);
    acc.pop();
    hist.set(lowest, count);
    hist.set(t2, hist.get(t2) + 1);
    hist.set(t3, hist.get(t3) + 1);
  }
}
__name(extractMelds, "extractMelds");
function standardDecompositions(concealed, melds) {
  if (concealed.length !== 3 * (4 - melds.length) + 2) return [];
  const results = [];
  const seen = /* @__PURE__ */ new Set();
  const hist = histogram(concealed);
  for (const kind of [...hist.keys()].sort()) {
    if (hist.get(kind) < 2) continue;
    hist.set(kind, hist.get(kind) - 2);
    const partitions = [];
    extractMelds(hist, [], partitions);
    hist.set(kind, hist.get(kind) + 2);
    for (const sets of partitions) {
      const all = [...melds.map(meldToDecompSet), ...sets];
      const key = JSON.stringify([kind, all.map((s) => s.tiles.join("")).sort()]);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ shape: "standard", sets: all, pair: [kind, kind] });
    }
  }
  return results;
}
__name(standardDecompositions, "standardDecompositions");
function sevenPairsDecomposition(concealed, melds) {
  if (melds.length > 0 || concealed.length !== 14) return null;
  const hist = histogram(concealed);
  if (hist.size !== 7) return null;
  for (const c of hist.values()) if (c !== 2) return null;
  const pairs = sortTiles([...hist.keys()]).map((k) => [k, k]);
  return { shape: "sevenPairs", pairs };
}
__name(sevenPairsDecomposition, "sevenPairsDecomposition");
function thirteenOrphansDecomposition(concealed, melds) {
  if (melds.length > 0 || concealed.length !== 14) return null;
  const hist = histogram(concealed);
  let duplicated = null;
  for (const kind of ORPHAN_KINDS) {
    const c = hist.get(kind) ?? 0;
    if (c === 0 || c > 2) return null;
    if (c === 2) {
      if (duplicated) return null;
      duplicated = kind;
    }
  }
  if (!duplicated || hist.size !== 13) return null;
  return { shape: "thirteenOrphans", duplicated };
}
__name(thirteenOrphansDecomposition, "thirteenOrphansDecomposition");
function decompose(concealed, melds) {
  const out = standardDecompositions(concealed, melds);
  const sp = sevenPairsDecomposition(concealed, melds);
  if (sp) out.push(sp);
  const to = thirteenOrphansDecomposition(concealed, melds);
  if (to) out.push(to);
  return out;
}
__name(decompose, "decompose");

// ../src/engine/game.ts
var DEAD_WALL = 14;
var live = /* @__PURE__ */ __name((s) => s.wall.length - DEAD_WALL, "live");
var WINDS_BY_SEAT = ["E", "S", "W", "N"];
function createGameWithWall(config, wall, dealer = 0, roundWind = "E") {
  const w = [...wall];
  const hands = {};
  const melds = {};
  const bonus = {};
  const discards = {};
  const seatWinds = {};
  const order = [0, 1, 2, 3].map((i) => (dealer + i) % 4);
  for (const [i, seat] of order.entries()) {
    hands[seat] = w.splice(0, 13);
    melds[seat] = [];
    bonus[seat] = [];
    discards[seat] = [];
    seatWinds[seat] = WINDS_BY_SEAT[i];
  }
  hands[dealer].push(w.splice(0, 1)[0]);
  for (const seat of order) {
    const h = hands[seat];
    for (let i = h.findIndex(isBonus); i >= 0; i = h.findIndex(isBonus)) {
      bonus[seat].push(h[i]);
      h.splice(i, 1);
      let r = w.pop();
      while (r !== void 0 && isBonus(r)) {
        bonus[seat].push(r);
        r = w.pop();
      }
      if (r === void 0) throw new Error("wall exhausted during deal");
      h.push(r);
    }
    hands[seat] = sortTiles(h);
  }
  return {
    config,
    wall: w,
    hands,
    melds,
    bonus,
    discards,
    turn: dealer,
    phase: "discard",
    pendingDiscard: null,
    claims: {},
    lastDraw: { seat: dealer, tile: hands[dealer][0], kongReplacement: false, lastWallTile: false },
    lastClaimed: null,
    roundWind,
    seatWinds,
    log: [],
    result: null
  };
}
__name(createGameWithWall, "createGameWithWall");
function createGame(config, seed, dealer = 0, roundWind = "E") {
  const wall = buildWall({ flowers: config.flowers }, makeRng(seed));
  return createGameWithWall(config, wall, dealer, roundWind);
}
__name(createGame, "createGame");
function scoringContext(s, seat, byDiscard) {
  return {
    seatWind: s.seatWinds[seat],
    roundWind: s.roundWind,
    selfDraw: !byDiscard,
    flowers: s.bonus[seat],
    fullyConcealed: s.melds[seat].every((m) => m.concealed),
    lastWallTile: !byDiscard && (s.lastDraw?.lastWallTile ?? false),
    kongReplacement: !byDiscard && (s.lastDraw?.kongReplacement ?? false),
    ...s.config.faanCap !== null ? { table: { ...defaultFanTable, faanCap: s.config.faanCap } } : {}
  };
}
__name(scoringContext, "scoringContext");
function winFan(s, seat, concealed, byDiscard) {
  const ds = decompose(concealed, s.melds[seat]);
  if (ds.length === 0) return null;
  const fan = scoreBest(ds, scoringContext(s, seat, byDiscard));
  return winDeclarable(fan.totalFaan, s.config.faanMinimum) ? fan : null;
}
__name(winFan, "winFan");
function claimOptions(s, seat) {
  const pd = s.pendingDiscard;
  if (!pd || seat === pd.from) return [];
  const out = [];
  const h = s.hands[seat];
  const tile = pd.tile;
  const copies = h.filter((t) => t === tile).length;
  if (winFan(s, seat, [...h, tile], true)) out.push("win");
  if (copies >= 2) out.push("pung");
  if (copies >= 3 && live(s) > 0) out.push("kong");
  if (seat === nextSeat(pd.from) && isSuit(tile)) {
    const r = rankOf(tile);
    const suit = tile[0];
    const has = /* @__PURE__ */ __name((n) => n >= 1 && n <= 9 && h.includes(`${suit}${n}`), "has");
    const variants = [
      [r - 2, r - 1],
      [r - 1, r + 1],
      [r + 1, r + 2]
    ];
    for (const [a, b] of variants) {
      if (has(a) && has(b)) out.push({ chow: [`${suit}${a}`, `${suit}${b}`] });
    }
  }
  return out;
}
__name(claimOptions, "claimOptions");
function eligibleSeats(s) {
  return SEATS.filter((seat) => claimOptions(s, seat).length > 0);
}
__name(eligibleSeats, "eligibleSeats");
function legalActions(s, seat) {
  if (s.phase === "finished") return [];
  if (s.phase === "draw") {
    return seat === s.turn ? [{ type: "draw", seat }] : [];
  }
  if (s.phase === "discard") {
    if (seat !== s.turn) return [];
    const out = [];
    const h = s.hands[seat];
    for (const tile of new Set(h)) out.push({ type: "discard", seat, tile });
    if (s.lastDraw?.seat === seat && winFan(s, seat, h, false)) {
      out.push({ type: "declareWin", seat });
    }
    if (live(s) > 0) {
      const counts = /* @__PURE__ */ new Map();
      for (const t of h) counts.set(t, (counts.get(t) ?? 0) + 1);
      for (const [tile, c] of counts) {
        if (c === 4) out.push({ type: "kong", seat, tile, style: "concealed" });
      }
      for (const m of s.melds[seat]) {
        if (m.type === "pung" && !m.concealed && h.includes(m.tiles[0])) {
          out.push({ type: "kong", seat, tile: m.tiles[0], style: "added" });
        }
      }
    }
    return out;
  }
  if (s.claims[seat] !== void 0) return [];
  const opts = claimOptions(s, seat);
  if (opts.length === 0) return [];
  return [
    ...opts.map((claim) => ({ type: "claim", seat, claim })),
    { type: "pass", seat }
  ];
}
__name(legalActions, "legalActions");
var canon = /* @__PURE__ */ __name((a) => JSON.stringify(
  a,
  (_k, v) => Array.isArray(v) && v.length === 2 && typeof v[0] === "string" ? [...v].sort() : v
), "canon");
function removeTiles(h, tiles) {
  for (const t of tiles) {
    const i = h.indexOf(t);
    if (i < 0) throw new Error(`tile ${t} not in hand`);
    h.splice(i, 1);
  }
}
__name(removeTiles, "removeTiles");
function replacementDraw(s, seat) {
  let r = s.wall.pop();
  while (r !== void 0 && isBonus(r)) {
    s.bonus[seat].push(r);
    r = s.wall.pop();
  }
  if (r === void 0) throw new Error("wall exhausted on replacement draw");
  return r;
}
__name(replacementDraw, "replacementDraw");
function finishWin(s, seat, byDiscard) {
  if (byDiscard) {
    s.hands[seat] = sortTiles([...s.hands[seat], s.pendingDiscard.tile]);
  }
  const fan = winFan(s, seat, s.hands[seat], byDiscard);
  if (!fan) throw new Error("finishWin called on a non-declarable hand");
  s.result = {
    kind: "win",
    winner: seat,
    ...byDiscard ? { loser: s.pendingDiscard.from } : {},
    selfDraw: !byDiscard,
    fan
  };
  s.pendingDiscard = null;
  s.phase = "finished";
}
__name(finishWin, "finishWin");
function resolveClaims(s) {
  const from = s.pendingDiscard.from;
  const tile = s.pendingDiscard.tile;
  const inOrder = [1, 2, 3].map((i) => (from + i) % 4);
  const winner = inOrder.find((seat) => s.claims[seat] === "win");
  if (winner !== void 0) {
    finishWin(s, winner, true);
    return;
  }
  const melder = inOrder.find((seat) => {
    const c = s.claims[seat];
    return c === "pung" || c === "kong" || typeof c === "object" && c !== null;
  });
  if (melder !== void 0) {
    const c = s.claims[melder];
    const h = s.hands[melder];
    if (c === "pung") {
      removeTiles(h, [tile, tile]);
      s.melds[melder].push({ type: "pung", tiles: [tile, tile, tile], concealed: false, claimedFrom: from });
    } else if (c === "kong") {
      removeTiles(h, [tile, tile, tile]);
      s.melds[melder].push({
        type: "kong",
        tiles: [tile, tile, tile, tile],
        concealed: false,
        kongStyle: "exposed",
        claimedFrom: from
      });
      const r = replacementDraw(s, melder);
      h.push(r);
      s.lastDraw = { seat: melder, tile: r, kongReplacement: true, lastWallTile: live(s) <= 0 };
    } else if (typeof c === "object") {
      removeTiles(h, c.chow);
      s.melds[melder].push({
        type: "chow",
        tiles: sortTiles([...c.chow, tile]),
        concealed: false,
        claimedFrom: from
      });
    }
    s.hands[melder] = sortTiles(h);
    if (c !== "kong") s.lastDraw = null;
    s.lastClaimed = tile;
    s.pendingDiscard = null;
    s.claims = {};
    s.turn = melder;
    s.phase = "discard";
    return;
  }
  s.discards[from].push(tile);
  s.pendingDiscard = null;
  s.claims = {};
  if (live(s) <= 0) {
    s.result = { kind: "draw" };
    s.phase = "finished";
  } else {
    s.turn = nextSeat(from);
    s.phase = "draw";
  }
}
__name(resolveClaims, "resolveClaims");
function applyAction(state, action) {
  const legal = legalActions(state, action.seat);
  const key = canon(action);
  if (!legal.some((a) => canon(a) === key)) {
    throw new Error(`illegal action: ${JSON.stringify(action)} (phase ${state.phase}, turn ${state.turn})`);
  }
  const s = structuredClone(state);
  s.log.push(action);
  switch (action.type) {
    case "draw": {
      let tile = s.wall.shift();
      while (isBonus(tile)) {
        s.bonus[action.seat].push(tile);
        const r = s.wall.pop();
        if (r === void 0) throw new Error("wall exhausted on bonus replacement");
        tile = r;
      }
      s.hands[action.seat] = sortTiles([...s.hands[action.seat], tile]);
      s.lastDraw = { seat: action.seat, tile, kongReplacement: false, lastWallTile: live(s) <= 0 };
      s.phase = "discard";
      break;
    }
    case "discard": {
      removeTiles(s.hands[action.seat], [action.tile]);
      s.pendingDiscard = { tile: action.tile, from: action.seat };
      s.claims = {};
      s.phase = "claims";
      if (eligibleSeats(s).length === 0) resolveClaims(s);
      break;
    }
    case "declareWin": {
      finishWin(s, action.seat, false);
      break;
    }
    case "kong": {
      const h = s.hands[action.seat];
      if (action.style === "concealed") {
        removeTiles(h, [action.tile, action.tile, action.tile, action.tile]);
        s.melds[action.seat].push({
          type: "kong",
          tiles: [action.tile, action.tile, action.tile, action.tile],
          concealed: true,
          kongStyle: "concealed"
        });
      } else {
        removeTiles(h, [action.tile]);
        const pung = s.melds[action.seat].find(
          (m) => m.type === "pung" && m.tiles[0] === action.tile
        );
        pung.type = "kong";
        pung.tiles = [action.tile, action.tile, action.tile, action.tile];
        pung.kongStyle = "added";
      }
      const r = replacementDraw(s, action.seat);
      s.hands[action.seat] = sortTiles([...h, r]);
      s.lastDraw = { seat: action.seat, tile: r, kongReplacement: true, lastWallTile: live(s) <= 0 };
      s.phase = "discard";
      break;
    }
    case "claim":
    case "pass": {
      s.claims[action.seat] = action.type === "pass" ? "pass" : action.claim;
      const waiting = eligibleSeats(s).filter((seat) => s.claims[seat] === void 0);
      if (waiting.length === 0) resolveClaims(s);
      break;
    }
  }
  return s;
}
__name(applyAction, "applyAction");
function playerView(s, seat) {
  const melds = {};
  for (const other of SEATS) {
    melds[other] = s.melds[other].map(
      (m) => other !== seat && m.type === "kong" && m.concealed ? { ...m, tiles: [] } : structuredClone(m)
    );
  }
  return {
    seat,
    seatWind: s.seatWinds[seat],
    roundWind: s.roundWind,
    seatWinds: { ...s.seatWinds },
    concealed: [...s.hands[seat]],
    handCounts: {
      0: s.hands[0].length,
      1: s.hands[1].length,
      2: s.hands[2].length,
      3: s.hands[3].length
    },
    melds,
    bonus: structuredClone(s.bonus),
    discards: structuredClone(s.discards),
    wallCount: live(s),
    faanMinimum: s.config.faanMinimum,
    turn: s.turn,
    phase: s.phase,
    pendingDiscard: s.pendingDiscard ? { ...s.pendingDiscard } : null,
    lastClaimed: s.lastClaimed,
    legal: legalActions(s, seat)
  };
}
__name(playerView, "playerView");

// ../src/room/RoomRunner.ts
var WIND_ORDER = ["E", "S", "W", "N"];
function nextRoundSetup(result, match) {
  const dealerRepeats = result?.kind === "draw" || result?.kind === "win" && result.winner === match.dealer;
  const dealer = dealerRepeats ? match.dealer : nextSeat(match.dealer);
  const roundWind = !dealerRepeats && dealer === 0 ? WIND_ORDER[(WIND_ORDER.indexOf(match.roundWind) + 1) % 4] : match.roundWind;
  return { dealer, roundWind, roundNo: match.roundNo + 1 };
}
__name(nextRoundSetup, "nextRoundSetup");
var RoomRunner = class _RoomRunner {
  constructor(opts) {
    this.opts = opts;
    this.rules = opts.rules;
    this.seats = { ...opts.seats };
    this.botSeed = opts.botSeed ?? `bots-${Math.random().toString(36).slice(2)}`;
    this.logIssue = opts.logIssue ?? ((m) => console.warn(`[room] ${m}`));
    this.match = {
      dealer: opts.dealer ?? 0,
      roundWind: opts.roundWind ?? "E",
      roundNo: 1,
      scores: { 0: 0, 1: 0, 2: 0, 3: 0 }
    };
  }
  opts;
  static {
    __name(this, "RoomRunner");
  }
  game = null;
  match;
  rules;
  seats;
  /** State version: increments once per applied action / round start. */
  seq = 0;
  paceTimer = null;
  windowTimer = null;
  stopped = false;
  botSeed;
  logIssue;
  /** Resurrect a runner from a snapshot. Caller still wires messages+start. */
  static restore(snapshot, opts) {
    const r = new _RoomRunner({ ...opts, rules: snapshot.rules, seats: snapshot.seats });
    r.game = snapshot.game ? structuredClone(snapshot.game) : null;
    r.match = structuredClone(snapshot.match);
    r.seq = snapshot.seq;
    return r;
  }
  serialize() {
    return structuredClone({
      game: this.game,
      match: this.match,
      rules: this.rules,
      seats: this.seats,
      seq: this.seq,
      botSeed: this.botSeed
    });
  }
  /** Idempotent: first call deals; later calls just re-arm pacing. */
  start() {
    this.stopped = false;
    if (!this.game) {
      this.game = this.opts.initialGame ?? createGame(this.rules, this.opts.makeRoundSeed(1), this.match.dealer, this.match.roundWind);
      this.afterChange();
    } else {
      this.pump();
    }
  }
  /** Cancels all timers. start() resumes from the current state. */
  stop() {
    this.stopped = true;
    this.clearTimers();
  }
  /** Re-send current state to one seat — the reconnect/replay path (§6). */
  resend(seat) {
    const g = this.game;
    if (!g) return;
    this.opts.transport.send(seat, {
      type: "view",
      seq: this.seq,
      view: playerView(g, seat),
      match: this.matchSnapshot()
    });
    if (g.phase === "finished") {
      this.opts.transport.send(seat, {
        type: "finished",
        seq: this.seq,
        result: g.result,
        log: [...g.log],
        match: this.matchSnapshot()
      });
    }
  }
  // ------------------------------------------------------------ inbound ----
  /** Entry point for client messages; the room owner wires the transport. */
  receive(seat, msg) {
    if (msg.type === "newRound") {
      this.handleNewRound(seat, msg.rules, msg.seats);
      return;
    }
    if (msg.type === "intent") {
      this.handleIntent(seat, msg.action);
      return;
    }
    this.logIssue(`runner ignoring '${msg.type}' message from seat ${seat}`);
  }
  handleIntent(seat, action) {
    const g = this.game;
    if (!g) return;
    if (action.seat !== seat) {
      this.logIssue(`seat ${seat} sent an intent for seat ${action.seat}`);
      this.reject(seat, "intent names another seat");
      return;
    }
    if (this.seats[seat].kind !== "human") {
      this.logIssue(`intent for non-human seat ${seat}`);
      this.reject(seat, "seat is not human-controlled");
      return;
    }
    try {
      this.game = applyAction(g, action);
    } catch (e) {
      this.logIssue(`illegal intent from seat ${seat}: ${JSON.stringify(action)} \u2014 ${String(e)}`);
      this.reject(seat, e instanceof Error ? e.message : "illegal action");
      if (g.phase === "claims" && action.type === "claim" && legalActions(g, seat).some((a) => a.type === "pass")) {
        this.game = applyAction(g, { type: "pass", seat });
        this.afterChange();
      }
      return;
    }
    this.afterChange();
  }
  handleNewRound(seat, rules, seats) {
    const g = this.game;
    if (!g || g.phase !== "finished") {
      this.reject(seat, "round is still in progress");
      return;
    }
    if (this.seats[seat].kind !== "human") {
      this.reject(seat, "seat is not human-controlled");
      return;
    }
    const setup = nextRoundSetup(g.result, this.match);
    this.match = { ...this.match, ...setup };
    if (rules) this.rules = rules;
    if (seats) this.seats = { ...seats };
    this.game = createGame(
      this.rules,
      this.opts.makeRoundSeed(setup.roundNo),
      setup.dealer,
      setup.roundWind
    );
    this.afterChange();
  }
  // ----------------------------------------------------------- outbound ----
  matchSnapshot() {
    return { ...this.match, scores: { ...this.match.scores } };
  }
  reject(seat, reason) {
    this.opts.transport.send(seat, { type: "rejected", seq: this.seq, reason });
  }
  /** After every applied action: bank scores, publish views, re-arm pacing. */
  afterChange() {
    const g = this.game;
    this.seq++;
    if (g.phase === "finished") {
      const r = g.result;
      if (r?.kind === "win" && r.winner !== void 0 && r.fan) {
        this.match.scores[r.winner] += r.fan.totalFaan;
      }
    }
    for (const seat of SEATS) {
      this.opts.transport.send(seat, {
        type: "view",
        seq: this.seq,
        view: playerView(g, seat),
        match: this.matchSnapshot()
      });
    }
    if (g.phase === "finished") {
      this.opts.transport.broadcast({
        type: "finished",
        seq: this.seq,
        result: g.result,
        log: [...g.log],
        match: this.matchSnapshot()
      });
    }
    this.opts.onChange?.();
    this.pump();
  }
  // ------------------------------------------------------------- pacing ----
  clearTimers() {
    if (this.paceTimer) {
      this.opts.clock.clearTimeout(this.paceTimer);
      this.paceTimer = null;
    }
    if (this.windowTimer) {
      this.opts.clock.clearTimeout(this.windowTimer);
      this.windowTimer = null;
    }
  }
  schedulePace(ms, fn) {
    this.paceTimer = this.opts.clock.setTimeout(() => {
      this.paceTimer = null;
      fn();
    }, ms);
  }
  /**
   * Looks at the current phase and arms exactly the timers it needs. Runs
   * after every state change; idempotent because clearTimers() comes first.
   */
  pump() {
    this.clearTimers();
    if (this.stopped) return;
    const g = this.game;
    if (!g || g.phase === "finished") return;
    if (g.phase === "draw") {
      this.schedulePace(this.opts.timing.drawDelayMs, () => {
        this.applyAuto({ type: "draw", seat: this.game.turn });
      });
      return;
    }
    if (g.phase === "discard") {
      const ctl = this.seats[g.turn];
      if (ctl.kind === "bot") {
        this.schedulePace(this.opts.timing.botDelayMs, () => this.applyBotTurn());
      }
      return;
    }
    const eligibleBots = SEATS.filter(
      (s) => this.seats[s].kind === "bot" && legalActions(g, s).length > 0
    );
    const eligibleHumans = SEATS.filter(
      (s) => this.seats[s].kind === "human" && legalActions(g, s).length > 0
    );
    if (eligibleBots.length > 0) {
      const instant = eligibleHumans.length === 0 && this.opts.timing.instantAllBotClaims;
      this.schedulePace(instant ? 0 : this.opts.timing.botDelayMs, () => this.applyNextBotClaim());
    }
    if (eligibleHumans.length > 0 && this.opts.timing.claimWindowMs !== null) {
      this.windowTimer = this.opts.clock.setTimeout(() => {
        this.windowTimer = null;
        this.expireClaimWindow();
      }, this.opts.timing.claimWindowMs);
    }
  }
  applyBotTurn() {
    const g = this.game;
    if (!g || g.phase !== "discard") return;
    const ctl = this.seats[g.turn];
    if (ctl.kind !== "bot") return;
    const view = playerView(g, g.turn);
    this.applyAuto(botAction(view, ctl.difficulty, this.botRng()));
  }
  /** One bot claim response per pacing tick; pump() reschedules the rest. */
  applyNextBotClaim() {
    const g = this.game;
    if (!g || g.phase !== "claims") return;
    const seat = SEATS.find(
      (s) => this.seats[s].kind === "bot" && legalActions(g, s).length > 0
    );
    if (seat === void 0) return;
    const ctl = this.seats[seat];
    if (ctl.kind !== "bot") return;
    const view = playerView(g, seat);
    this.applyAuto(botAction(view, ctl.difficulty, this.botRng()));
  }
  /** Window lapsed (§5.2 rule 7): every silent eligible seat passes. */
  expireClaimWindow() {
    let g = this.game;
    if (!g || g.phase !== "claims") return;
    for (const seat of SEATS) {
      g = this.game;
      if (!g || g.phase !== "claims") break;
      if (legalActions(g, seat).some((a) => a.type === "pass")) {
        this.game = applyAction(g, { type: "pass", seat });
        this.afterChange();
      }
    }
  }
  /** Server-originated actions (draws, bots, timeouts) — must never throw. */
  applyAuto(action) {
    const g = this.game;
    if (!g) return;
    try {
      this.game = applyAction(g, action);
    } catch (e) {
      this.logIssue(`internal action rejected: ${JSON.stringify(action)} \u2014 ${String(e)}`);
      return;
    }
    this.afterChange();
  }
  botRng() {
    return makeRng(`${this.botSeed}:${this.match.roundNo}:${this.game?.log.length ?? 0}`);
  }
};

// ../src/room/RoomHost.ts
function multiplayerTiming(rules) {
  return {
    drawDelayMs: 300,
    botDelayMs: 650,
    claimWindowMs: rules.claimWindowSec * 1e3,
    turnTimerMs: rules.turnTimerSec * 1e3,
    instantAllBotClaims: true
    // §5.2 rule 6: don't fake suspense for bots
  };
}
__name(multiplayerTiming, "multiplayerTiming");
var DEFAULT_BOT_DIFFICULTY = "intermediate";
var RoomHost = class _RoomHost {
  constructor(opts) {
    this.opts = opts;
    this.code = opts.code;
    this.rules = opts.rules ?? DEFAULT_HOUSE_RULES;
    this.logIssue = opts.logIssue ?? ((m) => console.warn(`[room ${opts.code}] ${m}`));
    this.seats = {
      0: emptySeat(),
      1: emptySeat(),
      2: emptySeat(),
      3: emptySeat()
    };
  }
  opts;
  static {
    __name(this, "RoomHost");
  }
  phase = "lobby";
  hostSeat = 0;
  rules;
  seats;
  runner = null;
  code;
  logIssue;
  static restore(snapshot, opts) {
    const h = new _RoomHost({ ...opts, code: snapshot.code, rules: snapshot.rules });
    h.phase = snapshot.phase;
    h.hostSeat = snapshot.hostSeat;
    h.seats = structuredClone(snapshot.seats);
    for (const s of SEATS) if (h.seats[s].kind === "human") h.seats[s].connected = false;
    if (snapshot.runner) {
      h.runner = RoomRunner.restore(snapshot.runner, h.runnerOptions());
    }
    return h;
  }
  serialize() {
    return {
      code: this.code,
      phase: this.phase,
      hostSeat: this.hostSeat,
      rules: structuredClone(this.rules),
      seats: structuredClone(this.seats),
      runner: this.runner ? this.runner.serialize() : null
    };
  }
  /** Re-arm timers after a restore (idempotent, mirrors RoomRunner.start). */
  resume() {
    this.runner?.start();
  }
  stop() {
    this.runner?.stop();
  }
  // ------------------------------------------------------------- joining ----
  /**
   * A new human wants in. Fills the lowest open seat; the first human in an
   * empty room becomes the host. Late joiners fill open seats until the game
   * starts (spec §4); after start, only token reclaims get you a seat.
   */
  joinHuman(rawName) {
    const name = sanitizeName(rawName);
    if (this.phase === "playing") return { ok: false, reason: "game already started" };
    const seat = SEATS.find((s) => this.seats[s].kind === "open");
    if (seat === void 0) return { ok: false, reason: "room is full" };
    this.seats[seat] = { kind: "human", name, difficulty: DEFAULT_BOT_DIFFICULTY, connected: true };
    if (SEATS.every((s) => s === seat || this.seats[s].kind !== "human")) {
      this.hostSeat = seat;
    }
    this.afterRoomChange();
    return { ok: true, seat };
  }
  /** Socket-level presence, reported by the shell. */
  setConnected(seat, connected) {
    if (this.seats[seat].kind !== "human") return;
    if (this.seats[seat].connected === connected) return;
    this.seats[seat].connected = connected;
    this.afterRoomChange();
  }
  /** Reconnect: mark present and replay current game state to that seat. */
  onReconnect(seat) {
    this.setConnected(seat, true);
    this.runner?.resend(seat);
  }
  /** True when no human seat has a live socket (shell uses this for GC). */
  allHumansDisconnected() {
    return SEATS.every((s) => this.seats[s].kind !== "human" || !this.seats[s].connected);
  }
  humanSeats() {
    return SEATS.filter((s) => this.seats[s].kind === "human");
  }
  getPhase() {
    return this.phase;
  }
  coachAllowed() {
    return this.rules.coachAllowed;
  }
  // ------------------------------------------------------------ messages ----
  receive(seat, msg) {
    switch (msg.type) {
      case "lobby":
        this.handleLobby(seat, msg);
        return;
      case "start":
        this.handleStart(seat);
        return;
      case "intent":
        if (this.phase !== "playing" || !this.runner) {
          this.reject(seat, "game has not started");
          return;
        }
        this.runner.receive(seat, msg);
        return;
      case "newRound":
        if (this.phase !== "playing" || !this.runner) {
          this.reject(seat, "game has not started");
          return;
        }
        if (seat !== this.hostSeat) {
          this.reject(seat, "only the host starts the next round");
          return;
        }
        this.runner.receive(seat, { type: "newRound" });
        return;
    }
  }
  handleLobby(seat, msg) {
    if (this.phase !== "lobby") {
      this.reject(seat, "game already started");
      return;
    }
    if (seat !== this.hostSeat) {
      this.logIssue(`non-host seat ${seat} tried lobby op ${msg.op}`);
      this.reject(seat, "host only");
      return;
    }
    if (msg.op === "rules") {
      this.rules = sanitizeHouseRules(msg.rules);
      this.afterRoomChange();
      return;
    }
    const target = this.seats[msg.seat];
    if (!target || msg.seat === this.hostSeat) {
      this.reject(seat, "cannot change that seat");
      return;
    }
    if (target.kind === "human") {
      this.reject(seat, "a player is sitting there");
      return;
    }
    if (msg.kind === "bot") {
      const difficulty = isDifficulty(msg.difficulty) ? msg.difficulty : DEFAULT_BOT_DIFFICULTY;
      this.seats[msg.seat] = { kind: "bot", name: null, difficulty, connected: true };
    } else {
      this.seats[msg.seat] = emptySeat();
    }
    this.afterRoomChange();
  }
  handleStart(seat) {
    if (this.phase !== "lobby") {
      this.reject(seat, "game already started");
      return;
    }
    if (seat !== this.hostSeat) {
      this.reject(seat, "host only");
      return;
    }
    for (const s of SEATS) {
      if (this.seats[s].kind === "open") {
        this.seats[s] = { kind: "bot", name: null, difficulty: DEFAULT_BOT_DIFFICULTY, connected: true };
      }
    }
    this.phase = "playing";
    this.runner = new RoomRunner(this.runnerOptions());
    this.afterRoomChange();
    this.runner.start();
  }
  runnerOptions() {
    return {
      rules: {
        faanMinimum: this.rules.faanMinimum,
        flowers: this.rules.flowers,
        faanCap: this.rules.faanCap
      },
      seats: this.seatControllers(),
      timing: multiplayerTiming(this.rules),
      clock: this.opts.clock,
      transport: this.opts.transport,
      makeRoundSeed: /* @__PURE__ */ __name(() => this.opts.makeRoundSeed(), "makeRoundSeed"),
      ...this.opts.botSeed ? { botSeed: this.opts.botSeed } : {},
      logIssue: this.logIssue,
      onChange: /* @__PURE__ */ __name(() => this.opts.onDirty?.(), "onChange"),
      dealer: this.hostSeat
    };
  }
  seatControllers() {
    const out = {};
    for (const s of SEATS) {
      const seat = this.seats[s];
      out[s] = seat.kind === "human" ? { kind: "human" } : { kind: "bot", difficulty: seat.difficulty };
    }
    return out;
  }
  // ------------------------------------------------------------ outbound ----
  roomInfo(you) {
    const seats = {};
    for (const s of SEATS) {
      const st = this.seats[s];
      seats[s] = { kind: st.kind, name: st.name, difficulty: st.difficulty, connected: st.connected };
    }
    return {
      code: this.code,
      phase: this.phase,
      hostSeat: this.hostSeat,
      you,
      seats,
      rules: structuredClone(this.rules)
    };
  }
  /** Room-level state changed: tell every seat (views are the runner's job). */
  afterRoomChange() {
    for (const s of SEATS) {
      this.opts.transport.send(s, { type: "room", room: this.roomInfo(s) });
    }
    this.opts.onDirty?.();
  }
  reject(seat, reason) {
    this.opts.transport.send(seat, { type: "rejected", seq: -1, reason });
  }
};
function emptySeat() {
  return { kind: "open", name: null, difficulty: DEFAULT_BOT_DIFFICULTY, connected: false };
}
__name(emptySeat, "emptySeat");
function sanitizeName(raw) {
  const name = String(raw).replace(/[\r\n\t]/g, " ").trim().slice(0, 24);
  return name.length > 0 ? name : "Player";
}
__name(sanitizeName, "sanitizeName");
function isDifficulty(d) {
  return d === "easy" || d === "intermediate" || d === "advanced";
}
__name(isDifficulty, "isDifficulty");

// src/NetTransport.ts
var seatTag = /* @__PURE__ */ __name((seat) => `seat:${seat}`, "seatTag");
var NetTransport = class {
  constructor(ctx) {
    this.ctx = ctx;
  }
  ctx;
  static {
    __name(this, "NetTransport");
  }
  handler = null;
  send(seat, msg) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets(seatTag(seat))) this.trySend(ws, data);
  }
  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) this.trySend(ws, data);
  }
  onMessage(cb) {
    this.handler = cb;
  }
  /** Called by the DO's webSocketMessage handler. */
  deliver(seat, msg) {
    this.handler?.(seat, msg);
  }
  trySend(ws, data) {
    try {
      ws.send(data);
    } catch {
    }
  }
};

// src/RoomDO.ts
var SNAPSHOT_KEY = "snapshot";
var TOKENS_KEY = "tokens";
var ALARMS_KEY = "alarms";
var GC_GRACE_MS = 30 * 60 * 1e3;
var CLOSE_ROOM_GONE = 4e3;
var CLOSE_SEAT_RECLAIMED = 4002;
var RoomDO = class extends DurableObject {
  static {
    __name(this, "RoomDO");
  }
  host = null;
  transport;
  constructor(ctx, env) {
    super(ctx, env);
    this.transport = new NetTransport(ctx);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }
  // ------------------------------------------------------------ lifecycle --
  wire(host) {
    this.transport.onMessage((seat, msg) => {
      host.receive(seat, msg);
    });
  }
  hostOptions(code) {
    return {
      code,
      clock: systemClock,
      transport: this.transport,
      // §2.3: the wall seed is crypto-random, consumed by createGame, and
      // never stored, logged, or transmitted anywhere.
      makeRoundSeed: /* @__PURE__ */ __name(() => makeSecretSeed(), "makeRoundSeed"),
      botSeed: makeSecretSeed(),
      logIssue: /* @__PURE__ */ __name((m) => console.warn(`[room ${code}] ${m}`), "logIssue"),
      onDirty: /* @__PURE__ */ __name(() => this.save(), "onDirty")
    };
  }
  save() {
    if (!this.host) return;
    void this.ctx.storage.put(SNAPSHOT_KEY, this.host.serialize());
  }
  async load() {
    if (this.host) return this.host;
    const snap = await this.ctx.storage.get(SNAPSHOT_KEY);
    if (!snap) return null;
    const host = RoomHost.restore(snap, this.hostOptions(snap.code));
    this.wire(host);
    this.host = host;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment();
      if (att) host.setConnected(att.seat, true);
    }
    host.resume();
    return host;
  }
  // ---------------------------------------------------------------- fetch --
  async fetch(request) {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/create":
        return this.handleCreate(url);
      case "/info":
        return this.handleInfo();
      case "/ws":
        return this.handleWs(request, url);
      case "/debug":
        return this.handleDebug();
      case "/reset":
        return this.handleReset();
      default:
        return json({ error: "not found" }, 404);
    }
  }
  async handleCreate(url) {
    const code = url.searchParams.get("code") ?? "";
    if (await this.ctx.storage.get(SNAPSHOT_KEY)) {
      return json({ error: "code collision" }, 409);
    }
    const host = new RoomHost(this.hostOptions(code));
    this.wire(host);
    this.host = host;
    this.save();
    await this.setAlarmFor("gc", Date.now() + GC_GRACE_MS);
    return json({ ok: true });
  }
  async handleInfo() {
    const host = await this.load();
    if (!host) return json({ error: "no such room" }, 404);
    const info = host.roomInfo(0);
    return json({
      phase: info.phase,
      seats: SEATS.map((s) => ({
        kind: info.seats[s].kind,
        name: info.seats[s].name,
        connected: info.seats[s].connected
      })),
      joinable: info.phase === "lobby" && SEATS.some((s) => info.seats[s].kind === "open")
    });
  }
  async handleWs(request, url) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "expected websocket" }, 426);
    }
    const host = await this.load();
    if (!host) return json({ error: "no such room" }, 404);
    const token = url.searchParams.get("token");
    let seat;
    if (token) {
      const tokens2 = await this.ctx.storage.get(TOKENS_KEY) ?? {};
      const claimed = SEATS.find((s) => tokens2[s] !== void 0 && tokens2[s] === token);
      if (claimed === void 0) return json({ error: "bad token" }, 403);
      seat = claimed;
      for (const ws of this.ctx.getWebSockets(seatTag(seat))) {
        ws.close(CLOSE_SEAT_RECLAIMED, "seat reclaimed from another connection");
      }
    } else {
      const name = url.searchParams.get("name") ?? "";
      const joined = host.joinHuman(name);
      if (!joined.ok) return json({ error: joined.reason }, 409);
      seat = joined.seat;
      const tokens2 = await this.ctx.storage.get(TOKENS_KEY) ?? {};
      tokens2[seat] = makeSeatToken();
      await this.ctx.storage.put(TOKENS_KEY, tokens2);
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [seatTag(seat)]);
    pair[1].serializeAttachment({ seat });
    const tokens = await this.ctx.storage.get(TOKENS_KEY) ?? {};
    pair[1].send(
      JSON.stringify({ type: "joined", seat, token: tokens[seat], room: host.roomInfo(seat) })
    );
    host.onReconnect(seat);
    await this.clearAlarmFor("gc");
    this.save();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  async handleDebug() {
    const snap = await this.ctx.storage.get(SNAPSHOT_KEY);
    const alarms = await this.ctx.storage.get(ALARMS_KEY);
    return json({
      snapshot: snap ?? null,
      alarms: alarms ?? {},
      sockets: SEATS.map((s) => ({ seat: s, open: this.ctx.getWebSockets(seatTag(s)).length })),
      now: Date.now()
    });
  }
  async handleReset() {
    for (const ws of this.ctx.getWebSockets()) ws.close(CLOSE_ROOM_GONE, "room reset");
    this.host?.stop();
    this.host = null;
    await this.ctx.storage.deleteAll();
    return json({ ok: true });
  }
  // ------------------------------------------------------------- sockets --
  async webSocketMessage(ws, message) {
    const att = ws.deserializeAttachment();
    if (att === null) return;
    const host = await this.load();
    if (!host) {
      ws.close(CLOSE_ROOM_GONE, "room no longer exists");
      return;
    }
    let msg;
    try {
      const parsed = JSON.parse(typeof message === "string" ? message : "");
      if (typeof parsed !== "object" || parsed === null || typeof parsed.type !== "string") {
        throw new Error("bad shape");
      }
      msg = parsed;
    } catch {
      console.warn(`[room] unparseable message from seat ${att.seat}`);
      return;
    }
    this.transport.deliver(att.seat, msg);
    this.save();
  }
  async webSocketClose(ws) {
    await this.dropSocket(ws);
  }
  async webSocketError(ws) {
    await this.dropSocket(ws);
  }
  async dropSocket(ws) {
    const att = ws.deserializeAttachment();
    if (att === null) return;
    const host = await this.load();
    if (!host) return;
    const remaining = this.ctx.getWebSockets(seatTag(att.seat)).filter((w) => w !== ws && w.readyState === WebSocket.READY_STATE_OPEN);
    if (remaining.length === 0) {
      host.setConnected(att.seat, false);
    }
    if (host.allHumansDisconnected()) {
      await this.setAlarmFor("gc", Date.now() + GC_GRACE_MS);
    }
    this.save();
  }
  // -------------------------------------------------------------- alarms --
  async setAlarmFor(kind, at) {
    const alarms = await this.ctx.storage.get(ALARMS_KEY) ?? {};
    alarms[kind] = at;
    await this.ctx.storage.put(ALARMS_KEY, alarms);
    await this.rearm(alarms);
  }
  async clearAlarmFor(kind) {
    const alarms = await this.ctx.storage.get(ALARMS_KEY) ?? {};
    if (!(kind in alarms)) return;
    delete alarms[kind];
    await this.ctx.storage.put(ALARMS_KEY, alarms);
    await this.rearm(alarms);
  }
  async rearm(alarms) {
    const times = Object.values(alarms);
    if (times.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Math.min(...times));
  }
  async alarm() {
    const now = Date.now();
    const alarms = await this.ctx.storage.get(ALARMS_KEY) ?? {};
    for (const [kind, at] of Object.entries(alarms)) {
      if (at > now) continue;
      delete alarms[kind];
      if (kind === "gc" && await this.gcIfAbandoned()) {
        return;
      }
    }
    await this.ctx.storage.put(ALARMS_KEY, alarms);
    await this.rearm(alarms);
  }
  /** Returns true when the room was destroyed. */
  async gcIfAbandoned() {
    const host = await this.load();
    if (!host) {
      await this.ctx.storage.deleteAll();
      return true;
    }
    if (!host.allHumansDisconnected()) return false;
    console.log(`[room] GC: last human long gone, deleting room`);
    for (const ws of this.ctx.getWebSockets()) ws.close(CLOSE_ROOM_GONE, "room expired");
    this.host?.stop();
    this.host = null;
    await this.ctx.storage.deleteAll();
    return true;
  }
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
__name(json, "json");

// src/index.ts
var CREATE_ATTEMPTS = 5;
var src_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (!originAllowed(origin, env)) {
      return json2({ error: "origin not allowed" }, 403, corsHeaders(null));
    }
    const cors = corsHeaders(origin);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (url.pathname === "/api/rooms" && request.method === "POST") {
      return createRoom(env, cors);
    }
    const m = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]+)\/(info|ws|debug|reset)$/);
    if (!m) return json2({ error: "not found" }, 404, cors);
    const code = normalizeRoomCode(m[1]);
    const route = m[2];
    if (!isValidRoomCode(code)) return json2({ error: "bad room code" }, 400, cors);
    if (route === "debug" || route === "reset") {
      if (!env.ADMIN_KEY || request.headers.get("x-admin-key") !== env.ADMIN_KEY) {
        return json2({ error: "not found" }, 404, cors);
      }
      if (route === "reset" && request.method !== "POST") {
        return json2({ error: "POST required" }, 405, cors);
      }
    }
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    const forward = new URL(request.url);
    forward.pathname = `/${route}`;
    const resp = await stub.fetch(new Request(forward, request));
    if (resp.status === 101) return resp;
    return withHeaders(resp, cors);
  }
};
async function createRoom(env, cors) {
  for (let i = 0; i < CREATE_ATTEMPTS; i++) {
    const code = makeRoomCode();
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    const resp = await stub.fetch(`https://do/create?code=${code}`);
    if (resp.ok) return json2({ code }, 200, cors);
  }
  return json2({ error: "could not allocate a room code" }, 503, cors);
}
__name(createRoom, "createRoom");
function originAllowed(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) return true;
  if (!origin) return true;
  return allowed.includes(origin);
}
__name(originAllowed, "originAllowed");
function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin ?? "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-admin-key",
    "access-control-max-age": "86400",
    vary: "Origin"
  };
}
__name(corsHeaders, "corsHeaders");
function withHeaders(resp, headers) {
  const out = new Response(resp.body, resp);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}
__name(withHeaders, "withHeaders");
function json2(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}
__name(json2, "json");

// ../node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-ZAHU9f/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-ZAHU9f/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  RoomDO,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
