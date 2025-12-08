import React, { useEffect, useMemo, useRef, useState } from "react";

import deckData from "./grixis-tinker-vintage.json";
import spellFlexOptions from "./spell-flex-options.json";
import landFlexOptions from "./land-flex-options.json";
import sideboardFlexOptions from "./sideboard-flex-options.json";
import cardBlurbs from "./card-blurbs.json";

import "./VintageDeckGrid.css";

/*
  Goals of this cleanup:
  - Fix actual broken React/JS (there were syntax errors in setNewCardInput).
  - Remove "made up" mana sources / land names and incorrect card rules assumptions.
  - Make mulligan evaluation closer to how Vintage hands actually function:
    we try to find a plausible T1 line (play mana, deploy a payoff, cast a cantrip/tutor, etc.).

  This is still a heuristic tool — not a full MTG rules engine — but it should stop saying
  obviously-wrong things (e.g. pretending you have Underground Sea / fetchlands, or that
  Trinket Mage costs UU1).
*/

/* ----------------------------- Small utilities ---------------------------- */

const uniqId = (() => {
  let n = 0;
  return () => `${Date.now()}-${++n}`;
})();

const isLand = (card) => (card?.typeLine || "").toLowerCase().includes("land");
const isArtifact = (card) => (card?.typeLine || "").toLowerCase().includes("artifact");

const getCardColor = (manaCost, typeLine) => {
  const type = (typeLine || "").toLowerCase();
  if (type.includes("land")) return "land";
  if (!manaCost) return "colorless";

  const hasWhite = /\{W\}/.test(manaCost);
  const hasBlue = /\{U\}/.test(manaCost);
  const hasBlack = /\{B\}/.test(manaCost);
  const hasRed = /\{R\}/.test(manaCost);
  const hasGreen = /\{G\}/.test(manaCost);

  const colorCount =
    (hasWhite ? 1 : 0) +
    (hasBlue ? 1 : 0) +
    (hasBlack ? 1 : 0) +
    (hasRed ? 1 : 0) +
    (hasGreen ? 1 : 0);

  if (colorCount > 1) return "multicolor";
  if (hasWhite) return "white";
  if (hasBlue) return "blue";
  if (hasBlack) return "black";
  if (hasRed) return "red";
  if (hasGreen) return "green";
  return "colorless";
};

const parseCmc = (manaCost) => {
  if (!manaCost) return 0;
  const symbols = manaCost.match(/\{([^}]+)\}/g);
  if (!symbols) return 0;

  let total = 0;
  for (const sym of symbols) {
    const content = sym.slice(1, -1);

    if (/^\d+$/.test(content)) {
      total += parseInt(content, 10);
      continue;
    }

    // Hybrid / phyrexian: {U/P}, {2/W}, etc.
    if (content.includes("/")) {
      const [a] = content.split("/");
      total += a === "2" ? 2 : 1;
      continue;
    }

    // X/Y/Z treated as 0 for MV display.
    if (content === "X" || content === "Y" || content === "Z") {
      total += 0;
      continue;
    }

    // {C} counts as 1; colored symbols count as 1.
    total += 1;
  }

  return total;
};

const normalizeManaInput = (raw) => {
  const s = (raw || "").trim();
  if (!s) return "";

  // If user already typed { } style, leave it.
  if (s.includes("{")) return s;

  // Convert "10UU" -> "{10}{U}{U}"; "1U" -> "{1}{U}"; "WW" -> "{W}{W}".
  const out = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\d/.test(ch)) {
      let j = i;
      while (j < s.length && /\d/.test(s[j])) j++;
      out.push(`{${s.slice(i, j)}}`);
      i = j;
      continue;
    }
    const up = ch.toUpperCase();
    if (/[WUBRGXC]/.test(up)) {
      out.push(`{${up}}`);
      i++;
      continue;
    }
    // Ignore unknown characters (spaces, etc.)
    i++;
  }
  return out.join("");
};

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/* --------------------------- Deck/grid helpers --------------------------- */

// Expand aggregated entries into individual card copies (for sideboard & shuffling)
const expandSlots = (config, zone) => {
  const slots = [];
  config.forEach((entry, entryIndex) => {
    const { card, count = 1, locked, flexOptions } = entry;
    for (let copyIndex = 0; copyIndex < count; copyIndex++) {
      slots.push({ zone, entryIndex, copyIndex, locked, flexOptions, card });
    }
  });
  return slots;
};

// Group mainboard into MTGO-style columns: Lands, then CMC 0, 1, 2, ...
const buildCmcColumns = (mainConfig) => {
  const cols = new Map();

  mainConfig.forEach((entry, entryIndex) => {
    const { card, count = 1, locked, flexOptions } = entry;
    const land = isLand(card);
    const cmc = land ? -1 : parseCmc(card.manaCost);
    const key = land ? "lands" : `cmc-${cmc}`;

    if (!cols.has(key)) {
      cols.set(key, {
        key,
        label: land ? "LANDS" : `CMC ${cmc}`,
        order: land ? -1 : cmc,
        items: []
      });
    }

    const col = cols.get(key);
    for (let i = 0; i < count; i++) {
      col.items.push({ zone: "main", entryIndex, copyIndex: i, locked, flexOptions, card });
    }
  });

  const result = Array.from(cols.values()).sort((a, b) => a.order - b.order);
  result.forEach((col) => col.items.sort((a, b) => a.card.name.localeCompare(b.card.name)));
  return result;
};

// Build mobile list layout: spells sorted by CMC, then lands
const buildMobileList = (config, zone = "main") => {
  const items = config.map((entry, entryIndex) => {
    const land = isLand(entry.card);
    return {
      zone,
      entryIndex,
      locked: entry.locked,
      flexOptions: entry.flexOptions,
      card: entry.card,
      count: entry.count || 1,
      cmc: land ? 999 : parseCmc(entry.card.manaCost),
      isLand: land
    };
  });

  items.sort((a, b) => (a.cmc !== b.cmc ? a.cmc - b.cmc : a.card.name.localeCompare(b.card.name)));
  return items;
};

const buildDeckIndex = (deck) => {
  const main = new Map();
  const side = new Map();

  for (const e of deck?.mainboard || []) {
    main.set(e.card.name, { ...e, count: e.count || 1 });
  }
  for (const e of deck?.sideboard || []) {
    side.set(e.card.name, { ...e, count: e.count || 1 });
  }

  return {
    hasInMain: (name) => main.has(name),
    hasInSide: (name) => side.has(name),
    mainEntries: () => Array.from(main.values()),
    sideEntries: () => Array.from(side.values())
  };
};

/* ---------------------------- MTG-ish engine ----------------------------- */

// We track a *mana pool* with:
// - WUBRG: colored
// - C: strictly colorless (for {C} requirements)
// - flex: "any color" mana (can pay colored or generic, but NOT {C})
const emptyPool = () => ({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, flex: 0 });

const addPool = (p, add) => ({
  W: p.W + (add.W || 0),
  U: p.U + (add.U || 0),
  B: p.B + (add.B || 0),
  R: p.R + (add.R || 0),
  G: p.G + (add.G || 0),
  C: p.C + (add.C || 0),
  flex: p.flex + (add.flex || 0)
});

const sumMana = (p) => p.W + p.U + p.B + p.R + p.G + p.C + p.flex;

const parseManaCostReq = (manaCost) => {
  const req = { generic: 0, W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  if (!manaCost) return req;

  const symbols = manaCost.match(/\{([^}]+)\}/g);
  if (!symbols) return req;

  for (const sym of symbols) {
    const c = sym.slice(1, -1);
    if (/^\d+$/.test(c)) {
      req.generic += parseInt(c, 10);
      continue;
    }
    if (c === "X" || c === "Y" || c === "Z") continue;
    if (c === "C") {
      req.C += 1;
      continue;
    }
    if (c.includes("/")) {
      // Pay 1 for hybrid/phyrexian in heuristic engine.
      req.generic += 1;
      continue;
    }
    if (c === "W") req.W += 1;
    else if (c === "U") req.U += 1;
    else if (c === "B") req.B += 1;
    else if (c === "R") req.R += 1;
    else if (c === "G") req.G += 1;
    else req.generic += 1;
  }

  return req;
};

