import React, { useState, useMemo } from "react";
import deckData from "./grixis-tinker-vintage.json";
import spellFlexOptions from "./spell-flex-options.json";
import landFlexOptions from "./land-flex-options.json";
import sideboardFlexOptions from "./sideboard-flex-options.json";
import cardBlurbs from "./card-blurbs.json";
import "./VintageDeckGrid.css";

/* ---------- Helpers ---------- */

// Determine card color from mana cost
const getCardColor = (manaCost, typeLine) => {
  if (!manaCost && (!typeLine || !typeLine.toLowerCase().includes("land"))) {
    return "colorless"; // Likely artifact or colorless
  }
  
  const type = (typeLine || "").toLowerCase();
  if (type.includes("land")) {
    return "land";
  }

  // Check for color symbols in mana cost
  const hasWhite = /\{W/.test(manaCost);
  const hasBlue = /\{U/.test(manaCost);
  const hasBlack = /\{B/.test(manaCost);
  const hasRed = /\{R/.test(manaCost);
  const hasGreen = /\{G/.test(manaCost);

  const colorCount =
    (hasWhite ? 1 : 0) +
    (hasBlue ? 1 : 0) +
    (hasBlack ? 1 : 0) +
    (hasRed ? 1 : 0) +
    (hasGreen ? 1 : 0);

  // If multicolor, return "multicolor"
  if (colorCount > 1) {
    return "multicolor";
  }

  // Single color
  if (hasWhite) return "white";
  if (hasBlue) return "blue";
  if (hasBlack) return "black";
  if (hasRed) return "red";
  if (hasGreen) return "green";

  // Default to colorless (includes artifacts)
  return "colorless";
};

// Rough CMC parser that works fine for Vintage cards in this deck
const parseCmc = (manaCost) => {
  if (!manaCost) return 0;
  const matches = manaCost.match(/\{([^}]+)\}/g);
  if (!matches) return 0;

  let total = 0;
  matches.forEach((sym) => {
    const content = sym.slice(1, -1); // inside {}

    if (/^\d+$/.test(content)) {
      total += parseInt(content, 10);
    } else if (content.includes("/")) {
      // hybrid / phyrexian style
      const parts = content.split("/");
      if (parts[0] === "2") {
        total += 2;
      } else {
        total += 1;
      }
    } else if (content === "X" || content === "Y" || content === "Z") {
      // treat X as 0 for display
      total += 0;
    } else {
      // colored symbol, snow, etc.
      total += 1;
    }
  });

  return total;
};

// Expand aggregated entries into individual card copies (for sideboard & shuffling)
const expandSlots = (config, zone) => {
  const slots = [];
  config.forEach((entry, entryIndex) => {
    const { card, count, locked, flexOptions } = entry;
    for (let i = 0; i < count; i++) {
      slots.push({
        zone,
        entryIndex,
        copyIndex: i,
        locked,
        flexOptions,
        card
      });
    }
  });
  return slots;
};

// Group mainboard into MTGO-style columns: Lands, then CMC 0, 1, 2, ...
const buildCmcColumns = (mainConfig) => {
  const cols = new Map();

  mainConfig.forEach((entry, entryIndex) => {
    const { card, count, locked, flexOptions } = entry;
    const type = (card.typeLine || "").toLowerCase();
    const isLand = type.includes("land");

    const cmc = isLand ? -1 : parseCmc(card.manaCost);
    const key = isLand ? "lands" : `cmc-${cmc}`;

    if (!cols.has(key)) {
      cols.set(key, {
        key,
        label: isLand ? "LANDS" : `CMC ${cmc}`,
        order: isLand ? -1 : cmc,
        items: []
      });
    }

    const column = cols.get(key);
    for (let i = 0; i < count; i++) {
      column.items.push({
        zone: "main",
        entryIndex,
        copyIndex: i,
        locked,
        flexOptions,
        card
      });
    }
  });

  // Sort columns by order
  const result = Array.from(cols.values()).sort((a, b) => a.order - b.order);

  // Sort cards within a column by name
  result.forEach((col) =>
    col.items.sort((a, b) => a.card.name.localeCompare(b.card.name))
  );

  return result;
};

// Build mobile list layout: spells sorted by CMC, then lands
const buildMobileList = (config) => {
  const items = [];
  
  config.forEach((entry, entryIndex) => {
    const { card, count, locked, flexOptions } = entry;
    const type = (card.typeLine || "").toLowerCase();
    const isLand = type.includes("land");
    const cmc = isLand ? 999 : parseCmc(card.manaCost); // Lands sorted last
    
    items.push({
      zone: "main",
      entryIndex,
      locked,
      flexOptions,
      card,
      count,
      cmc,
      isLand
    });
  });
  
  // Sort by CMC (lands last with cmc=999), then by name
  items.sort((a, b) => {
    if (a.cmc !== b.cmc) return a.cmc - b.cmc;
    return a.card.name.localeCompare(b.card.name);
  });
  
  return items;
};

/* ---------- Mulligan Analyzer ---------- */

const analyzeMulligan = (hand) => {
  // Categorize cards in hand
  const cardNames = hand.map(c => c.name);
  const cardTypes = hand.map(c => c.typeLine);
  
  let lands = 0;
  let fastMana = 0;
  let threats = 0;
  let interaction = 0;
  let cardSelection = 0;
  let totalCmc = 0;

  const fastManaCards = [
    "Black Lotus", "Mox Emerald", "Mox Jet", "Mox Opal", "Mox Pearl", 
    "Mox Ruby", "Mox Sapphire", "Lotus Petal", "Mana Crypt", "Sol Ring", 
    "Mana Vault"
  ];
  const threatCards = [
    "Blightsteel Colossus", "Tinker", "Karn, the Great Creator", 
    "Tezzeret the Seeker", "Tezzeret, Cruel Captain", "Time Vault",
    "Paradoxical Outcome", "Trinisphere", "Narset, Parter of Veils",
    "Trinket Mage", "Vexing Bauble"
  ];
  const interactionCards = [
    "Force of Will", "Force of Negation", "Mental Misstep", 
    "Flusterstorm", "Pyroblast", "Veil of Summer"
  ];
  const selectionCards = [
    "Ancestral Recall", "Brainstorm", "Ponder", "Mystical Tutor", 
    "Vampiric Tutor", "Gitaxian Probe", "Demonic Tutor",
    "Trinket Mage", "Sensei's Divining Top"
  ];

  hand.forEach(card => {
    if (card.typeLine.includes("Land")) lands++;
    if (fastManaCards.includes(card.name)) fastMana++;
    if (threatCards.includes(card.name)) threats++;
    if (interactionCards.includes(card.name)) interaction++;
    if (selectionCards.includes(card.name)) cardSelection++;
    totalCmc += parseCmc(card.manaCost);
  });

  const avgCmc = totalCmc / hand.length;

  // Helper: Calculate ACTUAL mana available on T1 with proper sequencing
  const calculateT1Mana = () => {
    let totalMana = 0;
    let anyColor = 0;
    let blue = 0;
    let black = 0;
    let red = 0;
    let green = 0;
    let white = 0;
    let colorless = 0;
    let artifacts = 0;
    
    // Step 1: Identify free artifacts (0 CMC) that enter play immediately
    const freeArtifacts = hand.filter(c => 
      c.typeLine.includes("Artifact") && parseCmc(c.manaCost) === 0
    );
    
    // Step 2: Identify 1-cost artifacts that could be paid for with Moxen
    const oneCostArtifacts = hand.filter(c =>
      c.typeLine.includes("Artifact") && parseCmc(c.manaCost) === 1
    );
    
    // Step 3: Check for lands
    const hasAcademy = hand.some(c => c.name === "Tolarian Academy");
    const hasRegularLand = hand.some(c => 
      c.typeLine.includes("Land") && c.name !== "Tolarian Academy"
    );
    
    // Step 4: Simulate playing out T1
    let artifactsInPlay = 0;
    let freeManaAvailable = 0; // Mana from Moxen that can pay for 1-cost artifacts
    
    // Play all free artifacts first
    freeArtifacts.forEach(artifact => {
      artifactsInPlay++;
      const name = artifact.name;
      
      // These provide mana immediately
      if (name === "Mox Sapphire") { freeManaAvailable++; blue++; }
      if (name === "Mox Jet") { freeManaAvailable++; black++; }
      if (name === "Mox Ruby") { freeManaAvailable++; red++; }
      if (name === "Mox Emerald") { freeManaAvailable++; green++; }
      if (name === "Mox Pearl") { freeManaAvailable++; white++; }
      if (name === "Mox Opal") { freeManaAvailable++; colorless++; }
      if (name === "Mana Crypt") { freeManaAvailable += 2; colorless += 2; }
      
      // Lotus and Petal don't tap, they sac for mana (save for later)
      if (name === "Black Lotus") { anyColor += 3; }
      if (name === "Lotus Petal") { anyColor += 1; }
    });
    
    // Step 5: Use Mox mana to pay for 1-cost artifacts (like Vexing Bauble)
    const artifactsPaidFor = Math.min(oneCostArtifacts.length, freeManaAvailable);
    artifactsInPlay += artifactsPaidFor;
    
    // Step 6: If we have Tolarian Academy, it taps for U per artifact
    if (hasAcademy) {
      const academyMana = artifactsInPlay;
      blue += academyMana;
      totalMana += academyMana;
      
      // Also add the Lotus/Petal mana
      totalMana += anyColor;
      
      // And the remaining Mox mana not used to pay for artifacts
      totalMana += (freeManaAvailable - artifactsPaidFor);
    } else if (hasRegularLand) {
      // Regular land + artifact mana
      totalMana = 1; // Land
      
      // Find which land and add its color
      const landCard = hand.find(c => 
        c.typeLine.includes("Land") && c.name !== "Tolarian Academy"
      );
      if (landCard) {
        const name = landCard.name;
        if (name.includes("Island") || name === "Underground Sea" || name === "Volcanic Island" || 
            name === "Polluted Delta" || name === "Scalding Tarn" || name === "Flooded Strand" ||
            name === "Mana Confluence" || name === "City of Brass") {
          blue++;
        }
        if (name.includes("Swamp") || name === "Underground Sea" || name === "Polluted Delta" ||
            name === "Mana Confluence" || name === "City of Brass") {
          black++;
        }
        if (name === "Volcanic Island" || name === "Scalding Tarn" || 
            name === "Mana Confluence" || name === "City of Brass") {
          red++;
        }
        if (name === "Mana Confluence" || name === "City of Brass") {
          green++;
          white++;
          // Don't add to anyColor here - that's only for Lotus/Petal
        }
      }
      
      // Add artifact mana
      totalMana += freeManaAvailable + anyColor;
    } else {
      // No land, just artifact mana
      totalMana = freeManaAvailable + anyColor;
    }
    
    // Step 7: Handle Sol Ring / Mana Vault if we have mana to cast them
    if (totalMana >= 1) {
      const hasSolRing = hand.some(c => c.name === "Sol Ring");
      const hasManaVault = hand.some(c => c.name === "Mana Vault");
      
      if (hasSolRing) {
        totalMana += 1; // Costs 1, makes 2, net +1
        colorless += 2;
        artifactsInPlay++;
      }
      if (hasManaVault) {
        totalMana += 2; // Costs 1, makes 3, net +2
        colorless += 3;
        artifactsInPlay++;
      }
    }
    
    // Count total artifacts in hand for Tezzeret/Tinker checks
    artifacts = hand.filter(c => c.typeLine.includes("Artifact")).length;
    
    return { 
      totalMana, 
      anyColor,
      blue, 
      black, 
      red, 
      green, 
      white, 
      colorless,
      artifacts 
    };
  };

  // Check for T1 win conditions
  const winConditions = [];
  const mana = calculateT1Mana();
  
  // Special keepable patterns (before win checks)
  const hasLotus = cardNames.includes("Black Lotus");
  const hasAncestral = cardNames.includes("Ancestral Recall");
  const hasMoxen = cardNames.some(name => 
    ["Mox Sapphire", "Mox Jet", "Mox Ruby", "Mox Emerald", "Mox Pearl", "Mox Opal"].includes(name)
  );
  
  // Pattern: Lotus/Mox + Ancestral = always keep (card selection fixes everything)
  if ((hasLotus || hasMoxen) && hasAncestral) {
    winConditions.push("🏆 KEEP: Fast mana + Ancestral Recall (draw 3 to find lands/threats)");
  }
  
  // Pattern: Explosive landless hand with 5+ mana and card draw
  if (lands === 0 && mana.totalMana >= 5 && cardSelection >= 1) {
    winConditions.push("✅ KEEP: Explosive landless hand (5+ mana, card selection to find lands)");
  }
  
  // 1. Time Vault + Voltaic Key combo (needs 4 mana available after playing both)
  const hasVault = cardNames.includes("Time Vault");
  const hasKey = cardNames.includes("Voltaic Key") || cardNames.includes("Manifold Key");
  
  if (hasVault && hasKey) {
    // Vault costs 2, Key costs 1, need 1 to untap = 4 total
    // But need to account for using mana to cast them
    const vaultCost = 2;
    const keyCost = 1;
    const activationCost = 1;
    const netManaNeeded = vaultCost + keyCost + activationCost; // 4 mana
    
    if (mana.totalMana >= netManaNeeded) {
      winConditions.push("🏆 T1 WIN: Time Vault + Key combo with " + mana.totalMana + " mana available!");
    }
  }
  
  // 2. Demonic Tutor + Key + enough mana to tutor for Vault and combo (need 6+ mana)
  const hasDemonicTutor = cardNames.includes("Demonic Tutor");
  if (hasDemonicTutor && hasKey && mana.totalMana >= 6 && mana.black >= 1) {
    winConditions.push("🏆 T1 WIN: Demonic Tutor for Vault + Key combo (6+ mana, can tutor and combo)");
  }
  
  // 3. Tinker + Blightsteel "go" hand (2U = 3 mana + artifact, can cast Tinker and say go)
  const hasTinker = cardNames.includes("Tinker");
  const hasBlightsteel = cardNames.includes("Blightsteel Colossus");
  
  if (hasTinker && mana.blue >= 1 && mana.totalMana >= 3 && mana.artifacts >= 1) {
    if (hasBlightsteel) {
      winConditions.push("🏆 LIKELY WIN: Tinker → Blightsteel Colossus (2U available, artifact to sac)");
    } else {
      winConditions.push("⚠️ Tinker online (2U + artifact) - no Blightsteel in hand");
    }
  }
  
  // 4. Tinker + Voltaic/Manifold Key (Tinker for Vault, cast Key, combo)
  // Needs: 2U for Tinker, 1 for Key, 1 for activation = 5 mana + artifact to sac
  if (hasTinker && hasKey && !hasVault && mana.blue >= 1 && mana.artifacts >= 1 && mana.totalMana >= 5) {
    winConditions.push("🏆 T1 WIN: Tinker for Time Vault, cast Key, combo off (2U + 2 mana + artifact)");
  }
  
  // 4b. Tinker + Time Vault in hand (Tinker for Key, cast Vault, combo)
  // Needs: 2U for Tinker, 2 for Vault, 1 for activation = 6 mana + artifact to sac
  if (hasTinker && hasVault && !hasKey && mana.blue >= 1 && mana.artifacts >= 1 && mana.totalMana >= 6) {
    winConditions.push("🏆 T1 WIN: Tinker for Voltaic Key, cast Vault, combo off (2U + 3 mana + artifact)");
  }
  
  // 4c. Vault + Key in hand (don't need Tinker, just need mana)
  // Needs: 2 for Vault, 1 for Key, 1 for activation = 4 mana total
  if (hasVault && hasKey && mana.totalMana >= 4) {
    winConditions.push("🏆 T1 WIN: Time Vault + Voltaic Key combo (4 mana total)");
  }
  
  // 5. Tezzeret the Seeker lines (UU3 = 5 mana, 4+ artifacts)
  const hasTezzeret = cardNames.includes("Tezzeret the Seeker");
  if (hasTezzeret && mana.blue >= 2 && mana.totalMana >= 5 && mana.artifacts >= 4) {
    winConditions.push("🏆 POSSIBLE WIN: Tezzeret the Seeker (UU3 available, 4+ artifacts for metalcraft)");
  }
  
  // 6. Mystical Tutor / Vampiric Tutor for combo pieces
  const hasMysticalTutor = cardNames.includes("Mystical Tutor");
  const hasVampiricTutor = cardNames.includes("Vampiric Tutor");
  
  if ((hasMysticalTutor || hasVampiricTutor) && hasVault && mana.totalMana >= 5) {
    winConditions.push("⚠️ Can tutor for Key with Vault in hand (5+ mana available)");
  }
  
  // 7. T1 Karn, the Great Creator (needs 4 mana, ideally colorless)
  const hasKarn = cardNames.includes("Karn, the Great Creator");
  if (hasKarn && mana.totalMana >= 4) {
    winConditions.push("🏆 T1 KEEP: Karn, the Great Creator (4 mana available, can wish for threats/answers)");
  }
  
  // 8. T1 Narset + Trinisphere lock (needs UU1 for Narset = 3, 3 for Trinisphere = 6 total)
  const hasNarset = cardNames.includes("Narset, Parter of Veils");
  const hasTrinisphere = cardNames.includes("Trinisphere");
  if (hasNarset && hasTrinisphere && mana.totalMana >= 6 && mana.blue >= 2) {
    winConditions.push("🏆 T1 LOCK: Narset + Trinisphere (opponent can't draw, can't cast spells efficiently)");
  }
  
  // 9. Trinket Mage lines (castable T1 with UU1 = 3 mana)
  const hasTrinketMage = cardNames.includes("Trinket Mage");
  if (hasTrinketMage && mana.totalMana >= 3 && mana.blue >= 2) {
    // Count mana rocks already in hand (0 or 1 CMC artifacts that make mana)
    const manaRocksInHand = cardNames.filter(name => 
      ["Black Lotus", "Mox Sapphire", "Mox Jet", "Mox Ruby", "Mox Emerald", "Mox Pearl",
       "Mox Opal", "Sol Ring", "Lotus Petal", "Mana Crypt", "Mana Vault"].includes(name)
    ).length;
    
    // Trinket Mage can fetch: Voltaic Key, Manifold Key, Pithing Needle, Tormod's Crypt, etc.
    // If fetching a mana rock (Sol Ring, Mox Opal) enables casting other cards in hand
    const expensiveCardsInHand = hand.filter(card => {
      const cmc = parseCmc(card.manaCost);
      return cmc >= 4 && !fastManaCards.includes(card.name);
    });
    
    if (hasVault && mana.totalMana >= 7) {
      // Trinket Mage (3) + Time Vault (2) + fetch Key (1) + activate (1) = 7 mana
      winConditions.push("🏆 T1 WIN: Trinket Mage → fetch Key, cast Vault, combo (7 mana)");
    } else if (expensiveCardsInHand.length > 0 && manaRocksInHand < 5) {
      // Can fetch a mana rock to enable expensive spells
      winConditions.push("✅ Trinket Mage can fetch mana rock to enable " + expensiveCardsInHand[0].name);
    } else {
      winConditions.push("✅ T1 Trinket Mage (can fetch Key, Needle, etc.)");
    }
  }
  
  // 10. Time Vault + Tezzeret, Cruel Captain (needs 5 mana: Vault 2, Tezz UB1 = 3)
  const hasTezzCruel = cardNames.includes("Tezzeret, Cruel Captain");
  if (hasVault && hasTezzCruel && mana.totalMana >= 5 && mana.blue >= 1 && mana.black >= 1) {
    winConditions.push("🏆 T1 WIN: Time Vault + Tezzeret, Cruel Captain (can -3 to fetch Key, combo next turn or immediately with 7 mana)");
  }
  
  // 11. Time Vault + Tezzeret the Seeker (needs 7 mana: Vault 2, Tezz UU3 = 5)
  if (hasVault && hasTezzeret && mana.totalMana >= 7 && mana.blue >= 2) {
    winConditions.push("🏆 T1 WIN: Time Vault + Tezzeret the Seeker (7 mana, -X for 1 to get Key, untap Vault, combo)");
  }
  
  // 12. T1 Lock piece (Trinisphere or Narset) with counter backup
  const hasLockPiece = hasTrinisphere || hasNarset;
  if (hasLockPiece && interaction >= 2 && mana.totalMana >= 3) {
    const lockPieceName = hasTrinisphere ? "Trinisphere" : "Narset";
    winConditions.push("🏆 T1 LOCK: " + lockPieceName + " with counter backup (" + interaction + " interaction spells)");
  }

  // Decision logic
  const reasons = [];
  let shouldKeep = true;
  
  // If we have a win condition, automatically keep
  if (winConditions.length > 0) {
    reasons.push(...winConditions);
    shouldKeep = true;
  }

  if (lands === 0) {
    reasons.push("❌ No lands");
    if (winConditions.length === 0) shouldKeep = false;
  } else if (lands > 4) {
    reasons.push("❌ Too many lands (" + lands + ")");
    if (winConditions.length === 0) shouldKeep = false;
  } else if (lands >= 1 && lands <= 3) {
    reasons.push("✅ Good land count (" + lands + ")");
  }

  if (fastMana === 0 && lands < 2) {
    reasons.push("❌ No fast mana and insufficient lands");
    if (winConditions.length === 0) shouldKeep = false;
  } else if (fastMana >= 1) {
    reasons.push("✅ Has fast mana (" + fastMana + ")");
  }

  if (threats === 0 && cardSelection === 0) {
    reasons.push("❌ No threats or card selection");
    if (winConditions.length === 0) shouldKeep = false;
  }

  if (avgCmc > 3 && fastMana < 2 && lands < 3) {
    reasons.push("⚠️ Heavy curve (avg " + avgCmc.toFixed(1) + " CMC) without acceleration");
    if (shouldKeep && winConditions.length === 0) shouldKeep = false;
  }

  if (threats >= 1) {
    reasons.push("✅ Has threat (" + threats + ")");
  }

  if (cardSelection >= 1) {
    reasons.push("✅ Has card selection (" + cardSelection + ")");
  }

  if (interaction >= 1) {
    reasons.push("✅ Has interaction (" + interaction + ")");
  }

  return {
    decision: shouldKeep ? "KEEP" : "MULLIGAN",
    reasons,
    stats: { 
      lands, 
      fastMana, 
      threats, 
      interaction, 
      cardSelection, 
      avgCmc: avgCmc.toFixed(1),
      totalMana: mana.totalMana,
      winConditions: winConditions.length
    }
  };
};

/* ---------- Card Cell ---------- */

const CardCell = ({ slot, stacked = false, compact = false, onClick, onHover }) => {
  const isFlex =
    !slot.locked &&
    slot.flexOptions &&
    slot.flexOptions.length > 0 &&
    typeof onClick === "function";

  const cardColor = getCardColor(slot.card.manaCost, slot.card.typeLine);
  const title = `${slot.card.name} • ${slot.card.typeLine}`;

  const [hovered, setHovered] = useState(false);
  const [hoverTimeout, setHoverTimeout] = useState(null);

  const handleMouseEnter = () => {
    const timeout = setTimeout(() => {
      setHovered(true);
      onHover(slot.card);
    }, 1500);
    setHoverTimeout(timeout);
  };

  const handleMouseLeave = () => {
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
      setHoverTimeout(null);
    }
    setHovered(false);
    onHover(null);
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
      style={hovered ? { zIndex: 100, transform: "scale(1.15)" } : {}}
    >
      <div className="card-slot__header">
        <div className="card-slot__name">{slot.card.name}</div>
        <div className="card-slot__mana">{slot.card.manaCost || "\u00a0"}</div>
      </div>

      {/* Full body always exists; for stacked ones it's visually covered */}
      <div className="card-slot__type">{slot.card.typeLine}</div>

      {isFlex && !stacked && <div className="card-slot__badge">FLEX</div>}
    </div>
  );
};

/* ---------- Flex Modal ---------- */

const FlexModal = ({ selectedFlex, mainConfig, sideConfig, onClose, onChoose, onAddCard }) => {
  if (!selectedFlex) return null;

  // Detect mobile
  const [isMobile, setIsMobile] = React.useState(false);
  React.useEffect(() => {
    const checkMobile = () => {
      const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                     window.innerWidth <= 768;
      setIsMobile(mobile);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const { zone, entryIndex } = selectedFlex;
  let entry = null;

  if (zone === "main") {
    entry = mainConfig[entryIndex];
  } else if (zone === "side") {
    entry = sideConfig[entryIndex];
  }

  if (!entry) return null;

  const { card, flexOptions } = entry;
  const [searchTerm, setSearchTerm] = React.useState("");
  const [newCardName, setNewCardName] = React.useState("");
  const [newCardCost, setNewCardCost] = React.useState("");
  const [newCardType, setNewCardType] = React.useState("");

  // Filter flex options based on search
  const filtered = flexOptions.filter(
    (opt) =>
      opt.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      opt.manaCost.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Build CMC columns for flex options
  const flexColumns = React.useMemo(() => {
    const cols = new Map();

    // Add current card first
    const currentType = (card.typeLine || "").toLowerCase();
    const currentIsLand = currentType.includes("land");
    const currentCmc = currentIsLand ? -1 : parseCmc(card.manaCost);
    const currentKey = currentIsLand ? "lands" : `cmc-${currentCmc}`;

    if (!cols.has(currentKey)) {
      cols.set(currentKey, {
        key: currentKey,
        label: currentIsLand ? "LANDS" : `CMC ${currentCmc}`,
        order: currentIsLand ? -1 : currentCmc,
        items: []
      });
    }
    cols.get(currentKey).items.push({ card, index: -1, isCurrent: true });

    // Add filtered flex options
    filtered.forEach((opt, idx) => {
      const type = (opt.typeLine || "").toLowerCase();
      const isLand = type.includes("land");
      const cmc = isLand ? -1 : parseCmc(opt.manaCost);
      const key = isLand ? "lands" : `cmc-${cmc}`;

      if (!cols.has(key)) {
        cols.set(key, {
          key,
          label: isLand ? "LANDS" : `CMC ${cmc}`,
          order: isLand ? -1 : cmc,
          items: []
        });
      }
      cols.get(key).items.push({ card: opt, index: idx, isCurrent: false });
    });

    // Sort columns by order
    const result = Array.from(cols.values()).sort((a, b) => a.order - b.order);

    // Sort cards within each column by name
    result.forEach((col) =>
      col.items.sort((a, b) => a.card.name.localeCompare(b.card.name))
    );

    return result;
  }, [card, filtered]);

  // Build mobile list (sorted by CMC, then name)
  const mobileFlexList = React.useMemo(() => {
    const items = [];
    
    // Add current card first
    items.push({
      card,
      index: -1,
      isCurrent: true,
      cmc: parseCmc(card.manaCost),
      isLand: (card.typeLine || "").toLowerCase().includes("land")
    });
    
    // Add filtered options
    filtered.forEach((opt, idx) => {
      const type = (opt.typeLine || "").toLowerCase();
      const isLand = type.includes("land");
      items.push({
        card: opt,
        index: idx,
        isCurrent: false,
        cmc: isLand ? 999 : parseCmc(opt.manaCost),
        isLand
      });
    });
    
    // Sort by CMC (lands last), then name
    items.sort((a, b) => {
      if (a.cmc !== b.cmc) return a.cmc - b.cmc;
      return a.card.name.localeCompare(b.card.name);
    });
    
    return items;
  }, [card, filtered]);

  const handleAddCard = () => {
    if (newCardName.trim()) {
      const newCard = {
        name: newCardName,
        manaCost: newCardCost || "",
        typeLine: newCardType || ""
      };
      onAddCard(newCard);
      setNewCardName("");
      setNewCardCost("");
      setNewCardType("");
    }
  };

  return (
    <div className="flex-modal-backdrop" onClick={onClose}>
      <div className="flex-modal flex-modal--large" onClick={(e) => e.stopPropagation()} style={{
        background: "rgba(246, 242, 242, 0.1)",
        backdropFilter: "blur(5px)"
      }}>
        {/* Current Card Being Replaced */}
        <div style={{
          marginBottom: "16px",
          padding: "12px",
          background: "rgba(59, 130, 246, 0.1)",
          borderRadius: "8px",
          border: "2px solid #3b82f6"
        }}>
          <h3 style={{ margin: "0 0 8px 0", fontSize: "0.9rem", color: "#1e40af" }}>Replacing this card:</h3>
          <div style={{ display: "inline-block", width: "144px" }}>
            <div style={{ transform: "scale(0.9)", transformOrigin: "top left" }}>
              <CardCell 
                slot={{ 
                  card, 
                  locked: false, 
                  flexOptions: [] 
                }} 
                stacked={false}
                compact={false}
              />
            </div>
          </div>
        </div>

        <h3 style={{ margin: "0 0 4px 0", fontSize: "1rem" }}>Choose a replacement</h3>
        <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "8px" }}>Click any card below to swap it in</p>

        {/* Search input */}
        <input
          type="text"
          placeholder="Search cards..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            width: "100%",
            padding: "8px",
            marginBottom: "12px",
            borderRadius: "6px",
            border: "1px solid #e5e7eb",
            fontSize: "0.85rem",
            boxSizing: "border-box"
          }}
        />

        {/* CMC Columns Display */}
        <div style={{ 
          maxHeight: "500px", 
          overflowY: "auto", 
          marginBottom: "12px",
          padding: "8px"
        }}>
          {isMobile ? (
            /* Mobile scrollable list */
            <div className="mobile-list">
              {mobileFlexList.map((item, listIdx) => (
                <div
                  key={`mobile-flex-${listIdx}`}
                  className="mobile-list-item"
                  onClick={() => item.index >= 0 && onChoose(item.index)}
                  style={{
                    cursor: item.index >= 0 ? "pointer" : "default",
                    opacity: item.isCurrent ? 0.7 : 1,
                    background: item.isCurrent ? "rgba(59, 130, 246, 0.1)" : "transparent",
                    border: item.isCurrent ? "2px solid #3b82f6" : "none",
                    borderRadius: item.isCurrent ? "6px" : "0"
                  }}
                >
                  <span className="mobile-card-name">
                    {item.card.name}
                    {item.isCurrent && <span style={{ marginLeft: "8px", color: "#3b82f6", fontSize: "0.75rem", fontWeight: 700 }}>← CURRENT</span>}
                  </span>
                  <span className="mobile-card-cmc">CMC {item.cmc === 999 ? '-' : item.cmc}</span>
                </div>
              ))}
            </div>
          ) : (
            /* Desktop CMC columns */
            <div className="mtgo-main" style={{ gap: "6px" }}>
              {flexColumns.map((col) => (
                <div key={col.key} className="mtgo-column" style={{ width: "126px" }}>
                  <div className="mtgo-column__header" style={{ fontSize: "0.8rem" }}>
                    {col.label} ({col.items.length})
                  </div>
                  <div className="mtgo-column__cards">
                    {col.items.map((item, idx) => {
                      const isStacked = idx > 0;
                      return (
                        <div
                          key={`${col.key}-${idx}`}
                          onClick={() => onChoose(item.index)}
                          style={{ 
                            cursor: "pointer",
                            position: "relative"
                          }}
                        >
                          <CardCell 
                            slot={{ 
                              card: item.card, 
                              locked: false, 
                              flexOptions: [] 
                            }} 
                            stacked={isStacked}
                            compact={false}
                          />
                          {item.isCurrent && !isStacked && (
                            <div style={{
                              position: "absolute",
                              top: "4px",
                              right: "4px",
                              background: "#3b82f6",
                              color: "white",
                              fontSize: "0.6rem",
                              padding: "2px 5px",
                              borderRadius: "3px",
                              fontWeight: 700
                            }}>
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

        {/* Add card section */}
        <div style={{ marginBottom: 12, paddingTop: 12, borderTop: "1px solid #e5e7eb" }}>
          <p style={{ margin: "0 0 8px 0", fontSize: "0.85rem", fontWeight: 600 }}>
            Add card
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
            <input
              type="text"
              placeholder="Card name"
              value={newCardName}
              onChange={(e) => setNewCardName(e.target.value)}
              style={{
                padding: "6px 8px",
                borderRadius: "4px",
                border: "1px solid #e5e7eb",
                fontSize: "0.85rem",
                boxSizing: "border-box"
              }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="text"
                placeholder="Mana cost"
                value={newCardCost}
                onChange={(e) => setNewCardCost(e.target.value)}
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  borderRadius: "4px",
                  border: "1px solid #e5e7eb",
                  fontSize: "0.85rem",
                  boxSizing: "border-box"
                }}
              />
              <input
                type="text"
                placeholder="Type (e.g., Land, Instant)"
                value={newCardType}
                onChange={(e) => setNewCardType(e.target.value)}
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  borderRadius: "4px",
                  border: "1px solid #e5e7eb",
                  fontSize: "0.85rem",
                  boxSizing: "border-box"
                }}
              />
            </div>
          </div>
          <button
            onClick={handleAddCard}
            style={{
              width: "100%",
              padding: "6px 8px",
              borderRadius: "4px",
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

/* ---------- App ---------- */

function App() {
  // Assign flexOptions dynamically based on card type
  const assignFlexOptions = (mainboard) =>
    mainboard.map((entry) => {
      if (entry.locked) return entry;
      const type = (entry.card.typeLine || "").toLowerCase();
      if (type.includes("land")) {
        return { ...entry, flexOptions: landFlexOptions };
      } else {
        return { ...entry, flexOptions: spellFlexOptions };
      }
    });

  // Assign flex options to all sideboard cards
  const assignSideboardFlexOptions = (sideboard) =>
    sideboard.map((entry) => {
      return { ...entry, flexOptions: sideboardFlexOptions };
    });

  // Mobile detection
  const [isMobile, setIsMobile] = useState(false);

  React.useEffect(() => {
    const checkMobile = () => {
      const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                     window.innerWidth <= 768;
      setIsMobile(mobile);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const [showExportMenu, setShowExportMenu] = React.useState(false);
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
  const mainColumns = useMemo(
    () => buildCmcColumns(mainConfig),
    [mainConfig]
  );
  
  // Build mobile list views
  const mobileMainList = useMemo(() => buildMobileList(mainConfig), [mainConfig]);
  const mobileSideList = useMemo(() => buildMobileList(sideConfig), [sideConfig]);

  // Calculate total mainboard cards
  const mainboardCount = useMemo(() => {
    return mainConfig.reduce((sum, entry) => sum + (entry.count || 1), 0);
  }, [mainConfig]);

  // Sideboard: single column, sorted by CMC (lands first), then name
  const sideSlots = useMemo(() => {
    const slots = expandSlots(sideConfig, "side");

    return slots.slice().sort((a, b) => {
      const aType = (a.card.typeLine || "").toLowerCase();
      const bType = (b.card.typeLine || "").toLowerCase();
      const aIsLand = aType.includes("land");
      const bIsLand = bType.includes("land");

      const aCmc = aIsLand ? -1 : parseCmc(a.card.manaCost);
      const bCmc = bIsLand ? -1 : parseCmc(b.card.manaCost);

      if (aCmc !== bCmc) return aCmc - bCmc;
      return a.card.name.localeCompare(b.card.name);
    });
  }, [sideConfig]);

  const handleCardClick = (zone, entryIndex) => {
    if (zone === "main") {
      const entry = mainConfig[entryIndex];
      if (
        !entry ||
        entry.locked ||
        !entry.flexOptions ||
        entry.flexOptions.length === 0
      ) {
        return;
      }
    } else if (zone === "side") {
      const entry = sideConfig[entryIndex];
      if (
        !entry ||
        !entry.flexOptions ||
        entry.flexOptions.length === 0
      ) {
        return;
      }
    } else {
      return;
    }
    setSelectedFlex({ zone, entryIndex });
  };

  const applyFlexChoice = (optionIndex) => {
    if (!selectedFlex) return;
    const { zone, entryIndex } = selectedFlex;

    if (zone === "main") {
      const entry = mainConfig[entryIndex];
      if (!entry) return;
      const options = entry.flexOptions || [];
      const chosenCard =
        optionIndex === -1 ? entry.card : options[optionIndex];
      if (!chosenCard) return;
      setMainConfig((prev) =>
        prev.map((e, idx) =>
          idx === entryIndex ? { ...e, card: { ...chosenCard } } : e
        )
      );
    } else if (zone === "side") {
      const entry = sideConfig[entryIndex];
      if (!entry) return;
      const options = entry.flexOptions || [];
      const chosenCard =
        optionIndex === -1 ? entry.card : options[optionIndex];
      if (!chosenCard) return;
      setSideConfig((prev) =>
        prev.map((e, idx) =>
          idx === entryIndex ? { ...e, card: { ...chosenCard } } : e
        )
      );
    }
    setSelectedFlex(null);
  };

  const handleAddCardToFlex = (newCard) => {
    if (!selectedFlex) return;
    const { zone, entryIndex } = selectedFlex;

    if (zone === "main") {
      setMainConfig((prev) =>
        prev.map((e, idx) => {
          if (idx === entryIndex) {
            return {
              ...e,
              flexOptions: [...(e.flexOptions || []), newCard]
            };
          }
          return e;
        })
      );
    } else if (zone === "side") {
      setSideConfig((prev) =>
        prev.map((e, idx) => {
          if (idx === entryIndex) {
            return {
              ...e,
              flexOptions: [...(e.flexOptions || []), newCard]
            };
          }
          return e;
        })
      );
    }
  };

  const handleAddCardClick = () => {
    setAddCardBtnText("Nice.");
    setShowAddCardModal(true);
  };

  const handleAddCardSubmit = (e) => {
    e.preventDefault();
    let manaCost = newCardInput.manaCost.trim();
    
    // Auto-wrap mana cost in {}
    if (manaCost && !manaCost.includes("{")) {
      const parts = manaCost.split("");
      manaCost = parts.map(char => `{${char}}`).join("");
    }
    
    const typeLine = newCardInput.typeLine.trim();
    const isLand = typeLine.toLowerCase().includes("land");
    
    const newCard = {
      card: {
        name: newCardInput.name.trim(),
        manaCost: manaCost,
        typeLine: typeLine
      },
      count: 1,
      locked: false,
      flexOptions: isLand ? landFlexOptions : spellFlexOptions
    };
    
    setMainConfig([...mainConfig, newCard]);
    setShowAddCardModal(false);
    setNewCardInput({ name: "", manaCost: "", typeLine: "" });
  };

  const shuffleAndDraw = () => {
    const cards = [];
    mainConfig.forEach((entry) => {
      const count = entry.count || 1;
      for (let i = 0; i < count; i++) {
        cards.push(entry.card);
      }
    });

    const shuffled = [...cards];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const drawn = shuffled.slice(0, 7);
    setSampleHand(drawn);
    
    // Analyze the hand
    const analysis = analyzeMulligan(drawn);
    setMulliganAdvice(analysis);
    
    // On mobile, open the hand modal
    if (isMobile) {
      setShowHandModal(true);
    }
  };

  const formatDeckAsText = () => {
    let text = "";
    
    // Mainboard
    mainConfig.forEach((entry) => {
      const count = entry.count || 1;
      text += `${count} ${entry.card.name}\n`;
    });
    
    text += "\n";
    
    // Sideboard
    sideConfig.forEach((entry) => {
      text += `${entry.count} ${entry.card.name}\n`;
    });
    
    return text;
  };

  const handleExportDownload = () => {
    const deckText = formatDeckAsText();
    const element = document.createElement("a");
    element.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(deckText));
    element.setAttribute("download", `${deckData.deckName.replace(/\s+/g, "_")}.txt`);
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleExportCopy = () => {
    const deckText = formatDeckAsText();
    navigator.clipboard.writeText(deckText).then(() => {
      alert("Deck list copied to clipboard!");
    });
  };

  return (
    <div className="deck-page">
      <header className="deck-header">
        <div>
          <h1>{deckData.deckName}</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ position: "relative" }}>
            <button className="btn" onClick={() => setShowExportMenu(!showExportMenu)}>
              Export
            </button>
            {showExportMenu && (
              <div style={{
                position: "absolute",
                top: "100%",
                right: 0,
                background: "#ffffff",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                zIndex: 40,
                marginTop: "4px",
                minWidth: "160px"
              }}>
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
                  onMouseEnter={(e) => e.target.style.background = "#f3f4f6"}
                  onMouseLeave={(e) => e.target.style.background = "transparent"}
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
                  onMouseEnter={(e) => e.target.style.background = "#f3f4f6"}
                  onMouseLeave={(e) => e.target.style.background = "transparent"}
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
        {/* Mainboard columns */}
        <section className="deck-section">
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px" }}>
            <h2 style={{ margin: 0 }}>Mainboard: {mainboardCount}</h2>
            <button
              onClick={handleAddCardClick}
              className="btn"
              style={{
                padding: "6px 12px",
                fontSize: "0.8rem"
              }}
            >
              {addCardBtnText}
            </button>
          </div>
          
          {isMobile ? (
            /* Mobile list layout */
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
                  <span className="mobile-card-cmc">CMC {item.cmc === 999 ? '-' : item.cmc}</span>
                  <span className="mobile-card-count">×{item.count}</span>
                </div>
              ))}
            </div>
          ) : (
            /* Desktop MTGO columns */
            <div className="mtgo-main">
              {mainColumns.map((col) => (
                <div key={col.key} className="mtgo-column">
                  <div className="mtgo-column__header">
                    {col.label} ({col.items.length})
                  </div>
                  <div className="mtgo-column__cards">
                    {col.items.map((slot, idx) => {
                      const isStacked = idx > 0; // everything except the first card
                      return (
                        <CardCell
                          key={`${col.key}-${slot.entryIndex}-${idx}`}
                          slot={slot}
                          stacked={isStacked}
                          compact={false}
                          onClick={() =>
                            handleCardClick("main", slot.entryIndex)
                          }
                          onHover={setHoveredCard}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Card blurb display - positioned under mainboard */}
          {hoveredCard && cardBlurbs[hoveredCard.name] && (
            <div style={{
              position: "absolute",
              padding: "16px",
              background: "#ffffff",
              border: "1px solid #e5e7eb",
              borderRadius: "8px",
              boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
              top: "60%",
              left: "calc(100% - 60%)",
              width: "400px"
            }}>
              <h3 style={{ margin: "0 0 8px 0", fontSize: "1rem" }}>{hoveredCard.name}</h3>
              <p style={{ margin: 0, fontSize: "0.9rem", color: "#4b5563", lineHeight: 1.5 }}>
                {cardBlurbs[hoveredCard.name].blurb}
              </p>
            </div>
          )}
        </section>

        {/* Sideboard on the right */}
        <section className="deck-section deck-section--side">
          <h2>Sideboard: 15</h2>
          
          {isMobile ? (
            /* Mobile list layout */
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
                  <span className="mobile-card-cmc">CMC {item.cmc === 999 ? '-' : item.cmc}</span>
                  <span className="mobile-card-count">×{item.count}</span>
                </div>
              ))}
            </div>
          ) : (
            /* Desktop grid */
            <div className="grid-side">
              {sideSlots.map((slot, index) => {
                const isStacked = index > 0;
                return (
                  <CardCell
                    key={`side-${index}`}
                    slot={slot}
                    stacked={isStacked}
                    compact={false}
                    onClick={() =>
                      handleCardClick("side", slot.entryIndex)
                    }
                    onHover={setHoveredCard}
                  />
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Sample hand - hidden on mobile, shown in modal instead */}
      {!isMobile && (
        <section className="deck-section">
          <h2>Sample Hand</h2>
          {sampleHand.length === 0 ? (
            <p className="muted">
              Click "Shuffle &amp; Draw 7" to see a hand.
            </p>
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
              
              {/* Mulligan Advice */}
              {mulliganAdvice && (
                <div style={{
                  marginTop: "1rem",
                  padding: "1rem",
                  background: mulliganAdvice.stats.winConditions > 0 ? "#fff3cd" : 
                             (mulliganAdvice.decision === "KEEP" ? "#d4edda" : "#f8d7da"),
                  border: `2px solid ${mulliganAdvice.stats.winConditions > 0 ? "#ffc107" :
                                       (mulliganAdvice.decision === "KEEP" ? "#28a745" : "#dc3545")}`,
                  borderRadius: "8px"
                }}>
                  <h3 style={{ 
                    margin: "0 0 0.5rem 0",
                    color: mulliganAdvice.stats.winConditions > 0 ? "#856404" :
                           (mulliganAdvice.decision === "KEEP" ? "#155724" : "#721c24"),
                    fontSize: "1.1rem"
                  }}>
                    {mulliganAdvice.stats.winConditions > 0 ? "🏆 KEEP - WIN POSSIBLE!" :
                     (mulliganAdvice.decision === "KEEP" ? "✅ KEEP" : "🔄 MULLIGAN")}
                  </h3>
                  <div style={{ fontSize: "0.9rem", lineHeight: "1.6" }}>
                    {mulliganAdvice.reasons.map((reason, idx) => (
                      <div key={idx} style={{
                        fontWeight: reason.includes("WIN") || reason.includes("🏆") ? 700 : 400,
                        color: reason.includes("WIN") || reason.includes("🏆") ? "#856404" : "inherit"
                      }}>
                        {reason}
                      </div>
                    ))}
                  </div>
                  <div style={{ 
                    marginTop: "0.5rem", 
                    fontSize: "0.85rem", 
                    opacity: 0.8,
                    borderTop: "1px solid rgba(0,0,0,0.1)",
                    paddingTop: "0.5rem"
                  }}>
                    Stats: {mulliganAdvice.stats.lands} lands • {mulliganAdvice.stats.totalMana} total mana • {mulliganAdvice.stats.fastMana} fast mana • {mulliganAdvice.stats.threats} threats • {mulliganAdvice.stats.cardSelection} selection • {mulliganAdvice.stats.interaction} interaction • Avg CMC: {mulliganAdvice.stats.avgCmc}
                  </div>
                </div>
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
                style={{
                  background: "transparent",
                  border: "none",
                  fontSize: "1.5rem",
                  cursor: "pointer",
                  padding: "0 8px"
                }}
              >
                ✕
              </button>
            </div>

            {/* Hand cards in grid */}
            <div style={{ 
              display: "grid", 
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              gap: "8px",
              marginBottom: "1rem"
            }}>
              {sampleHand.map((card, idx) => (
                <CardCell
                  key={`hand-modal-${idx}`}
                  slot={{ card, locked: true, flexOptions: [] }}
                  stacked={false}
                  compact={false}
                />
              ))}
            </div>

            {/* Mulligan Advice */}
            {mulliganAdvice && (
              <div style={{
                marginTop: "1rem",
                padding: "1rem",
                background: mulliganAdvice.stats.winConditions > 0 ? "#fff3cd" : 
                           (mulliganAdvice.decision === "KEEP" ? "#d4edda" : "#f8d7da"),
                border: `2px solid ${mulliganAdvice.stats.winConditions > 0 ? "#ffc107" :
                                     (mulliganAdvice.decision === "KEEP" ? "#28a745" : "#dc3545")}`,
                borderRadius: "8px"
              }}>
                <h3 style={{ 
                  margin: "0 0 0.5rem 0",
                  color: mulliganAdvice.stats.winConditions > 0 ? "#856404" :
                         (mulliganAdvice.decision === "KEEP" ? "#155724" : "#721c24"),
                  fontSize: "1.1rem"
                }}>
                  {mulliganAdvice.stats.winConditions > 0 ? "🏆 KEEP - WIN POSSIBLE!" :
                   (mulliganAdvice.decision === "KEEP" ? "✅ KEEP" : "🔄 MULLIGAN")}
                </h3>
                <div style={{ fontSize: "0.9rem", lineHeight: "1.6" }}>
                  {mulliganAdvice.reasons.map((reason, idx) => (
                    <div key={idx} style={{
                      fontWeight: reason.includes("WIN") || reason.includes("🏆") ? 700 : 400,
                      color: reason.includes("WIN") || reason.includes("🏆") ? "#856404" : "inherit"
                    }}>
                      {reason}
                    </div>
                  ))}
                </div>
                <div style={{ 
                  marginTop: "0.5rem", 
                  fontSize: "0.85rem", 
                  opacity: 0.8,
                  borderTop: "1px solid rgba(0,0,0,0.1)",
                  paddingTop: "0.5rem"
                }}>
                  Stats: {mulliganAdvice.stats.lands} lands • {mulliganAdvice.stats.totalMana} total mana • {mulliganAdvice.stats.fastMana} fast mana • {mulliganAdvice.stats.threats} threats • {mulliganAdvice.stats.cardSelection} selection • {mulliganAdvice.stats.interaction} interaction • Avg CMC: {mulliganAdvice.stats.avgCmc}
                </div>
              </div>
            )}

            {/* Draw new hand button */}
            <button 
              className="btn" 
              onClick={shuffleAndDraw}
              style={{
                width: "100%",
                marginTop: "1rem",
                padding: "12px"
              }}
            >
              🔄 Draw New 7
            </button>
          </div>
        </div>
      )}

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
            <p className="muted" style={{ marginBottom: "12px" }}>Enter card details to add to your mainboard</p>
            <form onSubmit={handleAddCardSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <input
                type="text"
                placeholder="Card Name"
                value={newCardInput.name}
                onChange={(e) => setNewCardInput({ ...newCardInput, name: e.target.value })}
                required
                style={{
                  padding: "8px",
                  borderRadius: "6px",
                  border: "1px solid #e5e7eb",
                  fontSize: "0.9rem"
                }}
              />
              <input
                type="text"
                placeholder="Mana Cost (e.g., 1U or {1}{U})"
                value={newCardInput.manaCost}
                onChange={(e) => setNewCardInput({ ...newCardInput, manaCost: e.target.value })}
                required
                style={{
                  padding: "8px",
                  borderRadius: "6px",
                  border: "1px solid #e5e7eb",
                  fontSize: "0.9rem"
                }}
              />
              <input
                type="text"
                placeholder="Type Line (e.g., Instant, Creature — Human)"
                value={newCardInput.typeLine}
                onChange={(e) => setNewCardInput({ ...newCardInput, typeLine: e.target.value })}
                required
                style={{
                  padding: "8px",
                  borderRadius: "6px",
                  border: "1px solid #e5e7eb",
                  fontSize: "0.9rem"
                }}
              />
              <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                <button
                  type="submit"
                  className="btn"
                  style={{
                    flex: 1,
                    background: "#22c55e",
                    color: "#ffffff"
                  }}
                >
                  Add Card
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddCardModal(false)}
                  className="btn btn--ghost"
                  style={{ flex: 1 }}
                >
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

export default App;
