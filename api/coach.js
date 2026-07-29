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
function t(id) {
  if (!VALID.has(id)) throw new Error(`Unknown tile id: ${id}`);
  return id;
}
function sortTiles(tiles) {
  return [...tiles].sort((a, b) => ORDER.get(a) - ORDER.get(b));
}
var isSuit = (id) => id[0] === "m" || id[0] === "p" || id[0] === "s";
var isHonour = (id) => id[0] === "w" || id[0] === "d";
var suitOf = (id) => isSuit(id) ? id[0] : null;
var rankOf = (id) => isSuit(id) ? Number(id[1]) : null;
var WIND_NAMES = { E: "East", S: "South", W: "West", N: "North" };
var DRAGON_NAMES = { R: "Red", G: "Green", W: "White" };
var SUIT_NAMES = { m: "Characters", p: "Circles", s: "Bamboo" };
var FLOWER_NAMES = ["Plum", "Orchid", "Bamboo", "Chrysanthemum"];
var SEASON_NAMES = ["Spring", "Summer", "Autumn", "Winter"];
function tileName(id) {
  t(id);
  if (isSuit(id)) return `${rankOf(id)} of ${SUIT_NAMES[suitOf(id)]}`;
  if (id[0] === "w") return `${WIND_NAMES[id[1]]} Wind`;
  if (id[0] === "d") return `${DRAGON_NAMES[id[1]]} Dragon`;
  const idx = Number(id[2]);
  return id[1] === "f" ? `Flower ${idx} (${FLOWER_NAMES[idx - 1]})` : `Season ${idx} (${SEASON_NAMES[idx - 1]})`;
}

// src/engine/types.ts
var SEATS = [0, 1, 2, 3];
var nextSeat = (s) => (s + 1) % 4;