const canPay = (pool, manaCost) => {
  const req = parseManaCostReq(manaCost);

  // Copy pool so we can "spend" while checking.
  const p = { ...pool };

  // 1) Pay strict colorless {C} ONLY from C.
  if (p.C < req.C) return false;
  p.C -= req.C;

  // 2) Pay colored requirements from matching colors, then flex.
  for (const col of ["W", "U", "B", "R", "G"]) {
    const need = req[col];
    if (!need) continue;
    const fromCol = Math.min(p[col], need);
    p[col] -= fromCol;
    const remain = need - fromCol;
    if (remain > 0) {
      if (p.flex < remain) return false;
      p.flex -= remain;
    }
  }

  // 3) Pay generic from everything remaining.
  const availableGeneric = p.W + p.U + p.B + p.R + p.G + p.flex + p.C;
  return availableGeneric >= req.generic;
};

const pay = (pool, manaCost) => {
  const req = parseManaCostReq(manaCost);
  const p = { ...pool };

  // {C}
  p.C -= req.C;

  // colored
  for (const col of ["W", "U", "B", "R", "G"]) {
    const need = req[col];
    if (!need) continue;
    const fromCol = Math.min(p[col], need);
    p[col] -= fromCol;
    const remain = need - fromCol;
    if (remain > 0) p.flex -= remain;
  }

  // generic: spend in a deterministic order (C first, then flex, then colors)
  let g = req.generic;

  const take = (k) => {
    const n = Math.min(p[k], g);
    p[k] -= n;
    g -= n;
  };

  take("C");
  take("flex");
  take("W");
  take("U");
  take("B");
  take("R");
  take("G");

  return p;
};

// Mana abilities for THIS deck's lands/mana rocks.
const landAbilityKinds = {
  ANY_COLOR_LIFE: "any_color_life",
  COLORLESS: "colorless",
  ACADEMY: "academy"
};

const getLandKind = (name) => {
  if (name === "Tolarian Academy") return landAbilityKinds.ACADEMY;
  if (name === "City of Brass") return landAbilityKinds.ANY_COLOR_LIFE;
  if (name === "Mana Confluence") return landAbilityKinds.ANY_COLOR_LIFE;
  if (name === "Starting Town") return "starting_town";
  // Strip Mine / Urza's Saga (and most utility lands in this list)
  return landAbilityKinds.COLORLESS;
};

const manaPermanentKind = (name) => {
  if (name.startsWith("Mox ")) return "mox";
  if (name === "Mox Opal") return "opal";
  if (name === "Mana Crypt") return "crypt";
  if (name === "Sol Ring") return "ring";
  if (name === "Mana Vault") return "vault";
  return null;
};

const getMoxColor = (name) => {
  if (name === "Mox Pearl") return "W";
  if (name === "Mox Sapphire") return "U";
  if (name === "Mox Jet") return "B";
  if (name === "Mox Ruby") return "R";
  if (name === "Mox Emerald") return "G";
  return null;
};

const isOneShotMana = (name) => name === "Black Lotus" || name === "Lotus Petal";

const oneShotYield = (name) => {
  if (name === "Black Lotus") return 3;
  if (name === "Lotus Petal") return 1;
  return 0;
};

const IMPORTANT_CASTS = new Set([
  // Mana development
  "Sol Ring",
  "Mana Vault",
  "Sensei's Divining Top",
  "Vexing Bauble",
  "Voltaic Key",
  "Manifold Key",
  "Time Vault",
  "Crop Rotation",

  // Payoffs / engines
  "Tinker",
  "Karn, the Great Creator",
  "Narset, Parter of Veils",
  "Trinisphere",
  "Paradoxical Outcome",
  "Tezzeret the Seeker",
  "Tezzeret, Cruel Captain",
  "Trinket Mage",
  "Balance",
  "Timetwister",

  // Selection / tutors
  "Ancestral Recall",
  "Brainstorm",
  "Ponder",
  "Mystical Tutor",
  "Vampiric Tutor",
  "Demonic Tutor",
]);

const INTERACTION = new Set([
  "Force of Will",
  "Force of Negation",
  "Flusterstorm",
  "Mental Misstep",
  "Pyroblast",
  "Veil of Summer",
  "Cabal Therapy"
]);

const isSelectionSpell = (name) =>
  new Set([
    "Ancestral Recall",
    "Brainstorm",
    "Ponder",
    "Gitaxian Probe",
    "Mystical Tutor",
    "Vampiric Tutor",
    "Demonic Tutor",
    "Sensei's Divining Top",
    "Paradoxical Outcome"
  ]).has(name);

const isPayoff = (name) =>
  new Set([
    "Tinker",
    "Karn, the Great Creator",
    "Narset, Parter of Veils",
    "Trinisphere",
    "Time Vault",
    "Tezzeret the Seeker",
    "Tezzeret, Cruel Captain",
    "Paradoxical Outcome"
  ]).has(name);

