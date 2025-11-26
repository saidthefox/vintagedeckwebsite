# AI Instructions: Converting Decklists to JSON Format

When a user provides a Magic: The Gathering decklist, convert it to the JSON format used by this deck builder application.

## Input Format
Users will typically provide decklists in MTGO format:
```
4 Force of Will
1 Ancestral Recall
4 Brainstorm
3 Mox Sapphire
...

Sideboard:
2 Hurkyl's Recall
3 Flusterstorm
...
```

## Output Format

### Main Deck JSON Structure (`grixis-tinker-vintage.json`)
```json
{
  "deckName": "DeckName.dec",
  "format": "Vintage",
  "mainboard": [
    {
      "card": {
        "name": "Card Name",
        "manaCost": "{U}",
        "typeLine": "Instant"
      },
      "count": 4,
      "locked": false,
      "flexOptions": []
    }
  ],
  "sideboard": [
    {
      "card": {
        "name": "Card Name",
        "manaCost": "{2}{U}",
        "typeLine": "Instant"
      },
      "count": 2,
      "locked": false,
      "flexOptions": []
    }
  ]
}
```

## Field Specifications

### `deckName`
- String: The name of the deck file (e.g., "5cTinker.dec")
- Ask user or derive from context

### `format`
- String: "Vintage", "Legacy", "Modern", etc.
- Ask user if not specified

### Mainboard/Sideboard Entries

Each card entry has:

1. **`card`** object:
   - `name`: Full card name (string)
   - `manaCost`: Mana symbols in `{X}` format (string)
     - Examples: `"{U}"`, `"{2}{U}{U}"`, `"{3}"`, `"{B}{R}"`
     - For colorless: `"{1}"`, `"{2}"`, etc.
     - For hybrid: `"{U/B}"`, `"{2/R}"`
     - For Phyrexian: `"{U/P}"`
   - `typeLine`: Card type line (string)
     - Examples: `"Instant"`, `"Creature — Human Wizard"`, `"Artifact"`, `"Land"`

2. **`count`**: Number of copies (integer, 1-4 typically)

3. **`locked`**: Whether the card is flex-able (boolean)
   - `false` for most cards (allows flex slots)
   - `true` for core cards that shouldn't be swapped

4. **`flexOptions`**: Array of alternative cards (initially empty `[]`)

## Card Type Guidelines

### Lands
- `typeLine`: `"Land"` or `"Land — Plains"`, etc.
- `manaCost`: Empty string `""`

### Artifacts
- `typeLine`: `"Artifact"` or `"Artifact — Equipment"`, etc.
- Include colorless mana in `manaCost`

### Creatures
- `typeLine`: `"Creature — [Type]"` (e.g., `"Creature — Human Wizard"`)

### Spells
- `typeLine`: `"Instant"`, `"Sorcery"`, `"Enchantment"`, etc.

## Example Conversion

### Input:
```
4 Force of Will
1 Ancestral Recall
4 Mox Sapphire
3 Underground Sea

Sideboard:
2 Hurkyl's Recall
```

### Output:
```json
{
  "deckName": "UserDeck.dec",
  "format": "Vintage",
  "mainboard": [
    {
      "card": {
        "name": "Force of Will",
        "manaCost": "{3}{U}{U}",
        "typeLine": "Instant"
      },
      "count": 4,
      "locked": false,
      "flexOptions": []
    },
    {
      "card": {
        "name": "Ancestral Recall",
        "manaCost": "{U}",
        "typeLine": "Instant"
      },
      "count": 1,
      "locked": false,
      "flexOptions": []
    },
    {
      "card": {
        "name": "Mox Sapphire",
        "manaCost": "{0}",
        "typeLine": "Artifact"
      },
      "count": 4,
      "locked": false,
      "flexOptions": []
    },
    {
      "card": {
        "name": "Underground Sea",
        "manaCost": "",
        "typeLine": "Land — Island Swamp"
      },
      "count": 3,
      "locked": false,
      "flexOptions": []
    }
  ],
  "sideboard": [
    {
      "card": {
        "name": "Hurkyl's Recall",
        "manaCost": "{1}{U}",
        "typeLine": "Instant"
      },
      "count": 2,
      "locked": false,
      "flexOptions": []
    }
  ]
}
```

## Important Notes

1. **Mana Cost Formatting**: Always use curly braces `{}` around each mana symbol
2. **Type Lines**: Use proper Magic card type formatting
3. **Card Names**: Use exact official card names
4. **Counts**: Sum up duplicates (if user lists "Force of Will" twice, combine into one entry with count 4)
5. **Locked**: Default to `false` unless user specifies certain cards as "core" or "locked"
6. **FlexOptions**: Always start as empty array `[]`

## Where to Save

Save the converted JSON to: `src/grixis-tinker-vintage.json` (or use the deck name)

## Follow-up Questions to Ask User

1. "What would you like to name this deck?" (for `deckName`)
2. "What format is this deck?" (for `format`)
3. "Are there any cards that should be locked (non-flex)?" (for `locked` field)
4. "Would you like me to add any flex slot options for specific cards?"