// src/engine/shanten.ts
var suitCache = /* @__PURE__ */ new Map();
function suitOptions(counts) {
  const key = counts.join("");
  const hit = suitCache.get(key);
  if (hit) return hit;
  const found = /* @__PURE__ */ new Set();
  const out = [];
  const record = (s, p, q) => {
    const k = `${s},${p},${q}`;
    if (!found.has(k)) {
      found.add(k);
      out.push([s, p, q]);
    }
  };
  const dfs = (r, s, p, q) => {
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
  };
  dfs(1, 0, 0, 0);
  suitCache.set(key, out);
  return out;
}
function honourOptions(count) {
  const out = [[0, 0, 0]];
  if (count >= 3) out.push([1, 0, 0]);
  if (count >= 2) out.push([0, 1, 0], [0, 0, 1]);
  return out;
}
function standardShanten(concealed, meldCount) {
  const suitCounts = {
    m: new Array(10).fill(0),
    p: new Array(10).fill(0),
    s: new Array(10).fill(0)
  };
  const honourCounts = /* @__PURE__ */ new Map();
  for (const t2 of concealed) {
    if (isSuit(t2)) suitCounts[suitOf(t2)][rankOf(t2)]++;
    else honourCounts.set(t2, (honourCounts.get(t2) ?? 0) + 1);
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
function sevenPairsShanten(concealed) {
  const counts = /* @__PURE__ */ new Map();
  for (const t2 of concealed) counts.set(t2, (counts.get(t2) ?? 0) + 1);
  let pairs = 0;
  for (const c of counts.values()) if (c >= 2) pairs++;
  const kinds = counts.size;
  return 6 - pairs + Math.max(0, 7 - kinds);
}
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
  for (const t2 of concealed) counts.set(t2, (counts.get(t2) ?? 0) + 1);
  let kinds = 0;
  let hasPair = false;
  for (const o of ORPHANS) {
    const c = counts.get(o) ?? 0;
    if (c >= 1) kinds++;
    if (c >= 2) hasPair = true;
  }
  return 13 - kinds - (hasPair ? 1 : 0);
}
function shanten(concealed, melds) {
  let best = standardShanten(concealed, melds.length);
  if (melds.length === 0) {
    best = Math.min(best, sevenPairsShanten(concealed), thirteenOrphansShanten(concealed));
  }
  return best;
}
function usefulTiles(concealed, melds) {
  const base = shanten(concealed, melds);
  if (base === -1) return [];
  const inHand = /* @__PURE__ */ new Map();
  for (const t2 of concealed) inHand.set(t2, (inHand.get(t2) ?? 0) + 1);
  const useful = [];
  for (const kind of ALL_PLAY_KINDS) {
    if ((inHand.get(kind) ?? 0) >= 4) continue;
    if (shanten([...concealed, kind], melds) < base) useful.push(kind);
  }
  return useful;
}

// src/engine/bots.ts
function copiesInHand(hand, tile) {
  return hand.filter((t2) => t2 === tile).length;
}
function visibleCopies(view, kind) {
  let n = copiesInHand(view.concealed, kind);
  for (const seat of SEATS) {
    n += view.discards[seat].filter((t2) => t2 === kind).length;
    for (const m of view.melds[seat]) n += m.tiles.filter((t2) => t2 === kind).length;
  }
  if (view.pendingDiscard?.tile === kind) n++;
  return n;
}
function dangerScore(view, tile, opp) {
  const oppDiscards = view.discards[opp];
  if (oppDiscards.includes(tile)) return 0;
  if (isHonour(tile)) return visibleCopies(view, tile) >= 3 ? 1 : 4;
  const suit = suitOf(tile);
  const r = rankOf(tile);
  const sameSuit = oppDiscards.filter((t2) => suitOf(t2) === suit);
  if (sameSuit.some((t2) => Math.abs(rankOf(t2) - r) <= 1)) return 2;
  if (sameSuit.length >= 3) return 3;
  return 5 + (r >= 4 && r <= 6 ? 1 : 0);
}

// src/engine/win.ts
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
  for (const t2 of tiles) h.set(t2, (h.get(t2) ?? 0) + 1);
  return h;
}
function meldToDecompSet(m) {
  return { type: m.type, tiles: [...m.tiles], concealed: m.concealed, fromMeld: true };
}
var nextInSuit = (id, step) => {
  if (!isSuit(id)) return null;
  const r = rankOf(id) + step;
  return r >= 1 && r <= 9 ? `${id[0]}${r}` : null;
};
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
function sevenPairsDecomposition(concealed, melds) {
  if (melds.length > 0 || concealed.length !== 14) return null;
  const hist = histogram(concealed);
  if (hist.size !== 7) return null;
  for (const c of hist.values()) if (c !== 2) return null;
  const pairs = sortTiles([...hist.keys()]).map((k) => [k, k]);
  return { shape: "sevenPairs", pairs };
}
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
function decompose(concealed, melds) {
  const out = standardDecompositions(concealed, melds);
  const sp = sevenPairsDecomposition(concealed, melds);
  if (sp) out.push(sp);
  const to = thirteenOrphansDecomposition(concealed, melds);
  if (to) out.push(to);
  return out;
}
function isWinningHand(concealed, melds) {
  return decompose(concealed, melds).length > 0;
}