// Extremely small "T1 action search".
// We don't try to model the stack or every possible play — just enough sequencing to avoid obvious nonsense.
const simulateTurn1 = ({ hand, deckIndex }) => {
  const initialHand = hand.map((c) => ({ ...c }));

  // Pre-play all 0-mana artifacts (they're never worse to have as artifacts-in-play; lotus/petal can stay uncracked).
  const battlefieldBase = [];
  const remainingHandBase = [];
  for (const c of initialHand) {
    const cmc = isLand(c) ? null : parseCmc(c.manaCost);
    if (isArtifact(c) && cmc === 0) {
      battlefieldBase.push({ ...c, _id: uniqId(), tapped: false, zone: "battlefield" });
    } else {
      remainingHandBase.push({ ...c });
    }
  }

  const landsInHand = remainingHandBase.filter(isLand);
  const nonLandsBase = remainingHandBase.filter((c) => !isLand(c));

  const landChoices = landsInHand.length ? landsInHand : [null];

  const best = {
    score: -Infinity,
    tier: 0,
    notes: [],
    final: null
  };

  const scoreState = (state) => {
    const names = new Set(state.battlefield.map((c) => c.name));
    const handNames = new Set(state.hand.map((c) => c.name));
    const poolTotal = sumMana(state.pool);

    const hasVault = names.has("Time Vault");
    const hasKey = names.has("Voltaic Key") || names.has("Manifold Key");
    const hasTezzCruel = names.has("Tezzeret, Cruel Captain");
    const hasTezzSeeker = names.has("Tezzeret the Seeker");

    // "Virtual win" detectors.
    // - Vault + (Key) means infinite turns once you can pay {1} each turn.
    // - Vault + Tezz (either) means free untap each turn.
    // - Tinker to Blightsteel is treated as a win line.
    const infiniteTurns =
      hasVault && (hasTezzCruel || hasTezzSeeker || (hasKey && (poolTotal >= 1 || hasTezzSeeker)));

    const tinkerWin = state.notes.some((n) => n.includes("Tinker → Blightsteel"));

    // Trinket Mage + Time Vault combo (both in hand, not on battlefield)
    // Trinket Mage (3) → fetch Key, cast Key (1), cast Vault (2), activate (1) = 7 mana total
    const trinketVaultWin = 
      handNames.has("Trinket Mage") && 
      handNames.has("Time Vault") && 
      !names.has("Trinket Mage") &&
      !names.has("Time Vault") &&
      poolTotal >= 7;

    // Demonic Tutor + Time Vault combo (both in hand, not on battlefield)
    // Demonic Tutor (1B) → fetch Key, cast Key (1), cast Vault (2), activate (1) = 5 mana + B
    const demonicVaultWin = 
      handNames.has("Demonic Tutor") && 
      handNames.has("Time Vault") && 
      !names.has("Time Vault") &&
      !handNames.has("Voltaic Key") &&
      !handNames.has("Manifold Key") &&
      poolTotal >= 5 &&
      state.pool.B >= 1; // Need at least 1 black for Demonic Tutor

    // Vault + Key combo with Demonic Tutor for Force backup
    // Have Vault + Key + Demonic + blue card, tutor for Force, cast combo with protection
    // Need: 2 for Vault, 1 for Key, 1 for activate, 1B for Demonic = 5 mana + B
    const vaultKeyForceBackup = 
      (handNames.has("Time Vault") || names.has("Time Vault")) &&
      (handNames.has("Voltaic Key") || handNames.has("Manifold Key") || 
       names.has("Voltaic Key") || names.has("Manifold Key")) &&
      handNames.has("Demonic Tutor") &&
      !handNames.has("Force of Will") &&
      state.hand.some(c => {
        const cost = c.manaCost || "";
        return cost.includes("{U}") && c.name !== "Demonic Tutor";
      }) &&
      poolTotal >= 5 &&
      state.pool.B >= 1;

    // Trinket Mage for Vexing Bauble (strong T1 lock piece)
    // Trinket Mage (UU1 = 3) → fetch Bauble, cast Bauble (1) = 4 mana + UU
    const trinketBauble = 
      handNames.has("Trinket Mage") && 
      !names.has("Trinket Mage") &&
      !names.has("Vexing Bauble") &&
      !handNames.has("Vexing Bauble") &&
      poolTotal >= 4 &&
      state.pool.U >= 1; // Need at least 1 blue for Trinket Mage

    // Tezzeret Cruel Captain for Vexing Bauble (strong T1 lock piece)
    // Tezzeret (3 any color) → tutor 0-1 cost artifact (Bauble), cast Bauble (1) = 4 mana
    const tezzBauble = 
      handNames.has("Tezzeret, Cruel Captain") && 
      !names.has("Tezzeret, Cruel Captain") &&
      !names.has("Vexing Bauble") &&
      !handNames.has("Vexing Bauble") &&
      poolTotal >= 4;

    // Tezzeret the Seeker + Time Walk combo
    // Cast Tezz (UU3 = 5), +1 to untap 2 artifacts, use them for Time Walk (1U), take extra turn, ult Tezz (-5)
    // Artifacts become 5/5s and swing for lethal (need ~4 artifacts for 20 damage)
    // Need: UU3 for Tezz, 2 artifacts that can make 1U, Time Walk in hand, 4+ artifacts total
    const tezzTimeWalkWin = 
      (handNames.has("Tezzeret the Seeker") || names.has("Tezzeret the Seeker")) &&
      handNames.has("Time Walk") &&
      state.pool.U >= 2 &&
      poolTotal >= 5 &&
      state.battlefield.filter(c => isArtifact(c)).length >= 4 &&
      // Check if we have 2+ artifacts that can produce mana
      state.battlefield.filter(c => {
        if (!isArtifact(c)) return false;
        const kind = manaPermanentKind(c.name);
        return kind === "mox" || kind === "crypt" || kind === "ring" || kind === "vault" || kind === "opal";
      }).length >= 2;

    // Balance combo: cast 4+ cards, then Balance to force opponent discard
    // Balance costs 1W, equalizes hands/creatures/lands
    // Cast count includes tutors/spells that don't leave permanents
    const balanceCombo = 
      handNames.has("Balance") &&
      state.cast.length >= 4 &&
      state.hand.length <= 3 && // 2 cards left after Balance is cast
      poolTotal >= 2 &&
      state.pool.W >= 1;

    // "Big T1" plays.
    const big =
      names.has("Karn, the Great Creator") ||
      names.has("Narset, Parter of Veils") ||
      names.has("Tezzeret, Cruel Captain") || // Tutors for 0-1 cost artifacts
      names.has("Trinisphere") ||
      names.has("Vexing Bauble") || // Lock piece like Trinisphere
      state.cast.includes("Paradoxical Outcome") || // PO is instant, check cast history
      names.has("Timetwister") ||
      balanceCombo ||
      trinketBauble ||
      tezzBauble;

    // Casting any selection/tutor is usually enough to call the hand functional.
    const castSelection = state.cast.some((n) => isSelectionSpell(n));

    // Holding up instant-speed Ancestral Recall with Force of Will backup is extremely strong
    // Better than tapping out for tutors - you get 3 cards at instant speed with protection
    // Force can be cast for free (pitch blue card) so tapping out doesn't matter
    const ancestralWithForce = 
      handNames.has("Ancestral Recall") &&
      handNames.has("Force of Will") &&
      poolTotal >= 1 &&
      state.pool.U >= 1;

    // Instant-speed tutor (Mystical/Vampiric) + Tinker setup
    // Can tutor EOT for Tinker, draw it, cast it next turn
    // Need: instant tutor in hand, 3+ artifacts for Tinker, enough mana for tutor + Tinker (U + 2U = 3U or U + 1B)
    const tutorForTinker = 
      (handNames.has("Mystical Tutor") || handNames.has("Vampiric Tutor")) &&
      !handNames.has("Tinker") &&
      state.battlefield.filter(c => isArtifact(c)).length >= 3 && // Need artifacts to sac for Tinker
      ((handNames.has("Mystical Tutor") && state.pool.U >= 1 && poolTotal >= 4) || // Mystical (U) + Tinker (2U) = 3U total
       (handNames.has("Vampiric Tutor") && state.pool.B >= 1 && poolTotal >= 3)); // Vampiric (B) + Tinker (2U) = B + 2U

    // Basic stability: have a land or at least 2 permanent mana sources in play.
    const permanentMana = state.battlefield.filter((c) => {
      if (!isArtifact(c) && !isLand(c)) return false;
      const k = manaPermanentKind(c.name);
      return (
        !!k ||
        isLand(c) ||
        isOneShotMana(c.name) // lotus/petal are in play even if not cracked yet
      );
    }).length;

    // A very simple scoring.
    let score = 0;
    if (infiniteTurns || tinkerWin || trinketVaultWin || demonicVaultWin || vaultKeyForceBackup || tezzTimeWalkWin) score += 1000;
    if (big) score += 200;
    if (ancestralWithForce) score += 150; // Higher than castSelection
    if (tutorForTinker) score += 120; // Strong setup for next turn win
    if (castSelection) score += 60;
    score += Math.min(60, poolTotal * 10);
    score += Math.min(30, permanentMana * 4);

    const tier = infiniteTurns || tinkerWin || trinketVaultWin || demonicVaultWin || vaultKeyForceBackup || tezzTimeWalkWin ? 3 : big ? 2 : castSelection || poolTotal >= 2 ? 1 : 0;

    return { score, tier, flags: { infiniteTurns, tinkerWin, trinketVaultWin, demonicVaultWin, vaultKeyForceBackup, tezzTimeWalkWin, big, castSelection } };
  };

  const describePool = (p) => {
    const parts = [];
    for (const k of ["W", "U", "B", "R", "G", "C"]) {
      if (p[k]) parts.push(`${p[k]}${k}`);
    }
    if (p.flex) parts.push(`${p.flex}flex`);
    return parts.length ? parts.join(" ") : "0";
  };

  const getArtifactsCount = (battlefield) => battlefield.filter((c) => isArtifact(c)).length;

  const untappedManaPermanents = (state) => {
    const artifactsCount = getArtifactsCount(state.battlefield);

    const sources = [];

    for (const perm of state.battlefield) {
      if (perm.tapped) continue;

      // Lands
      if (isLand(perm)) {
        const kind = getLandKind(perm.name);
        if (kind === landAbilityKinds.ACADEMY) {
          // Tolarian Academy taps for U per artifact you control.
          sources.push({
            id: perm._id,
            label: "Tap Tolarian Academy",
            run: (s) => {
              const n = getArtifactsCount(s.battlefield);
              const next = { ...s };
              next.pool = addPool(next.pool, { U: n });
              next.battlefield = next.battlefield.map((c) => (c._id === perm._id ? { ...c, tapped: true } : c));
              next.notes = [...next.notes, `Tap Academy for ${n}U (artifacts: ${n})`];
              return next;
            }
          });
          continue;
        }

        if (perm.name === "Starting Town") {
          // Either {C} or (pay 1 life) any color.
          sources.push({
            id: perm._id + ":C",
            label: "Tap Starting Town for C",
            run: (s) => {
              const next = { ...s };
              next.pool = addPool(next.pool, { C: 1 });
              next.battlefield = next.battlefield.map((c) => (c._id === perm._id ? { ...c, tapped: true } : c));
              next.notes = [...next.notes, `Tap Starting Town for C`];
              return next;
            }
          });
          sources.push({
            id: perm._id + ":flex",
            label: "Tap Starting Town (pay 1 life) for any color",
            run: (s) => {
              const next = { ...s };
              next.pool = addPool(next.pool, { flex: 1 });
              next.battlefield = next.battlefield.map((c) => (c._id === perm._id ? { ...c, tapped: true } : c));
              next.notes = [...next.notes, `Tap Starting Town for any color (pay 1 life)`];
              return next;
            }
          });
          continue;
        }

        // City / Confluence (any color, pay life), or colorless utility land.
        if (kind === landAbilityKinds.ANY_COLOR_LIFE) {
          sources.push({
            id: perm._id,
            label: `Tap ${perm.name} (pay 1 life) for any color`,
            run: (s) => {
              const next = { ...s };
              next.pool = addPool(next.pool, { flex: 1 });
              next.battlefield = next.battlefield.map((c) => (c._id === perm._id ? { ...c, tapped: true } : c));
              next.notes = [...next.notes, `Tap ${perm.name} for any color (pay 1 life)`];
              return next;
            }
          });
        } else {
          sources.push({
            id: perm._id,
            label: `Tap ${perm.name} for C`,
            run: (s) => {
              const next = { ...s };
              next.pool = addPool(next.pool, { C: 1 });
              next.battlefield = next.battlefield.map((c) => (c._id === perm._id ? { ...c, tapped: true } : c));
              next.notes = [...next.notes, `Tap ${perm.name} for C`];
              return next;
            }
          });
        }

        continue;
      }

      // One-shot mana in play (lotus/petal) — treat as "crack".
      if (isOneShotMana(perm.name)) {
        const n = oneShotYield(perm.name);
        sources.push({
          id: perm._id,
          label: `Sac ${perm.name} for ${n} mana (any colors)`,
          run: (s) => {
            const next = { ...s };
            next.pool = addPool(next.pool, { flex: n });
            next.battlefield = next.battlefield.filter((c) => c._id !== perm._id);
            next.notes = [...next.notes, `Sac ${perm.name} for ${n} mana`];
            return next;
          }
        });
        continue;
      }

      // Mana artifacts
      const mk = manaPermanentKind(perm.name);
      if (!mk) continue;

      if (mk === "mox") {
        const col = getMoxColor(perm.name);
        if (!col) continue;
        sources.push({
          id: perm._id,
          label: `Tap ${perm.name} for ${col}`,
          run: (s) => {
            const next = { ...s };
            next.pool = addPool(next.pool, { [col]: 1 });
            next.battlefield = next.battlefield.map((c) => (c._id === perm._id ? { ...c, tapped: true } : c));
            next.notes = [...next.notes, `Tap ${perm.name} for ${col}`];
            return next;
          }
        });
        continue;
      }

      if (mk === "opal") {
        // Requires metalcraft (3+ artifacts).
        if (artifactsCount < 3) continue;
        sources.push({
          id: perm._id,
          label: "Tap Mox Opal for any color (metalcraft)",
          run: (s) => {
            const next = { ...s };
            next.pool = addPool(next.pool, { flex: 1 });
            next.battlefield = next.battlefield.map((c) => (c._id === perm._id ? { ...c, tapped: true } : c));
            next.notes = [...next.notes, `Tap Mox Opal for any color (metalcraft)`];
            return next;
          }
        });
        continue;
      }

      if (mk === "crypt") {
        sources.push({
          id: perm._id,
          label: "Tap Mana Crypt for CC",
          run: (s) => {
            const next = { ...s };
            next.pool = addPool(next.pool, { C: 2 });
            next.battlefield = next.battlefield.map((c) => (c._id === perm._id ? { ...c, tapped: true } : c));
            next.notes = [...next.notes, "Tap Mana Crypt for CC"]; 
            return next;
          }
        });
        continue;
      }

      if (mk === "ring") {
        sources.push({
          id: perm._id,
          label: "Tap Sol Ring for CC",
          run: (s) => {
            const next = { ...s };
            next.pool = addPool(next.pool, { C: 2 });
            next.battlefield = next.battlefield.map((c) => (c._id === perm._id ? { ...c, tapped: true } : c));
            next.notes = [...next.notes, "Tap Sol Ring for CC"]; 
            return next;
          }
        });
        continue;
      }

      if (mk === "vault") {
        sources.push({
          id: perm._id,
          label: "Tap Mana Vault for CCC",
          run: (s) => {
            const next = { ...s };
            next.pool = addPool(next.pool, { C: 3 });
            next.battlefield = next.battlefield.map((c) => (c._id === perm._id ? { ...c, tapped: true } : c));
            next.notes = [...next.notes, "Tap Mana Vault for CCC"]; 
            return next;
          }
        });
        continue;
      }
    }

    return sources;
  };

  const castableCards = (state) => {
    // Special: Gitaxian Probe can be played for 0 via Phyrexian mana.
    const forcedFree = new Set(["Gitaxian Probe", "Mental Misstep"]);

    return state.hand
      .filter((c) => IMPORTANT_CASTS.has(c.name))
      .filter((c) => {
        if (parseCmc(c.manaCost) === 0 && isArtifact(c)) return true;
        if (forcedFree.has(c.name)) return true;
        return canPay(state.pool, c.manaCost);
      })
      .map((c) => ({
        card: c,
        label: `Cast ${c.name}`,
        run: (s) => {
          const next = { ...s };

          // Handle free-phyrexian cases as "no mana".
          const spendMana = !forcedFree.has(c.name);
          if (spendMana && parseCmc(c.manaCost) > 0) {
            next.pool = pay(next.pool, c.manaCost);
          }

          // Move to battlefield if permanent; otherwise to "cast" log.
          next.hand = next.hand.filter((x) => x !== c);
          next.cast = [...next.cast, c.name];

          if (isLand(c)) {
            // shouldn't happen here
            return next;
          }

          if (isArtifact(c) || (c.typeLine || "").toLowerCase().includes("planeswalker")) {
            next.battlefield = [...next.battlefield, { ...c, _id: uniqId(), tapped: false, zone: "battlefield" }];
          }

          next.notes = [...next.notes, `Cast ${c.name}`];

          // Very lightweight "resolved spell" effects:
          // - Paradoxical Outcome: bounce all artifacts, return them to hand, replay 0-cost ones
          if (c.name === "Paradoxical Outcome") {
            const artifactsToBounce = next.battlefield.filter((p) => isArtifact(p));
            const bouncedCount = artifactsToBounce.length;
            
            if (bouncedCount > 0) {
              // Return artifacts to hand
              next.battlefield = next.battlefield.filter((p) => !isArtifact(p));
              next.hand = [...next.hand, ...artifactsToBounce.map(p => ({ name: p.name, typeLine: p.typeLine, manaCost: p.manaCost }))];
              
              // Replay 0-cost artifacts immediately
              const zeroCosters = next.hand.filter((h) => isArtifact(h) && parseCmc(h.manaCost) === 0);
              if (zeroCosters.length > 0) {
                next.hand = next.hand.filter((h) => !zeroCosters.includes(h));
                next.battlefield = [
                  ...next.battlefield,
                  ...zeroCosters.map(z => ({ ...z, _id: uniqId(), tapped: false, zone: "battlefield" }))
                ];
              }
              
              next.notes = [...next.notes, `PO → bounce ${bouncedCount} artifacts, draw ${bouncedCount}, replay ${zeroCosters.length} free artifacts`];
            }
          }

          // - Crop Rotation: sacrifice a land to fetch Tolarian Academy (if artifacts in play)
          if (c.name === "Crop Rotation") {
            const hasLandToSac = next.battlefield.some((p) => isLand(p));
            const artifactsCount = next.battlefield.filter((p) => isArtifact(p)).length;
            
            if (hasLandToSac && artifactsCount >= 2 && deckIndex.hasInMain("Tolarian Academy")) {
              // Sacrifice a land (remove first land found)
              const landToSac = next.battlefield.find((p) => isLand(p));
              next.battlefield = next.battlefield.filter((p) => p._id !== landToSac._id);
              
              // Fetch Tolarian Academy into play untapped
              next.battlefield = [
                ...next.battlefield,
                { name: "Tolarian Academy", typeLine: "Land", _id: uniqId(), tapped: false, zone: "battlefield" }
              ];
              
              next.notes = [...next.notes, `Crop Rotation → sacrifice ${landToSac.name}, fetch Tolarian Academy (${artifactsCount} artifacts)`];
            }
          }

          // - If we cast Tinker and deck has Blightsteel in main (and not in hand), mark it.
          if (c.name === "Tinker") {
            const hasSacArtifact = next.battlefield.some((p) => isArtifact(p) && p.name !== "Blightsteel Colossus");
            const blightsteelInHand = next.hand.some((h) => h.name === "Blightsteel Colossus");
            
            // Check for Vault+Key combo pieces
            const hasVaultInHand = next.hand.some((h) => h.name === "Time Vault");
            const hasKeyInHand = next.hand.some((h) => h.name === "Voltaic Key" || h.name === "Manifold Key");
            
            if (hasSacArtifact && deckIndex.hasInMain("Blightsteel Colossus") && !blightsteelInHand) {
              next.notes = [...next.notes, "Tinker → Blightsteel Colossus (artifact to sacrifice assumed)"];
            }
            
            // Tinker for Time Vault if we have Key in hand + enough mana (1 to activate Key)
            // Tinker puts Vault into play for free, no need to cast it
            if (hasSacArtifact && hasKeyInHand && !hasVaultInHand && deckIndex.hasInMain("Time Vault")) {
              // After Tinker resolves, Vault is in play. Need 1 mana to activate Key.
              const manaAfterTinker = { ...next.mana };
              if (canPay(manaAfterTinker, { C: 2 })) {
                next.notes = [...next.notes, "Tinker → Time Vault (into play), activate Key combo (infinite turns)"];
              }
            }
            
            // Tinker for Key if we have Vault in hand (need to cast Vault for 2, then activate Key for 1)
            if (hasSacArtifact && hasVaultInHand && !hasKeyInHand) {
              const hasVoltaicInDeck = deckIndex.hasInMain("Voltaic Key");
              const hasManifoldInDeck = deckIndex.hasInMain("Manifold Key");
              if (hasVoltaicInDeck || hasManifoldInDeck) {
                // After Tinker, Key is in play. Still need to cast Vault (2) + activate Key (1) = 3 mana
                const manaAfterTinker = { ...next.mana };
                if (canPay(manaAfterTinker, { C: 3 })) {
                  const keyName = hasVoltaicInDeck ? "Voltaic Key" : "Manifold Key";
                  next.notes = [...next.notes, `Tinker → ${keyName} (into play), cast Vault, activate combo (infinite turns)`];
                }
              }
            }
          }

          return next;
        }
      }));
  };

  const dfs = (state, depth, seen) => {
    const key = JSON.stringify({
      land: state.landName,
      hand: state.hand.map((c) => c.name).sort(),
      bf: state.battlefield.map((c) => `${c.name}:${c.tapped ? 1 : 0}`).sort(),
      pool: state.pool
    });

    if (seen.has(key)) return;
    seen.add(key);

    const scored = scoreState(state);
    if (scored.score > best.score || (scored.score === best.score && scored.tier > best.tier)) {
      best.score = scored.score;
      best.tier = scored.tier;
      best.notes = state.notes;
      best.final = state;
    }

    if (depth >= 18) return;

    // Prefer casting before tapping everything (but include both).
    const actions = [...castableCards(state), ...untappedManaPermanents(state)];

    // Small prune: if nothing left, stop.
    if (!actions.length) return;

    for (const a of actions) {
      dfs(a.run(state), depth + 1, seen);
    }
  };

  for (const land of landChoices) {
    // start state
    const bf = [...battlefieldBase];
    const handAfterLandPick = nonLandsBase.slice();

    if (land) {
      // move chosen land to battlefield
      bf.push({ ...land, _id: uniqId(), tapped: false, zone: "battlefield" });
    }

    const start = {
      hand: handAfterLandPick,
      battlefield: bf,
      pool: emptyPool(),
      landName: land?.name || null,
      cast: [],
      notes: [
        `Start (0-cost artifacts played: ${battlefieldBase.map((c) => c.name).join(", ") || "none"})`,
        land ? `Play land: ${land.name}` : "No land in hand"
      ]
    };

    dfs(start, 0, new Set());
  }

  return {
    tier: best.tier,
    bestLine: best.notes,
    final: best.final
  };
};

