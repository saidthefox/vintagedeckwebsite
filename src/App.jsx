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

  // Filter flex options based on search
  const filtered = flexOptions.filter(
    (opt) =>
      opt.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      opt.manaCost.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleAddCard = () => {
    if (newCardName.trim()) {
      const newCard = {
        name: newCardName,
        manaCost: newCardCost || "",
        typeLine: ""
      };
      onAddCard(newCard);
      setNewCardName("");
      setNewCardCost("");
    }
  };

  return (
    <div className="flex-modal-backdrop" onClick={onClose}>
      <div className="flex-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Flex slot choice</h3>
        <p className="muted">Choose which card should occupy this slot.</p>

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
            fontSize: "0.9rem",
            boxSizing: "border-box"
          }}
        />

        <div className="flex-modal__options" style={{ maxHeight: 280, overflowY: "auto", marginBottom: 12 }}>
          <button className="flex-option" onClick={() => onChoose(-1)}>
            <div className="flex-option__card-name">{card.name}</div>
            <div className="flex-option__card-meta">
              {card.manaCost || " "} · {card.typeLine}
            </div>
          </button>
          {filtered.map((opt, idx) => (
            <button
              key={idx}
              className="flex-option"
              onClick={() => onChoose(idx)}
            >
              <div className="flex-option__card-name">{opt.name}</div>
              <div className="flex-option__card-meta">
                {opt.manaCost || " "} · {opt.typeLine}
              </div>
            </button>
          ))}
        </div>

        {/* Add card section */}
        <div style={{ marginBottom: 12, paddingTop: 12, borderTop: "1px solid #e5e7eb" }}>
          <p style={{ margin: "0 0 8px 0", fontSize: "0.85rem", fontWeight: 600 }}>
            Add card
          </p>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <input
              type="text"
              placeholder="Card name"
              value={newCardName}
              onChange={(e) => setNewCardName(e.target.value)}
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
              placeholder="Mana cost"
              value={newCardCost}
              onChange={(e) => setNewCardCost(e.target.value)}
              style={{
                width: "80px",
                padding: "6px 8px",
                borderRadius: "4px",
                border: "1px solid #e5e7eb",
                fontSize: "0.85rem",
                boxSizing: "border-box"
              }}
            />
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

  const [showExportMenu, setShowExportMenu] = React.useState(false);
  const [mainConfig, setMainConfig] = useState(assignFlexOptions(deckData.mainboard));
  const [sideConfig, setSideConfig] = useState(assignSideboardFlexOptions(deckData.sideboard));
  const [selectedFlex, setSelectedFlex] = useState(null);
  const [sampleHand, setSampleHand] = useState([]);
  const [hoveredCard, setHoveredCard] = useState(null);
  const [showAddCardModal, setShowAddCardModal] = useState(false);
  const [addCardBtnText, setAddCardBtnText] = useState("+1 Card to 61");
  const [newCardInput, setNewCardInput] = useState({ name: "", manaCost: "", typeLine: "" });
  const mainColumns = useMemo(
    () => buildCmcColumns(mainConfig),
    [mainConfig]
  );

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
    
    const newCard = {
      card: {
        name: newCardInput.name.trim(),
        manaCost: manaCost,
        typeLine: newCardInput.typeLine.trim()
      },
      count: 1,
      locked: false,
      flexOptions: spellFlexOptions
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

    setSampleHand(shuffled.slice(0, 7));
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
        </section>
      </div>

      {/* Sample hand */}
      <section className="deck-section">
        <h2>Sample Hand</h2>
        {sampleHand.length === 0 ? (
          <p className="muted">
            Click “Shuffle &amp; Draw 7” to see a hand.
          </p>
        ) : (
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
        )}
      </section>

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