// src/engine/analysis.ts
function visibleCopies2(view, restHand, kind, discarded) {
  let n = restHand.filter((t2) => t2 === kind).length + (kind === discarded ? 1 : 0);
  for (const seat of SEATS) {
    n += view.discards[seat].filter((t2) => t2 === kind).length;
    for (const m of view.melds[seat]) n += m.tiles.filter((t2) => t2 === kind).length;
  }
  if (view.pendingDiscard?.tile === kind) n++;
  return n;
}
function rankDiscards(view) {
  const melds = view.melds[view.seat];
  const out = [];
  for (const tile of new Set(view.concealed)) {
    const rest = [...view.concealed];
    rest.splice(rest.indexOf(tile), 1);
    const advancing = usefulTiles(rest, melds);
    const ukeire = advancing.reduce(
      (n, k) => n + Math.max(0, 4 - visibleCopies2(view, rest, k, tile)),
      0
    );
    const dangerByOpponent = {};
    for (const opp of SEATS) {
      if (opp !== view.seat) dangerByOpponent[opp] = dangerScore(view, tile, opp);
    }
    out.push({ tile, shantenAfter: shanten(rest, melds), ukeire, advancing, dangerByOpponent });
  }
  out.sort((a, b) => a.shantenAfter - b.shantenAfter || b.ukeire - a.ukeire);
  return out;
}
function claimAnalysis(view) {
  const pd = view.pendingDiscard;
  if (!pd || pd.from === view.seat) return [];
  const tile = pd.tile;
  const hand = view.concealed;
  const melds = view.melds[view.seat];
  const before = shanten(hand, melds);
  const copies = hand.filter((t2) => t2 === tile).length;
  const out = [];
  const withMeld = (removed, meld2) => {
    const rest = [...hand];
    for (const r of removed) rest.splice(rest.indexOf(r), 1);
    return shanten(rest, [...melds, meld2]);
  };
  if (isWinningHand([...hand, tile], melds)) {
    out.push({ claim: "win", shantenBefore: before, shantenAfter: -1, recommended: true });
  }
  if (copies >= 2) {
    const after = withMeld([tile, tile], { type: "pung", tiles: [tile, tile, tile], concealed: false });
    out.push({ claim: "pung", shantenBefore: before, shantenAfter: after, recommended: after < before });
  }
  if (copies >= 3) {
    const after = withMeld([tile, tile, tile], {
      type: "kong",
      tiles: [tile, tile, tile, tile],
      concealed: false,
      kongStyle: "exposed"
    });
    out.push({ claim: "kong", shantenBefore: before, shantenAfter: after, recommended: after < before });
  }
  if (view.seat === nextSeat(pd.from) && isSuit(tile)) {
    const r = rankOf(tile);
    const suit = tile[0];
    const has = (n) => n >= 1 && n <= 9 && hand.includes(`${suit}${n}`);
    for (const [a, b] of [
      [r - 2, r - 1],
      [r - 1, r + 1],
      [r + 1, r + 2]
    ]) {
      if (!has(a) || !has(b)) continue;
      const pieces = [`${suit}${a}`, `${suit}${b}`];
      const after = withMeld(pieces, {
        type: "chow",
        tiles: sortTiles([...pieces, tile]),
        concealed: false
      });
      out.push({ claim: { chow: pieces }, shantenBefore: before, shantenAfter: after, recommended: after < before });
    }
  }
  out.sort((a, b) => a.shantenAfter - b.shantenAfter);
  return out;
}
var SUITS2 = ["m", "p", "s"];
function readOpponents(view) {
  const out = [];
  for (const seat of SEATS) {
    if (seat === view.seat) continue;
    const discards = view.discards[seat];
    const suitDiscards = { m: 0, p: 0, s: 0 };
    for (const t2 of discards) {
      const s = suitOf(t2);
      if (s) suitDiscards[s]++;
    }
    const evidence = suitDiscards.m + suitDiscards.p + suitDiscards.s;
    const minCount = Math.min(...SUITS2.map((s) => suitDiscards[s]));
    const likelyCollecting = evidence >= 4 ? SUITS2.filter((s) => suitDiscards[s] <= Math.max(1, minCount)) : [];
    const exposedMelds = view.melds[seat].filter((m) => !m.concealed).length;
    const threat = exposedMelds < 2 ? 0 : 1 + (discards.length < 10 ? 1 : 0) + (view.wallCount < 30 ? 1 : 0);
    const safeTiles = [...new Set(discards)].filter((t2) => dangerScore(view, t2, seat) === 0);
    out.push({ seat, suitDiscards, likelyCollecting, threat, safeTiles, exposedMelds });
  }
  return out;
}