// Final mulligan advice wrapper: produces reasons + a keep/mull recommendation.
const analyzeMulligan = ({ hand, deckIndex }) => {
  const names = hand.map((c) => c.name);
  const lands = hand.filter(isLand).length;
  const interaction = hand.filter((c) => INTERACTION.has(c.name)).length;
  const selection = hand.filter((c) => isSelectionSpell(c.name)).length;
  const payoff = hand.filter((c) => isPayoff(c.name)).length;

  const sim = simulateTurn1({ hand, deckIndex });

  const reasons = [];

  if (sim.tier === 3) {
    reasons.push("🏆 Virtual win / hard lock line found (or Tinker→Blightsteel). Keep.");
  } else if (sim.tier === 2) {
    reasons.push("✅ Strong T1 line found (payoff/lock/draw engine). Keep.");
  } else if (sim.tier === 1) {
    reasons.push("✅ Functional T1 line found (mana + selection / development). Usually keep.");
  } else {
    reasons.push("⚠️ No coherent T1 line found in this hand.");
  }

  // Basic sanity checks.
  if (lands === 0) reasons.push("⚠️ 0 lands (needs real action from fast mana + selection).");
  if (lands >= 5) reasons.push(`⚠️ ${lands} lands (flood risk).`);
  if (selection === 0) reasons.push("⚠️ No card selection/tutors in opener.");
  if (payoff === 0) reasons.push("⚠️ No payoff/pressure piece in opener (may still be fine if selection is strong).");
  if (interaction >= 1) reasons.push(`✅ Interaction present (${interaction}).`);

  // Decision.
  // - Tier 3/2: always keep.
  // - Tier 1: keep unless it is extremely mana-awkward.
  // - Tier 0: mull unless you have 2+ lands and interaction (fair keep).
  let decision = "MULLIGAN";
  if (sim.tier >= 2) decision = "KEEP";
  else if (sim.tier === 1) {
    if (lands >= 1 || selection >= 2) decision = "KEEP";
  } else {
    // Tier 0: even with no coherent line, keep if you have lands + interaction + selection
    // OR if you have 3+ fast mana + payoff + selection (0-land special case)
    const fastMana = hand.filter((c) => {
      const cmc = parseCmc(c.manaCost);
      return isArtifact(c) && (cmc === 0 || cmc === 1) && manaPermanentKind(c.name);
    }).length;
    
    if (lands >= 2 && interaction >= 1 && selection >= 1) decision = "KEEP";
    else if (fastMana >= 3 && payoff >= 1 && selection >= 1) decision = "KEEP"; // 0-land keep
  }

  // Expose a short, readable line summary.
  const lineSummary = (sim.bestLine || []).slice(0, 12);

  return {
    decision,
    reasons,
    line: lineSummary,
    stats: { lands, interaction, selection, payoff, tier: sim.tier }
  };
};

