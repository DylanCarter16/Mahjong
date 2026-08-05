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
  const withMeld = (removed, meld) => {
    const rest = [...hand];
    for (const r of removed) rest.splice(rest.indexOf(r), 1);
    return shanten(rest, [...melds, meld]);
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

// src/engine/replay.ts
var emptyBySeat = (make) => ({ 0: make(), 1: make(), 2: make(), 3: make() });
var LIVE_WALL_AT_DEAL = 144 - 14 - 53;
function meldFromClaim(claim, tile, from) {
  if (claim === "win") return null;
  if (claim === "pung") {
    return { type: "pung", tiles: [tile, tile, tile], concealed: false, claimedFrom: from };
  }
  if (claim === "kong") {
    return {
      type: "kong",
      tiles: [tile, tile, tile, tile],
      concealed: false,
      kongStyle: "exposed",
      claimedFrom: from
    };
  }
  return { type: "chow", tiles: sortTiles([...claim.chow, tile]), concealed: false, claimedFrom: from };
}
function replayTo(log, upTo) {
  const end = Math.max(0, Math.min(upTo, log.length));
  const discards = emptyBySeat(() => []);
  const melds = emptyBySeat(() => []);
  let pending = null;
  let claims = {};
  let toAct = log[0]?.seat ?? 0;
  let holding = log[0]?.seat ?? null;
  let draws = 0;
  let won = false;
  const resolve = () => {
    if (!pending) return;
    const { tile, from, robKong } = pending;
    const order = [1, 2, 3].map((i) => (from + i) % 4);
    const winner = order.find((s) => claims[s] === "win");
    if (winner !== void 0) {
      pending = null;
      claims = {};
      toAct = winner;
      holding = winner;
      won = true;
      return;
    }
    if (robKong) {
      const pung = melds[from].find((m) => m.type === "pung" && m.tiles[0] === tile);
      if (pung) {
        pung.type = "kong";
        pung.tiles = [tile, tile, tile, tile];
        pung.kongStyle = "added";
      }
      draws++;
      pending = null;
      claims = {};
      toAct = from;
      holding = from;
      return;
    }
    const melder = order.find((s) => claims[s] === "pung" || claims[s] === "kong") ?? order.find((s) => typeof claims[s] === "object" && claims[s] !== null);
    if (melder !== void 0) {
      const m = meldFromClaim(claims[melder], tile, from);
      if (m) melds[melder].push(m);
      if (claims[melder] === "kong") draws++;
      pending = null;
      claims = {};
      toAct = melder;
      holding = melder;
      return;
    }
    discards[from].push(tile);
    pending = null;
    claims = {};
    toAct = nextSeat(from);
    holding = null;
  };
  for (let i = 0; i < end; i++) {
    const a = log[i];
    switch (a.type) {
      case "draw":
        draws++;
        toAct = a.seat;
        holding = a.seat;
        break;
      case "discard":
        pending = { tile: a.tile, from: a.seat };
        claims = {};
        toAct = nextSeat(a.seat);
        holding = null;
        break;
      case "pass":
        break;
      case "claim":
        claims[a.seat] = a.claim;
        break;
      case "kong":
        if (a.style === "concealed") {
          melds[a.seat].push({
            type: "kong",
            tiles: [a.tile, a.tile, a.tile, a.tile],
            concealed: true,
            kongStyle: "concealed"
          });
          draws++;
          toAct = a.seat;
          holding = a.seat;
        } else {
          pending = { tile: a.tile, from: a.seat, robKong: true };
          claims = {};
          holding = null;
        }
        break;
      case "declareWin":
        toAct = a.seat;
        holding = a.seat;
        won = true;
        break;
    }
    const next = log[i + 1];
    if (pending && (next === void 0 || next.type !== "pass" && next.type !== "claim")) resolve();
  }
  const handCounts = emptyBySeat(() => 13);
  for (const s of SEATS) handCounts[s] = 13 - melds[s].length * 3 + (holding === s ? 1 : 0);
  return {
    index: end,
    discards,
    melds,
    pending,
    toAct,
    draws,
    handCounts,
    holding,
    finished: won || end >= log.length
  };
}
var derivedWallCount = (board) => Math.max(0, LIVE_WALL_AT_DEAL - board.draws);
function visibleOnTable(board, kind) {
  let n = 0;
  for (const seat of SEATS) {
    n += board.discards[seat].filter((t2) => t2 === kind).length;
    for (const m of board.melds[seat]) n += m.tiles.filter((t2) => t2 === kind).length;
  }
  if (board.pending?.tile === kind) n++;
  return n;
}

// src/engine/review.ts
var WIND_NAMES2 = { E: "East", S: "South", W: "West", N: "North" };
var seatName = (input, seat) => seat === input.seat ? "you" : WIND_NAMES2[input.seatWinds[seat]];
var capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function turnAt(log, index) {
  let n = 0;
  for (let i = 0; i <= index && i < log.length; i++) if (log[i].type === "discard") n++;
  return n;
}
function windowAfter(log, index) {
  const out = [];
  for (let i = index + 1; i < log.length; i++) {
    const a = log[i];
    if (a.type !== "claim" && a.type !== "pass") break;
    out.push(a);
  }
  return out;
}
function viewFrom(input, board, snap) {
  const bonus = { 0: [], 1: [], 2: [], 3: [] };
  return {
    seat: input.seat,
    seatWind: input.seatWinds[input.seat],
    roundWind: input.roundWind,
    seatWinds: { ...input.seatWinds },
    concealed: snap ? [...snap.concealed] : [],
    handCounts: { ...board.handCounts },
    melds: board.melds,
    bonus,
    discards: board.discards,
    wallCount: snap?.wallCount ?? derivedWallCount(board),
    faanMinimum: input.faanMinimum,
    turn: board.toAct,
    phase: board.pending ? "claims" : "discard",
    pendingDiscard: board.pending ? { ...board.pending } : null,
    lastClaimed: null,
    legal: []
  };
}
var SnapshotCursor = class {
  i = 0;
  snaps;
  constructor(snapshots) {
    const bySeq = /* @__PURE__ */ new Map();
    for (const s of snapshots ?? []) if (!bySeq.has(s.seq)) bySeq.set(s.seq, s);
    this.snaps = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  }
  /** Take the next hand that fits this decision, or null. */
  take(phase, board, seat, mustHold) {
    const fits = (s) => s.phase === phase && s.concealed.length === board.handCounts[seat] && (mustHold === null || s.concealed.includes(mustHold));
    for (let j = this.i; j < Math.min(this.i + 5, this.snaps.length); j++) {
      if (fits(this.snaps[j])) {
        this.i = j + 1;
        return this.snaps[j];
      }
    }
    return null;
  }
};
function handsByDecision(log, seat, snapshots) {
  const cursor = new SnapshotCursor(snapshots);
  const out = /* @__PURE__ */ new Map();
  for (let i = 0; i < log.length; i++) {
    const a = log[i];
    if (a.seat !== seat) continue;
    if (a.type !== "discard" && a.type !== "pass" && a.type !== "claim") continue;
    const board = replayTo(log, i);
    const snap = a.type === "discard" ? cursor.take("discard", board, seat, a.tile) : cursor.take("claims", board, seat, null);
    if (snap) out.set(i, snap);
  }
  return out;
}
function riskOf(r, reads) {
  let worst = 0;
  for (const o of reads) {
    worst = Math.max(worst, (r.dangerByOpponent[o.seat] ?? 0) * (1 + o.threat) / 2);
  }
  return worst;
}
function oppNote(input, view, tile, o) {
  const name = capitalise(seatName(input, o.seat));
  const pool = view.discards[o.seat];
  if (pool.includes(tile)) {
    return `${name} had already discarded the ${tileName(tile)}, so it was dead against them.`;
  }
  const sets = o.exposedMelds;
  const setsBit = sets ? `${sets} set${sets === 1 ? "" : "s"} exposed` : "nothing exposed";
  const suit = suitOf(tile);
  if (suit) {
    const same = pool.filter((t2) => suitOf(t2) === suit).length;
    return same === 0 ? `${name} had ${setsBit} and had not discarded a single ${suitWord(suit)}.` : `${name} had ${setsBit} and ${same} ${suitWord(suit)} in their pool.`;
  }
  return `${name} had ${setsBit} and had never discarded the ${tileName(tile)}.`;
}
function gradeDiscard(input, index, tile, board, snap) {
  const view = viewFrom(input, board, snap);
  const ranked = rankDiscards(view);
  const reads = readOpponents(view);
  const loud = reads.filter((r) => r.threat >= 2);
  const mine = ranked.find((r) => r.tile === tile);
  const best = ranked[0];
  const turn = turnAt(input.log, index);
  const afterCount = visibleOnTable(replayTo(input.log, index + 1), tile);
  const dealtIn = windowAfter(input.log, index).some((a) => a.type === "claim" && a.claim === "win");
  const facts = [];
  facts.push(`You discarded the ${tileName(tile)} on turn ${turn} \u2014 ${afterCount} of 4 now visible.`);
  const noteworthy = reads.filter(
    (o) => o.threat >= 2 || o.exposedMelds >= 1 || (mine?.dangerByOpponent[o.seat] ?? 0) >= 4
  );
  for (const o of noteworthy) facts.push(oppNote(input, view, tile, o));
  facts.push(`${view.wallCount} tiles left in the wall at that point.`);
  if (!mine || !best) {
    return {
      index,
      turn,
      kind: dealtIn ? "dealIn" : "discard",
      verdict: dealtIn ? "mistake" : "fine",
      tile,
      headline: `You discarded the ${tileName(tile)}.`,
      facts,
      better: null,
      leak: dealtIn ? "dealtIn" : null,
      weight: dealtIn ? 100 : 0,
      replayable: true
    };
  }
  const risk = riskOf(mine, reads);
  const speedCost = mine.shantenAfter - best.shantenAfter;
  const equalSpeed = ranked.filter((r) => r.shantenAfter === mine.shantenAfter);
  const safest = equalSpeed.reduce((b, r) => riskOf(r, reads) < riskOf(b, reads) ? r : b, mine);
  const given = risk - riskOf(safest, reads);
  let verdict = "fine";
  let weight = 0;
  let leak = null;
  if (dealtIn) {
    verdict = "mistake";
    leak = "dealtIn";
    weight = 100 + risk;
  } else if (speedCost >= 2 || given >= 4) {
    verdict = "mistake";
    leak = speedCost >= 2 ? "slowDiscard" : loud.length > 0 ? "fedThreat" : "looseDiscard";
    weight = 55 + given * 4 + speedCost * 12;
  } else if (speedCost === 1 || given >= 2) {
    verdict = "loose";
    leak = speedCost === 1 ? "slowDiscard" : loud.length > 0 ? "fedThreat" : "looseDiscard";
    weight = 28 + given * 3 + speedCost * 6;
  } else if (loud.length > 0 && speedCost === 0 && given === 0 && risk <= 2) {
    verdict = "sharp";
    weight = 22 + loud.length * 4;
  }
  facts.push(
    `That discard left you ${shantenWord(mine.shantenAfter)} with ${mine.ukeire} useful tiles unseen.`
  );
  const danger = (r, o) => r.dangerByOpponent[o.seat] ?? 0;
  const paretoSafer = (r) => reads.every((o) => danger(r, o) <= danger(mine, o)) && reads.some((o) => danger(r, o) < danger(mine, o));
  let better = null;
  if (verdict === "mistake" || verdict === "loose") {
    const saferAlts = equalSpeed.filter((r) => r.tile !== tile && paretoSafer(r));
    const saferAlt = saferAlts.reduce(
      (b, r) => b === null || riskOf(r, reads) < riskOf(b, reads) ? r : b,
      null
    );
    const alt = saferAlt ?? (speedCost > 0 && best.tile !== tile ? best : null);
    if (alt) {
      const why = riskOf(alt, reads) === 0 ? `${tileName(alt.tile)} was dead \u2014 every opponent had already discarded it \u2014 and it left you ${shantenWord(alt.shantenAfter)} with ${alt.ukeire} useful tiles.` : alt.shantenAfter < mine.shantenAfter ? `${tileName(alt.tile)} would have left you ${shantenWord(alt.shantenAfter)} instead of ${shantenWord(mine.shantenAfter)}, with ${alt.ukeire} useful tiles against ${mine.ukeire}.` : `${tileName(alt.tile)} was safer against every opponent at the same speed, and left you ${alt.ukeire} useful tiles against ${mine.ukeire}.`;
      better = { tile: alt.tile, why };
    }
  }
  const headline = dealtIn ? `You dealt in with the ${tileName(tile)}.` : verdict === "mistake" ? speedCost >= 2 ? `The ${tileName(tile)} cost you real speed.` : `The ${tileName(tile)} was the risky one here.` : verdict === "loose" ? `The ${tileName(tile)} was looser than it needed to be.` : verdict === "sharp" ? `You kept full speed and gave nothing away with the ${tileName(tile)}.` : `You discarded the ${tileName(tile)}.`;
  return {
    index,
    turn,
    kind: dealtIn ? "dealIn" : "discard",
    verdict,
    tile,
    headline,
    facts,
    better,
    leak,
    weight,
    replayable: true
  };
}
function gradePass(input, index, board, snap) {
  const view = viewFrom(input, board, snap);
  const options = claimAnalysis(view);
  const tile = board.pending?.tile ?? null;
  if (!tile || options.length === 0) return null;
  const turn = turnAt(input.log, index);
  const win = options.find((o) => o.claim === "win");
  const helpful = options.find((o) => o.recommended);
  if (!win && !helpful) return null;
  const taken = win ?? helpful;
  const facts = [
    `${capitalise(seatName(input, board.pending.from))} discarded the ${tileName(tile)} on turn ${turn}.`,
    win ? `That tile completed your hand \u2014 it was a winning tile and you passed on it.` : `Taking the ${claimWord(taken.claim)} would have moved you from ${shantenWord(taken.shantenBefore)} to ${shantenWord(taken.shantenAfter)}.`
  ];
  return {
    index,
    turn,
    kind: "missedClaim",
    verdict: "mistake",
    tile,
    headline: win ? `You passed on the winning tile \u2014 the ${tileName(tile)}.` : `You passed on a ${claimWord(taken.claim)} that would have sped you up.`,
    facts,
    better: null,
    leak: win ? "passedWin" : "missedClaim",
    weight: win ? 95 : 40 + (taken.shantenBefore - taken.shantenAfter) * 10,
    replayable: true
  };
}
var claimWord = (c) => c === "win" ? "win" : c === "pung" ? "pung" : c === "kong" ? "kong" : "chow";
var suitWord = (s) => s === "m" ? "Characters" : s === "p" ? "Circles" : s === "s" ? "Bamboo" : s;
var shantenWord = (n) => n <= -1 ? "complete" : n === 0 ? "ready" : n === 1 ? "one away" : `${n} away`;
function scanRound(input) {
  const { log, seat } = input;
  const hands = handsByDecision(log, seat, input.snapshots);
  const moments = [];
  const degraded = [];
  for (let i = 0; i < log.length; i++) {
    const a = log[i];
    if (a.seat !== seat) continue;
    const board = replayTo(log, i);
    const turn = turnAt(log, i);
    if (a.type === "discard") {
      const snap = hands.get(i);
      if (!snap) {
        degraded.push(`turn ${turn}: no hand captured for your discard, graded on public facts only`);
        const dealtIn = windowAfter(log, i).some((x) => x.type === "claim" && x.claim === "win");
        moments.push({
          index: i,
          turn,
          kind: dealtIn ? "dealIn" : "discard",
          verdict: dealtIn ? "mistake" : "fine",
          tile: a.tile,
          headline: dealtIn ? `You dealt in with the ${tileName(a.tile)}.` : `You discarded the ${tileName(a.tile)}.`,
          facts: [
            `You discarded the ${tileName(a.tile)} on turn ${turn} \u2014 ${visibleOnTable(replayTo(log, i + 1), a.tile)} of 4 visible.`
          ],
          better: null,
          leak: dealtIn ? "dealtIn" : null,
          weight: dealtIn ? 100 : 0,
          // The public board still replays; only the hand row is missing.
          replayable: false
        });
        continue;
      }
      moments.push(gradeDiscard(input, i, a.tile, board, snap));
      continue;
    }
    if (a.type === "pass") {
      const snap = hands.get(i);
      if (!snap) continue;
      const m = gradePass(input, i, board, snap);
      if (m) moments.push(m);
      continue;
    }
    if (a.type === "claim") {
      if (a.claim === "win") {
        moments.push({
          index: i,
          turn,
          kind: "win",
          verdict: "sharp",
          tile: board.pending?.tile ?? null,
          headline: `You won on ${capitalise(seatName(input, board.pending?.from ?? seat))}'s ${board.pending ? tileName(board.pending.tile) : "discard"}.`,
          facts: [`You took the win on turn ${turn}.`],
          better: null,
          leak: null,
          weight: 50,
          replayable: true
        });
      }
      continue;
    }
    if (a.type === "declareWin") {
      moments.push({
        index: i,
        turn,
        kind: "win",
        verdict: "sharp",
        tile: null,
        headline: "You won on your own draw.",
        facts: [`Self-drawn on turn ${turn}.`],
        better: null,
        leak: null,
        weight: 50,
        replayable: true
      });
      continue;
    }
  }
  const tally = {
    discards: log.filter((a) => a.type === "discard" && a.seat === seat).length,
    sharp: moments.filter((m) => m.verdict === "sharp").length,
    loose: moments.filter((m) => m.verdict === "loose").length,
    mistakes: moments.filter((m) => m.verdict === "mistake").length,
    dealtIn: input.result.kind === "win" && input.result.loser === seat,
    missedClaims: moments.filter((m) => m.kind === "missedClaim").length
  };
  if (!input.snapshots?.length) {
    degraded.push("no hands were captured for this round \u2014 every moment is public facts only");
  }
  return {
    seat,
    moments,
    shortlist: pickShortlist(moments),
    tally,
    summary: summarise(input, tally),
    degraded
  };
}
function pickShortlist(moments, limit = 4) {
  const byWeight = [...moments].filter((m) => m.weight > 0).sort((a, b) => b.weight - a.weight);
  const chosen = [];
  const farEnough = (m) => chosen.every((c) => Math.abs(c.turn - m.turn) >= 2);
  for (const m of byWeight) {
    if (chosen.length >= limit - 1) break;
    if (farEnough(m)) chosen.push(m);
  }
  if (chosen.length < limit) {
    const sharp = byWeight.find((m) => m.verdict === "sharp" && !chosen.includes(m) && farEnough(m));
    if (sharp) chosen.push(sharp);
  }
  for (const m of byWeight) {
    if (chosen.length >= limit) break;
    if (!chosen.includes(m) && farEnough(m)) chosen.push(m);
  }
  return chosen.sort((a, b) => a.index - b.index);
}
function summarise(input, tally) {
  const { result, seat } = input;
  const bits = [];
  if (result.kind === "draw") bits.push("Wall exhausted, nobody won");
  else if (result.winner === seat) {
    bits.push(result.selfDraw ? "You self-drew" : "You won off a discard");
    if (result.fan) bits.push(`for ${result.fan.totalFaan} faan`);
  } else if (result.loser === seat) {
    bits.push(`You dealt into ${WIND_NAMES2[input.seatWinds[result.winner]]}'s hand`);
  } else {
    bits.push(`${WIND_NAMES2[input.seatWinds[result.winner]]} won`);
  }
  const counts = [];
  if (tally.sharp) counts.push(`${tally.sharp} sharp discard${tally.sharp === 1 ? "" : "s"}`);
  if (tally.loose) counts.push(`${tally.loose} loose one${tally.loose === 1 ? "" : "s"}`);
  if (tally.mistakes) counts.push(`${tally.mistakes} mistake${tally.mistakes === 1 ? "" : "s"}`);
  if (tally.missedClaims) counts.push(`${tally.missedClaims} missed claim${tally.missedClaims === 1 ? "" : "s"}`);
  const head = `${bits.join(" ")}.`;
  return counts.length ? `${head} ${counts.join(", ")} across ${tally.discards} discards.` : head;
}

// src/analysis/prompts.ts
function momentReviewPrompt(factsText, momentCount) {
  const lines = Array.from({ length: momentCount }, (_, i) => `M${i + 1}: <one or two sentences>`);
  return `You are reviewing a finished round of Hong Kong mahjong for a beginner. They are weak at defensive play and discard reading.

The engine has already found the moments that matter and computed every number below. They are facts. Do not recompute them, do not contradict them, do not add counts of your own, and do not mention moments that are not listed.

${factsText}

Answer in EXACTLY this format and nothing else:

SUMMARY: <one sentence on how the round went, 25 words maximum>
${lines.join("\n")}

For each moment, explain why it mattered and the habit to carry forward \u2014 not what happened, which the player can already see. 40 words maximum per moment. Encouraging but honest; do not praise a mistake. No preamble, no headings, no bullet points, no markdown.`;
}
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
var WINDS2 = /* @__PURE__ */ new Set(["E", "S", "W", "N"]);
var SEATS2 = [0, 1, 2, 3];
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
function handSnapshot(x) {
  if (!isObj(x)) return null;
  if (typeof x.seq !== "number" || !Number.isInteger(x.seq) || x.seq < 0 || x.seq > 1e5) return null;
  if (x.phase !== "discard" && x.phase !== "claims") return null;
  const concealed = tileArray(x.concealed, 14);
  if (!concealed) return null;
  if (typeof x.wallCount !== "number" || x.wallCount < 0 || x.wallCount > 130) return null;
  return { seq: x.seq, phase: x.phase, concealed, wallCount: Math.floor(x.wallCount) };
}
function reviewScan(x) {
  if (x === void 0 || x === null) return null;
  if (!isObj(x)) return void 0;
  if (!isSeat(x.seat) || !isWind(x.roundWind)) return void 0;
  const seatWinds = seatRecord(x.seatWinds, (v) => isWind(v) ? v : null);
  if (!seatWinds) return void 0;
  if (x.faanMinimum !== 0 && x.faanMinimum !== 1 && x.faanMinimum !== 3) return void 0;
  if (!Array.isArray(x.snapshots) || x.snapshots.length > 300) return void 0;
  const snapshots = [];
  for (const raw of x.snapshots) {
    const s = handSnapshot(raw);
    if (!s) return void 0;
    snapshots.push(s);
  }
  return { seat: x.seat, roundWind: x.roundWind, seatWinds, faanMinimum: x.faanMinimum, snapshots };
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
  const scan = reviewScan(x.scan);
  if (scan === void 0) return null;
  return scan === null ? { log, result } : { log, result, scan };
}

// api/_lib/buildPrompts.ts
var PLAIN_PROSE = ' Write plain prose only \u2014 no Markdown or formatting syntax of any kind (no asterisks, underscores, backticks, headings, or bullet lists). Always name tiles in plain English ("West Wind", "White Dragon", "9 of Characters") and never use internal codes like wW, dW, or m9.';
var COACH_SYSTEM = "You are a concise, friendly Hong Kong mahjong coach for a beginner. You are given exact engine-computed facts about the position. Never recompute or contradict the numbers \u2014 narrate them. Follow the requested output format exactly." + PLAIN_PROSE;
var REVIEW_SYSTEM = "You are a Hong Kong mahjong teacher reviewing a finished round for a beginner. Be concrete and reference specific turns. Follow the requested output format exactly." + PLAIN_PROSE;
function reviewFacts(scan) {
  const lines = [`ROUND (engine): ${scan.summary}`, "", "MOMENTS (engine-graded):"];
  scan.shortlist.forEach((m, i) => {
    lines.push(`M${i + 1} [${m.verdict}] turn ${m.turn}: ${m.headline}`);
    for (const f of m.facts) lines.push(`  - ${f}`);
    if (m.better) lines.push(`  - The better discard was the ${tileName(m.better.tile)}. ${m.better.why}`);
  });
  return lines.join("\n");
}
function buildReviewPrompt(body) {
  const payload = validateReview(body);
  if (!payload) return null;
  if (payload.scan && payload.result) {
    const scan = scanRound({
      seat: payload.scan.seat,
      log: payload.log,
      result: payload.result,
      roundWind: payload.scan.roundWind,
      seatWinds: payload.scan.seatWinds,
      faanMinimum: payload.scan.faanMinimum,
      snapshots: payload.scan.snapshots
    });
    if (scan.shortlist.length > 0) {
      return {
        system: REVIEW_SYSTEM,
        prompt: momentReviewPrompt(reviewFacts(scan), scan.shortlist.length),
        // The shortlist goes back with the answer so the panel renders the same
        // moments the model was asked about, in the same order. `weight` is
        // shortlisting bookkeeping and stays here.
        meta: {
          review: {
            summary: scan.summary,
            tally: scan.tally,
            degraded: scan.degraded,
            moments: scan.shortlist.map(({ weight: _weight, ...m }) => m)
          }
        }
      };
    }
  }
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
      ...opts.thinking ? { thinking: opts.thinking } : {},
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
  const blockTypes = /* @__PURE__ */ new Set();
  let stopReason = null;
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
      if (ev.type === "content_block_start" && ev.content_block?.type) {
        blockTypes.add(ev.content_block.type);
      }
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
        opts.onDelta(ev.delta.text);
        emitted = true;
      }
      if (ev.type === "message_delta" && ev.delta?.stop_reason) {
        stopReason = ev.delta.stop_reason;
        if (ev.delta.stop_reason === "refusal") refusal = true;
      }
      if (ev.type === "error") return { ok: false, error: ev.error?.message ?? "upstream stream error" };
    }
  }
  if (refusal && !emitted) return { ok: false, error: "refusal", refusal: true, noText: { blockTypes: [...blockTypes], stopReason } };
  if (!emitted) {
    return {
      ok: false,
      error: `the model returned no text (blocks: ${[...blockTypes].join(", ") || "none"}; stop_reason: ${stopReason ?? "none"})`,
      noText: { blockTypes: [...blockTypes], stopReason }
    };
  }
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
        ...cfg.thinking ? { thinking: cfg.thinking } : {},
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
      res.status(200).json({ ...built.meta ?? {}, text: full, model: outcome.model });
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
  timeoutMs: UPSTREAM_TIMEOUT_MS,
  // THE review bug. `claude-sonnet-5` runs ADAPTIVE THINKING when `thinking` is
  // omitted, and max_tokens caps thinking + text together — so all 700 tokens
  // went to reasoning over a full action log and the response contained no text
  // block at all. Every single time, at normal latency, which is exactly what
  // "empty answer, deterministic" looks like from the outside.
  //
  // Off, not bigger: this call narrates engine-computed facts into three
  // numbered points in 180 words. The system prompt already forbids
  // recomputation, so reasoning budget buys nothing here and costs latency on a
  // request the player is waiting on. If you ever want it on, raise maxTokens
  // well clear of the visible-output budget first — thinking eats the same cap.
  thinking: { type: "disabled" }
});
export {
  review_default as default,
  maxDuration
};