// api/_lib/validate.ts
var TILE_IDS = /* @__PURE__ */ new Set([...ALL_PLAY_KINDS, ...BONUS_KINDS]);
var WINDS2 = /* @__PURE__ */ new Set(["E", "S", "W", "N"]);
var SEATS2 = [0, 1, 2, 3];
var PHASES = /* @__PURE__ */ new Set(["discard", "draw", "claims", "finished"]);
var MELD_TYPES = /* @__PURE__ */ new Set(["chow", "pung", "kong"]);
var isObj = (x) => typeof x === "object" && x !== null && !Array.isArray(x);
var isTile = (x) => typeof x === "string" && TILE_IDS.has(x);
var isSeat = (x) => x === 0 || x === 1 || x === 2 || x === 3;
var isWind = (x) => typeof x === "string" && WINDS2.has(x);
function tileArray(x, max) {
  if (!Array.isArray(x) || x.length > max || !x.every(isTile)) return null;
  return [...x];
}
function seatRecord(x, each) {
  if (!isObj(x)) return null;
  const out = {};
  for (const s of SEATS2) {
    const v = each(x[String(s)]);
    if (v === null) return null;
    out[s] = v;
  }
  return out;
}
function meld(x) {
  if (!isObj(x)) return null;
  if (typeof x.type !== "string" || !MELD_TYPES.has(x.type)) return null;
  const tiles = tileArray(x.tiles, 4);
  if (tiles === null) return null;
  if (typeof x.concealed !== "boolean") return null;
  const m = { type: x.type, tiles, concealed: x.concealed };
  if (x.kongStyle !== void 0) {
    if (x.kongStyle !== "concealed" && x.kongStyle !== "exposed" && x.kongStyle !== "added") return null;
    m.kongStyle = x.kongStyle;
  }
  if (x.claimedFrom !== void 0) {
    if (!isSeat(x.claimedFrom)) return null;
    m.claimedFrom = x.claimedFrom;
  }
  return m;
}
function validatePlayerView(x) {
  if (!isObj(x)) return null;
  if (!isSeat(x.seat) || !isWind(x.seatWind) || !isWind(x.roundWind)) return null;
  const seatWinds = seatRecord(x.seatWinds, (v) => isWind(v) ? v : null);
  const concealed = tileArray(x.concealed, 14);
  const handCounts = seatRecord(
    x.handCounts,
    (v) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 14 ? v : null
  );
  const melds = seatRecord(x.melds, (v) => {
    if (!Array.isArray(v) || v.length > 4) return null;
    const ms = [];
    for (const raw of v) {
      const m = meld(raw);
      if (!m) return null;
      ms.push(m);
    }
    return ms;
  });
  const bonus = seatRecord(x.bonus, (v) => tileArray(v, 8));
  const discards = seatRecord(x.discards, (v) => tileArray(v, 40));
  if (!seatWinds || !concealed || !handCounts || !melds || !bonus || !discards) return null;
  if (typeof x.wallCount !== "number" || x.wallCount < 0 || x.wallCount > 130) return null;
  if (x.faanMinimum !== 0 && x.faanMinimum !== 1 && x.faanMinimum !== 3) return null;
  if (!isSeat(x.turn) || typeof x.phase !== "string" || !PHASES.has(x.phase)) return null;
  let pendingDiscard = null;
  if (x.pendingDiscard !== null && x.pendingDiscard !== void 0) {
    if (!isObj(x.pendingDiscard) || !isTile(x.pendingDiscard.tile) || !isSeat(x.pendingDiscard.from)) return null;
    pendingDiscard = { tile: x.pendingDiscard.tile, from: x.pendingDiscard.from };
  }
  const lastClaimed = isTile(x.lastClaimed) ? x.lastClaimed : null;
  return {
    seat: x.seat,
    seatWind: x.seatWind,
    roundWind: x.roundWind,
    seatWinds,
    concealed,
    handCounts,
    melds,
    bonus,
    discards,
    wallCount: Math.floor(x.wallCount),
    faanMinimum: x.faanMinimum,
    turn: x.turn,
    phase: x.phase,
    pendingDiscard,
    lastClaimed,
    legal: []
    // never trusted from the client; prompts don't use it
  };
}