/* ------------------------------- UI pieces ------------------------------- */

const CardCell = ({ slot, stacked = false, compact = false, onClick, onHover }) => {
  const isFlex =
    !slot.locked &&
    slot.flexOptions &&
    slot.flexOptions.length > 0 &&
    typeof onClick === "function";

  const cardColor = getCardColor(slot.card.manaCost, slot.card.typeLine);
  const title = `${slot.card.name} • ${slot.card.typeLine}`;

  const hoverTimer = useRef(null);
  const [hovered, setHovered] = useState(false);

  const handleMouseEnter = () => {
    if (!onHover) return;
    hoverTimer.current = window.setTimeout(() => {
      setHovered(true);
      onHover(slot.card);
    }, 650);
  };

  const handleMouseLeave = () => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setHovered(false);
    onHover?.(null);
  };

  return (
    <div
      className={[
        "card-slot",
        stacked ? "card-slot--stacked" : "",
        compact ? "card-slot--compact" : "",
        isFlex ? "card-slot--flex" : "card-slot--core",
        `card-slot--${cardColor}`,
        hovered ? "card-slot--hovered" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={isFlex ? onClick : undefined}
      title={title}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={hovered ? { zIndex: 100, transform: "scale(1.15)" } : undefined}
    >
      <div className="card-slot__header">
        <div className="card-slot__name">{slot.card.name}</div>
        <div className="card-slot__mana">{slot.card.manaCost || "\u00a0"}</div>
      </div>
      <div className="card-slot__type">{slot.card.typeLine}</div>
      {isFlex && !stacked && <div className="card-slot__badge">FLEX</div>}
    </div>
  );
};

const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => {
      const mobile =
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
        window.innerWidth <= 768;
      setIsMobile(mobile);
    };

    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return isMobile;
};

const FlexModal = ({ selectedFlex, mainConfig, sideConfig, onClose, onChoose, onAddCard }) => {
  const isMobile = useIsMobile();
  if (!selectedFlex) return null;

  const { zone, entryIndex } = selectedFlex;
  const entry = zone === "main" ? mainConfig[entryIndex] : sideConfig[entryIndex];
  if (!entry) return null;

  const { card, flexOptions = [] } = entry;
  const [searchTerm, setSearchTerm] = useState("");
  const [newCardName, setNewCardName] = useState("");
  const [newCardCost, setNewCardCost] = useState("");
  const [newCardType, setNewCardType] = useState("");

  const filtered = flexOptions.filter((opt) => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;
    return (
      opt.name.toLowerCase().includes(q) ||
      (opt.manaCost || "").toLowerCase().includes(q) ||
      (opt.typeLine || "").toLowerCase().includes(q)
    );
  });

  const flexColumns = useMemo(() => {
    const cols = new Map();

    const add = (c, index, isCurrent) => {
      const land = isLand(c);
      const cmc = land ? -1 : parseCmc(c.manaCost);
      const key = land ? "lands" : `cmc-${cmc}`;
      if (!cols.has(key)) {
        cols.set(key, {
          key,
          label: land ? "LANDS" : `CMC ${cmc}`,
          order: land ? -1 : cmc,
          items: []
        });
      }
      cols.get(key).items.push({ card: c, index, isCurrent });
    };

    add(card, -1, true);
    filtered.forEach((opt, idx) => add(opt, idx, false));

    const result = Array.from(cols.values()).sort((a, b) => a.order - b.order);
    result.forEach((col) => col.items.sort((a, b) => a.card.name.localeCompare(b.card.name)));
    return result;
  }, [card, filtered]);

  const mobileList = useMemo(() => {
    const list = [{ card, index: -1, isCurrent: true, cmc: isLand(card) ? 999 : parseCmc(card.manaCost) }];
    filtered.forEach((opt, idx) =>
      list.push({
        card: opt,
        index: idx,
        isCurrent: false,
        cmc: isLand(opt) ? 999 : parseCmc(opt.manaCost)
      })
    );
    list.sort((a, b) => (a.cmc !== b.cmc ? a.cmc - b.cmc : a.card.name.localeCompare(b.card.name)));
    return list;
  }, [card, filtered]);

  const handleAddCard = () => {
    if (!newCardName.trim()) return;
    onAddCard({
      name: newCardName.trim(),
      manaCost: normalizeManaInput(newCardCost),
      typeLine: newCardType.trim()
    });
    setNewCardName("");
    setNewCardCost("");
    setNewCardType("");
  };

  return (
    <div className="flex-modal-backdrop" onClick={onClose}>
      <div
        className="flex-modal flex-modal--large"
        onClick={(e) => e.stopPropagation()}
        style={{ background: "rgba(246, 242, 242, 0.1)", backdropFilter: "blur(5px)" }}
      >
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            background: "rgba(59, 130, 246, 0.1)",
            borderRadius: 8,
            border: "2px solid #3b82f6"
          }}
        >
          <h3 style={{ margin: "0 0 8px 0", fontSize: "0.9rem", color: "#1e40af" }}>
            Replacing this card:
          </h3>
          <div style={{ display: "inline-block", width: 144 }}>
            <div style={{ transform: "scale(0.9)", transformOrigin: "top left" }}>
              <CardCell slot={{ card, locked: false, flexOptions: [] }} stacked={false} compact={false} />
            </div>
          </div>
        </div>

        <h3 style={{ margin: "0 0 4px 0", fontSize: "1rem" }}>Choose a replacement</h3>
        <p className="muted" style={{ fontSize: "0.85rem", marginBottom: 8 }}>
          Click any card below to swap it in
        </p>

        <input
          type="text"
          placeholder="Search cards..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            width: "100%",
            padding: 8,
            marginBottom: 12,
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            fontSize: "0.85rem",
            boxSizing: "border-box"
          }}
        />

        <div style={{ maxHeight: 500, overflowY: "auto", marginBottom: 12, padding: 8 }}>
          {isMobile ? (
            <div className="mobile-list">
              {mobileList.map((item, idx) => (
                <div
                  key={`mobile-flex-${idx}`}
                  className="mobile-list-item"
                  onClick={() => item.index >= 0 && onChoose(item.index)}
                  style={{
                    cursor: item.index >= 0 ? "pointer" : "default",
                    opacity: item.isCurrent ? 0.7 : 1,
                    background: item.isCurrent ? "rgba(59, 130, 246, 0.1)" : "transparent",
                    border: item.isCurrent ? "2px solid #3b82f6" : "none",
                    borderRadius: item.isCurrent ? 6 : 0
                  }}
                >
                  <span className="mobile-card-name">
                    {item.card.name}
                    {item.isCurrent && (
                      <span
                        style={{
                          marginLeft: 8,
                          color: "#3b82f6",
                          fontSize: "0.75rem",
                          fontWeight: 700
                        }}
                      >
                        ← CURRENT
                      </span>
                    )}
                  </span>
                  <span className="mobile-card-cmc">CMC {item.cmc === 999 ? "-" : item.cmc}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mtgo-main" style={{ gap: 6 }}>
              {flexColumns.map((col) => (
                <div key={col.key} className="mtgo-column" style={{ width: 126 }}>
                  <div className="mtgo-column__header" style={{ fontSize: "0.8rem" }}>
                    {col.label} ({col.items.length})
                  </div>
                  <div className="mtgo-column__cards">
                    {col.items.map((item, i) => {
                      const isStacked = i > 0;
                      return (
                        <div
                          key={`${col.key}-${i}`}
                          onClick={() => onChoose(item.index)}
                          style={{ cursor: "pointer", position: "relative" }}
                        >
                          <CardCell
                            slot={{ card: item.card, locked: false, flexOptions: [] }}
                            stacked={isStacked}
                            compact={false}
                          />
                          {item.isCurrent && !isStacked && (
                            <div
                              style={{
                                position: "absolute",
                                top: 4,
                                right: 4,
                                background: "#3b82f6",
                                color: "#fff",
                                fontSize: "0.6rem",
                                padding: "2px 5px",
                                borderRadius: 3,
                                fontWeight: 700
                              }}
                            >
                              CURRENT
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 12, paddingTop: 12, borderTop: "1px solid #e5e7eb" }}>
          <p style={{ margin: "0 0 8px 0", fontSize: "0.85rem", fontWeight: 600 }}>Add card</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
            <input
              type="text"
              placeholder="Card name"
              value={newCardName}
              onChange={(e) => setNewCardName(e.target.value)}
              style={{ padding: "6px 8px", borderRadius: 4, border: "1px solid #e5e7eb", fontSize: "0.85rem" }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="text"
                placeholder="Mana cost (e.g. 1U)"
                value={newCardCost}
                onChange={(e) => setNewCardCost(e.target.value)}
                style={{ flex: 1, padding: "6px 8px", borderRadius: 4, border: "1px solid #e5e7eb" }}
              />
              <input
                type="text"
                placeholder="Type line (e.g. Instant)"
                value={newCardType}
                onChange={(e) => setNewCardType(e.target.value)}
                style={{ flex: 1, padding: "6px 8px", borderRadius: 4, border: "1px solid #e5e7eb" }}
              />
            </div>
          </div>
          <button
            onClick={handleAddCard}
            style={{
              width: "100%",
              padding: "6px 8px",
              borderRadius: 4,
              border: "1px solid #3b82f6",
              background: "#dbeafe",
              cursor: "pointer",
              fontSize: "0.85rem",
              fontWeight: 600,
              color: "#1e40af"
            }}
          >
            Add
          </button>
        </div>

        <div className="flex-modal__footer">
          <button className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

/* ---------------------------------- App --------------------------------- */

export default function App() {
  const deckIndex = useMemo(() => buildDeckIndex(deckData), []);
  const isMobile = useIsMobile();

  // Assign flexOptions dynamically based on card type
  const assignFlexOptions = (mainboard) =>
    mainboard.map((entry) => {
      if (entry.locked) return entry;
      return {
        ...entry,
        flexOptions: isLand(entry.card) ? landFlexOptions : spellFlexOptions
      };
    });

  const assignSideboardFlexOptions = (sideboard) =>
    sideboard.map((entry) => ({ ...entry, flexOptions: sideboardFlexOptions }));

  const [showExportMenu, setShowExportMenu] = useState(false);
  const [mainConfig, setMainConfig] = useState(assignFlexOptions(deckData.mainboard));
  const [sideConfig, setSideConfig] = useState(assignSideboardFlexOptions(deckData.sideboard));

  const [selectedFlex, setSelectedFlex] = useState(null);
  const [sampleHand, setSampleHand] = useState([]);
  const [hoveredCard, setHoveredCard] = useState(null);

  const [showAddCardModal, setShowAddCardModal] = useState(false);
  const [addCardBtnText, setAddCardBtnText] = useState("+1 Card to 61");
  const [newCardInput, setNewCardInput] = useState({ name: "", manaCost: "", typeLine: "" });

  const [mulliganAdvice, setMulliganAdvice] = useState(null);
  const [showHandModal, setShowHandModal] = useState(false);

  const mainColumns = useMemo(() => buildCmcColumns(mainConfig), [mainConfig]);
  const mobileMainList = useMemo(() => buildMobileList(mainConfig, "main"), [mainConfig]);
  const mobileSideList = useMemo(() => buildMobileList(sideConfig, "side"), [sideConfig]);

  const mainboardCount = useMemo(() => mainConfig.reduce((sum, e) => sum + (e.count || 1), 0), [mainConfig]);

  const sideSlots = useMemo(() => {
    const slots = expandSlots(sideConfig, "side");
    return slots.slice().sort((a, b) => {
      const aLand = isLand(a.card);
      const bLand = isLand(b.card);
      const aCmc = aLand ? -1 : parseCmc(a.card.manaCost);
      const bCmc = bLand ? -1 : parseCmc(b.card.manaCost);
      if (aCmc !== bCmc) return aCmc - bCmc;
      return a.card.name.localeCompare(b.card.name);
    });
  }, [sideConfig]);

  const handleCardClick = (zone, entryIndex) => {
    const config = zone === "main" ? mainConfig : sideConfig;
    const entry = config[entryIndex];
    if (!entry) return;
    if (entry.locked) return;
    if (!entry.flexOptions || entry.flexOptions.length === 0) return;
    setSelectedFlex({ zone, entryIndex });
  };

  const applyFlexChoice = (optionIndex) => {
    if (!selectedFlex) return;
    const { zone, entryIndex } = selectedFlex;

    if (zone === "main") {
      const entry = mainConfig[entryIndex];
      if (!entry) return;
      const options = entry.flexOptions || [];
      const chosenCard = optionIndex === -1 ? entry.card : options[optionIndex];
      if (!chosenCard) return;
      setMainConfig((prev) => prev.map((e, idx) => (idx === entryIndex ? { ...e, card: { ...chosenCard } } : e)));
    } else {
      const entry = sideConfig[entryIndex];
      if (!entry) return;
      const options = entry.flexOptions || [];
      const chosenCard = optionIndex === -1 ? entry.card : options[optionIndex];
      if (!chosenCard) return;
      setSideConfig((prev) => prev.map((e, idx) => (idx === entryIndex ? { ...e, card: { ...chosenCard } } : e)));
    }

    setSelectedFlex(null);
  };

  const handleAddCardToFlex = (newCard) => {
    if (!selectedFlex) return;
    const { zone, entryIndex } = selectedFlex;

    if (zone === "main") {
      setMainConfig((prev) =>
        prev.map((e, idx) =>
          idx === entryIndex ? { ...e, flexOptions: [...(e.flexOptions || []), newCard] } : e
        )
      );
    } else {
      setSideConfig((prev) =>
        prev.map((e, idx) =>
          idx === entryIndex ? { ...e, flexOptions: [...(e.flexOptions || []), newCard] } : e
        )
      );
    }
  };

  const handleAddCardClick = () => {
    setAddCardBtnText("Nice.");
    setShowAddCardModal(true);
  };

  const handleAddCardSubmit = (e) => {
    e.preventDefault();

    const name = newCardInput.name.trim();
    const manaCost = normalizeManaInput(newCardInput.manaCost);
    const typeLine = newCardInput.typeLine.trim();

    if (!name || !typeLine) return;

    const newEntry = {
      card: { name, manaCost, typeLine },
      count: 1,
      locked: false,
      flexOptions: typeLine.toLowerCase().includes("land") ? landFlexOptions : spellFlexOptions
    };

    setMainConfig((prev) => [...prev, newEntry]);
    setShowAddCardModal(false);
    setNewCardInput({ name: "", manaCost: "", typeLine: "" });
  };

  const shuffleAndDraw = () => {
    const allCards = [];
    mainConfig.forEach((entry) => {
      const count = entry.count || 1;
      for (let i = 0; i < count; i++) allCards.push(entry.card);
    });

    const drawn = shuffle(allCards).slice(0, 7);
    setSampleHand(drawn);

    const analysis = analyzeMulligan({ hand: drawn, deckIndex });
    setMulliganAdvice(analysis);

    if (isMobile) setShowHandModal(true);
  };

  const formatDeckAsText = () => {
    const lines = [];
    for (const entry of mainConfig) lines.push(`${entry.count || 1} ${entry.card.name}`);
    lines.push("");
    for (const entry of sideConfig) lines.push(`${entry.count || 1} ${entry.card.name}`);
    return lines.join("\n") + "\n";
  };

  const handleExportDownload = () => {
    const deckText = formatDeckAsText();
    const element = document.createElement("a");
    element.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(deckText));
    element.setAttribute("download", `${(deckData.deckName || "deck").replace(/\s+/g, "_")}.txt`);
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleExportCopy = async () => {
    const deckText = formatDeckAsText();
    try {
      await navigator.clipboard.writeText(deckText);
      alert("Deck list copied to clipboard!");
    } catch {
      alert("Copy failed (browser blocked clipboard). Try Download instead.");
    }
  };

  return (
    <div className="deck-page">
      <header className="deck-header">
        <div>
          <h1>{deckData.deckName}</h1>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ position: "relative" }}>
            <button className="btn" onClick={() => setShowExportMenu((v) => !v)}>
              Export
            </button>
            {showExportMenu && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  right: 0,
                  background: "#fff",
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                  zIndex: 40,
                  marginTop: 4,
                  minWidth: 160
                }}
              >
                <button
                  onClick={() => {
                    handleExportDownload();
                    setShowExportMenu(false);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "10px 16px",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: "0.9rem",
                    borderBottom: "1px solid #e5e7eb"
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f3f4f6")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  Download as .txt
                </button>

                <button
                  onClick={() => {
                    handleExportCopy();
                    setShowExportMenu(false);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "10px 16px",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: "0.9rem"
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f3f4f6")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  Copy to clipboard
                </button>
              </div>
            )}
          </div>

          <button className="btn" onClick={shuffleAndDraw}>
            Shuffle &amp; Draw 7
          </button>
        </div>
      </header>

      <div className="deck-layout">
        {/* Mainboard */}
        <section className="deck-section">
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Mainboard: {mainboardCount}</h2>
            <button
              onClick={handleAddCardClick}
              className="btn"
              style={{ padding: "6px 12px", fontSize: "0.8rem" }}
            >
              {addCardBtnText}
            </button>
          </div>

          {isMobile ? (
            <div className="mobile-list">
              {mobileMainList.map((item) => (
                <div
                  key={`mobile-main-${item.entryIndex}`}
                  className="mobile-list-item"
                  onClick={() => handleCardClick("main", item.entryIndex)}
                  style={{
                    cursor: item.flexOptions && item.flexOptions.length > 0 ? "pointer" : "default",
                    opacity: item.flexOptions && item.flexOptions.length > 0 ? 1 : 0.7
                  }}
                >
                  <span className="mobile-card-name">{item.card.name}</span>
                  <span className="mobile-card-cmc">CMC {item.cmc === 999 ? "-" : item.cmc}</span>
                  <span className="mobile-card-count">×{item.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mtgo-main">
              {mainColumns.map((col) => (
                <div key={col.key} className="mtgo-column">
                  <div className="mtgo-column__header">
                    {col.label} ({col.items.length})
                  </div>
                  <div className="mtgo-column__cards">
                    {col.items.map((slot, idx) => (
                      <CardCell
                        key={`${col.key}-${slot.entryIndex}-${idx}`}
                        slot={slot}
                        stacked={idx > 0}
                        compact={false}
                        onClick={() => handleCardClick("main", slot.entryIndex)}
                        onHover={setHoveredCard}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Blurb */}
          {hoveredCard && cardBlurbs[hoveredCard.name] && !isMobile && (
            <div
              style={{
                position: "absolute",
                padding: 16,
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
                top: "60%",
                left: "calc(100% - 60%)",
                width: 400
              }}
            >
              <h3 style={{ margin: "0 0 8px 0", fontSize: "1rem" }}>{hoveredCard.name}</h3>
              <p style={{ margin: 0, fontSize: "0.9rem", color: "#4b5563", lineHeight: 1.5 }}>
                {cardBlurbs[hoveredCard.name].blurb}
              </p>
            </div>
          )}
        </section>

        {/* Sideboard */}
        <section className="deck-section deck-section--side">
          <h2>Sideboard: 15</h2>

          {isMobile ? (
            <div className="mobile-list">
              {mobileSideList.map((item) => (
                <div
                  key={`mobile-side-${item.entryIndex}`}
                  className="mobile-list-item"
                  onClick={() => handleCardClick("side", item.entryIndex)}
                  style={{
                    cursor: item.flexOptions && item.flexOptions.length > 0 ? "pointer" : "default",
                    opacity: item.flexOptions && item.flexOptions.length > 0 ? 1 : 0.7
                  }}
                >
                  <span className="mobile-card-name">{item.card.name}</span>
                  <span className="mobile-card-cmc">CMC {item.cmc === 999 ? "-" : item.cmc}</span>
                  <span className="mobile-card-count">×{item.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid-side">
              {sideSlots.map((slot, index) => (
                <CardCell
                  key={`side-${index}`}
                  slot={slot}
                  stacked={index > 0}
                  compact={false}
                  onClick={() => handleCardClick("side", slot.entryIndex)}
                  onHover={setHoveredCard}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Sample hand (desktop) */}
      {!isMobile && (
        <section className="deck-section">
          <h2>Sample Hand</h2>
          {sampleHand.length === 0 ? (
            <p className="muted">Click "Shuffle &amp; Draw 7" to see a hand.</p>
          ) : (
            <>
              <div className="hand-row">
                {sampleHand.map((card, idx) => (
                  <CardCell
                    key={`hand-${idx}`}
                    slot={{ card, locked: true, flexOptions: [] }}
                    stacked={false}
                    compact={true}
                    onHover={setHoveredCard}
                  />
                ))}
              </div>

              {mulliganAdvice && (
                <MulliganBox advice={mulliganAdvice} />
              )}
            </>
          )}
        </section>
      )}

      {/* Mobile Hand Modal */}
      {isMobile && showHandModal && sampleHand.length > 0 && (
        <div className="flex-modal-backdrop" onClick={() => setShowHandModal(false)}>
          <div
            className="flex-modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "95vw",
              maxHeight: "85vh",
              overflow: "auto",
              background: "rgba(255, 255, 255, 0.98)"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2 style={{ margin: 0 }}>Sample Hand</h2>
              <button
                onClick={() => setShowHandModal(false)}
                style={{ background: "transparent", border: "none", fontSize: "1.5rem", cursor: "pointer", padding: "0 8px" }}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                gap: 8,
                marginBottom: "1rem"
              }}
            >
              {sampleHand.map((card, idx) => (
                <CardCell
                  key={`hand-modal-${idx}`}
                  slot={{ card, locked: true, flexOptions: [] }}
                  stacked={false}
                  compact={false}
                />
              ))}
            </div>

            {mulliganAdvice && <MulliganBox advice={mulliganAdvice} />}
          </div>
        </div>
      )}

      {/* Flex modal */}
      {selectedFlex && (
        <FlexModal
          selectedFlex={selectedFlex}
          mainConfig={mainConfig}
          sideConfig={sideConfig}
          onClose={() => setSelectedFlex(null)}
          onChoose={applyFlexChoice}
          onAddCard={handleAddCardToFlex}
        />
      )}

      {/* Add Card Modal */}
      {showAddCardModal && (
        <div className="flex-modal-backdrop" onClick={() => setShowAddCardModal(false)}>
          <div className="flex-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add a Card</h3>
            <p className="muted" style={{ marginBottom: 12 }}>
              Enter card details to add to your mainboard
            </p>

            <form onSubmit={handleAddCardSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input
                type="text"
                placeholder="Card Name"
                value={newCardInput.name}
                onChange={(e) => setNewCardInput((prev) => ({ ...prev, name: e.target.value }))}
                required
                style={{ padding: 8, borderRadius: 6, border: "1px solid #e5e7eb", fontSize: "0.9rem" }}
              />

              <input
                type="text"
                placeholder="Mana Cost (e.g. 1U or {1}{U})"
                value={newCardInput.manaCost}
                onChange={(e) => setNewCardInput((prev) => ({ ...prev, manaCost: e.target.value }))}
                style={{ padding: 8, borderRadius: 6, border: "1px solid #e5e7eb", fontSize: "0.9rem" }}
              />

              <input
                type="text"
                placeholder="Type Line (e.g. Instant, Artifact, Land — Town)"
                value={newCardInput.typeLine}
                onChange={(e) => setNewCardInput((prev) => ({ ...prev, typeLine: e.target.value }))}
                required
                style={{ padding: 8, borderRadius: 6, border: "1px solid #e5e7eb", fontSize: "0.9rem" }}
              />

              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button type="submit" className="btn" style={{ flex: 1, background: "#22c55e", color: "#fff" }}>
                  Add Card
                </button>
                <button type="button" onClick={() => setShowAddCardModal(false)} className="btn btn--ghost" style={{ flex: 1 }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function MulliganBox({ advice }) {
  const isWin = advice.stats.tier >= 3;
  const keep = advice.decision === "KEEP";

  const bg = isWin ? "#fff3cd" : keep ? "#d4edda" : "#f8d7da";
  const border = isWin ? "#ffc107" : keep ? "#28a745" : "#dc3545";
  const titleColor = isWin ? "#856404" : keep ? "#155724" : "#721c24";

  return (
    <div style={{ marginTop: "1rem", padding: "1rem", background: bg, border: `2px solid ${border}`, borderRadius: 8 }}>
      <h3 style={{ margin: "0 0 0.5rem 0", color: titleColor, fontSize: "1.1rem" }}>
        {isWin ? "🏆 KEEP — LINE FOUND" : keep ? "✅ KEEP" : "🔄 MULLIGAN"}
      </h3>

      <div style={{ fontSize: "0.9rem", lineHeight: 1.6 }}>
        {advice.reasons.map((r, i) => (
          <div key={i} style={{ fontWeight: r.startsWith("🏆") ? 700 : 400 }}>
            {r}
          </div>
        ))}
      </div>

      {advice.line?.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(0,0,0,0.12)" }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Best T1 line (heuristic):</div>
          <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: "0.82rem" }}>
            {advice.line.map((s, idx) => (
              <div key={idx}>• {s}</div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 10, fontSize: "0.85rem", opacity: 0.85 }}>
        Stats: {advice.stats.lands} lands • {advice.stats.selection} selection • {advice.stats.payoff} payoff • {advice.stats.interaction} interaction • tier {advice.stats.tier}
      </div>
    </div>
  );
}