// api/_lib/buildPrompts.ts
var PLAIN_PROSE = ' Write plain prose only \u2014 no Markdown or formatting syntax of any kind (no asterisks, underscores, backticks, headings, or bullet lists). Always name tiles in plain English ("West Wind", "White Dragon", "9 of Characters") and never use internal codes like wW, dW, or m9.';
var COACH_SYSTEM = "You are a concise, friendly Hong Kong mahjong coach for a beginner. You are given exact engine-computed facts about the position. Never recompute or contradict the numbers \u2014 narrate them. Follow the requested output format exactly." + PLAIN_PROSE;
var REVIEW_SYSTEM = "You are a Hong Kong mahjong teacher reviewing a finished round for a beginner. Be concrete and reference specific turns. Follow the requested output format exactly." + PLAIN_PROSE;
var SEAT_LABELS = ["ME", "South", "West", "North"];
function dangerWord(score) {
  if (score === 0) return "SAFE (in their discards)";
  if (score <= 2) return "fairly safe";
  if (score <= 4) return "uncertain";
  return "DANGEROUS";
}
function coachFacts(view) {
  const melds = view.melds[view.seat];
  const ranked = rankDiscards(view).slice(0, 7);
  const reads = readOpponents(view);
  const topThreat = reads.reduce((a, b) => b.threat > a.threat ? b : a);
  const lines = [
    `notation: m=characters, p=circles, s=bamboo, w=winds, d=dragons`,
    `My hand: ${view.concealed.join(" ")}${melds.length ? ` | my melds: ${melds.map((m) => m.tiles.join("")).join(" ")}` : ""}`,
    `Current shanten: ${shanten(view.concealed, melds)} (0 = one tile from winning)`,
    `Discard options, ranked by the engine (DO NOT recompute):`,
    ...ranked.map((r) => {
      const danger = topThreat.threat >= 2 ? `, vs ${SEAT_LABELS[topThreat.seat]}: ${dangerWord(r.dangerByOpponent[topThreat.seat] ?? 5)}` : "";
      const waits = r.advancing.length > 0 ? ` (waits: ${r.advancing.join(" ")})` : "";
      return `  ${r.tile} -> shanten ${r.shantenAfter}, ${r.ukeire} live tiles advance${waits}${danger}`;
    }),
    `Round wind: ${view.roundWind}. My seat wind: ${view.seatWind}. Faan minimum: ${view.faanMinimum}. Wall tiles left: ${view.wallCount}.`
  ];
  for (const o of reads) {
    const suits = `discards ${o.suitDiscards.m} characters / ${o.suitDiscards.p} circles / ${o.suitDiscards.s} bamboo`;
    const collecting = o.likelyCollecting.length > 0 && o.likelyCollecting.length < 3 ? `, likely collecting ${o.likelyCollecting.map((s) => ({ m: "characters", p: "circles", s: "bamboo" })[s]).join("/")}` : "";
    lines.push(
      `${SEAT_LABELS[o.seat]}: ${o.exposedMelds} exposed melds, threat ${o.threat}/3, ${suits}${collecting}.`
    );
  }
  return lines.join("\n");
}
function claimWords(claim) {
  if (claim === "win") return "win off the discard";
  if (claim === "pung") return "pung (three of a kind)";
  if (claim === "kong") return "kong (four of a kind)";
  return `chow using ${claim.chow.map(tileName).join(" + ")}`;
}
function claimFacts(view, options) {
  const pd = view.pendingDiscard;
  const myMelds = view.melds[view.seat];
  const concealed = myMelds.every((m) => m.concealed);
  const reads = readOpponents(view);
  const topThreat = reads.reduce((a, b) => b.threat > a.threat ? b : a);
  return [
    `notation: m=characters, p=circles, s=bamboo, w=winds, d=dragons`,
    `My hand: ${view.concealed.join(" ")}${myMelds.length ? ` | my melds: ${myMelds.map((m) => m.tiles.join("")).join(" ")}` : ""}`,
    `${SEAT_LABELS[pd.from]} just discarded ${tileName(pd.tile)} and I may claim it.`,
    `Current shanten: ${options[0].shantenBefore} (0 = one tile from winning)`,
    `Claim options, computed by the engine (DO NOT recompute):`,
    ...options.map(
      (o) => `  ${claimWords(o.claim)} -> shanten ${o.shantenAfter === -1 ? "-1 (an immediate win)" : o.shantenAfter}${o.shantenAfter < o.shantenBefore ? " (closer to ready)" : o.shantenAfter === o.shantenBefore ? " (no progress)" : " (further from ready)"}`
    ),
    `Cost of claiming: the set is exposed for everyone to see.${concealed ? " My hand is fully concealed right now, so claiming gives that up." : " I already have an exposed set."}`,
    `Round wind: ${view.roundWind}. My seat wind: ${view.seatWind}. Faan minimum: ${view.faanMinimum}. Wall tiles left: ${view.wallCount}.`,
    `Most threatening opponent: ${SEAT_LABELS[topThreat.seat]}, threat ${topThreat.threat}/3, ${topThreat.exposedMelds} exposed melds.`
  ].join("\n");
}
function buildCoachPrompt(body) {
  if (typeof body !== "object" || body === null) return null;
  const view = validatePlayerView(body.view);
  if (!view) return null;
  if (view.phase === "claims" && view.pendingDiscard) {
    const options = claimAnalysis(view);
    if (options.length > 0) {
      return {
        system: COACH_SYSTEM,
        prompt: `${claimFacts(view, options)}

In 60 words or fewer: say whether to claim and which claim to take (or to pass), using the engine's shanten numbers, and name the one thing it costs me. No preamble, no recomputation.`
      };
    }
  }
  const pending = view.pendingDiscard ? `
Note: ${SEAT_LABELS[view.pendingDiscard.from]} just discarded ${tileName(view.pendingDiscard.tile)} and it is claimable.` : "";
  return {
    system: COACH_SYSTEM,
    prompt: `${coachFacts(view)}${pending}

In 60 words or fewer: name the best discard and why (use the engine ranking), then ONE defensive note about the most threatening opponent. No preamble, no recomputation.`
  };
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
      const t2 = now();
      let w = windows.get(key);
      if (!w) {
        w = { minuteStart: t2, minuteCount: 0, dayStart: t2, dayCount: 0 };
        windows.set(key, w);
      }
      if (t2 - w.minuteStart >= 6e4) {
        w.minuteStart = t2;
        w.minuteCount = 0;
      }
      if (t2 - w.dayStart >= 864e5) {
        w.dayStart = t2;
        w.dayCount = 0;
      }
      if (w.dayCount >= perDay) return Math.ceil((w.dayStart + 864e5 - t2) / 1e3);
      if (w.minuteCount >= perMinute) return Math.ceil((w.minuteStart + 6e4 - t2) / 1e3);
      w.minuteCount++;
      w.dayCount++;
      if (windows.size > 5e3) {
        for (const [k, v] of windows) if (t2 - v.dayStart >= 864e5) windows.delete(k);
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

// api/_src/coach.ts
var maxDuration = 60;
var UPSTREAM_TIMEOUT_MS = 18e3;
var coach_default = createHandler({
  buildPrompt: buildCoachPrompt,
  model: "claude-haiku-4-5-20251001",
  fallbackModel: "claude-sonnet-5",
  maxTokens: 500,
  timeoutMs: UPSTREAM_TIMEOUT_MS
});
export {
  coach_default as default,
  maxDuration
};
