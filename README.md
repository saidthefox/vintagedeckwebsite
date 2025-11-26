# My Vintage Deck - Interactive Deck Builder

A customizable Magic: The Gathering deck visualization and testing tool built with React and Vite. View your deck in a column-based layout, test flex slots, and draw sample hands.

## Features

- 📊 **CMC-based columns** - Organized like MTGO deck view
- 🎨 **Color-coded cards** - Visual distinction by mana color
- 🔄 **Flex slots** - Test different card choices dynamically
- 🎲 **Shuffle & draw** - Test sample opening hands
- 💾 **Export** - Download or copy your deck list
- 📝 **Card notes** - Hover over cards to see strategic notes
- ➕ **Add cards** - Dynamically add a 61st card for testing

## Setup Instructions

### Prerequisites

- Git installed on your computer
- Node.js (v16 or higher) and npm
- A GitHub account

### 1. Clone This Repository

```bash
git clone https://github.com/saidthefox/vintagedeckwebsite.git
cd vintagedeckwebsite
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Add Your Deck

Replace the contents of `src/grixis-tinker-vintage.json` with your own deck data.

**Option A: Manual Conversion**
- Follow the format in the existing JSON file
- See `AI_DECKLIST_INSTRUCTIONS.md` for the exact format

**Option B: Use AI to Convert**
- Give an AI assistant your decklist and the `AI_DECKLIST_INSTRUCTIONS.md` file
- Ask it to convert your list to the proper JSON format
- Save the output to `src/grixis-tinker-vintage.json`

### 4. Customize Your Deck Name

Edit `src/grixis-tinker-vintage.json`:
```json
{
  "deckName": "YourDeckName.dec",
  "format": "Vintage",
  ...
}
```

### 5. Test Locally

```bash
npm run dev
```

Open your browser to `http://localhost:5173` to see your deck.

### 6. Deploy to GitHub Pages

#### A. Update Vite Config

Edit `vite.config.js` and change the repository name:

```javascript
export default defineConfig({
  plugins: [react()],
  base: "/your-repo-name/" // Change this to your repo name
});
```

If using a **custom domain**, set:
```javascript
base: "/"
```

#### B. Create a GitHub Repository

1. Go to [GitHub](https://github.com) and create a new repository
2. Name it whatever you like (e.g., `my-vintage-deck`)
3. Don't initialize with README (we already have one)

#### C. Push Your Code

```bash
git remote remove origin  # Remove the old remote
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
git branch -M main
git push -u origin main
```

#### D. Build and Deploy

```bash
npm run build
npm run deploy
```

This creates a `gh-pages` branch with your built site.

#### E. Enable GitHub Pages

1. Go to your repository on GitHub
2. Click **Settings** → **Pages**
3. Under "Build and deployment":
   - Source: **Deploy from a branch**
   - Branch: **gh-pages** / **(root)**
4. Click **Save**

Your site will be live at: `https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/`

### 7. (Optional) Set Up Custom Domain

1. Buy a domain (e.g., from Namecheap, Google Domains)
2. In your domain registrar's DNS settings, add:
   - **A records** pointing to GitHub's IPs:
     - `185.199.108.153`
     - `185.199.109.153`
     - `185.199.110.153`
     - `185.199.111.153`
   - **CNAME record**: `www` → `YOUR-USERNAME.github.io`

3. In your GitHub repo:
   - Settings → Pages → Custom domain
   - Enter your domain (e.g., `myvintagedeck.com`)
   - Check "Enforce HTTPS" once DNS propagates

4. Update `vite.config.js`:
```javascript
export default defineConfig({
  plugins: [react()],
  base: "/" // Change to / for custom domains
});
```

5. Rebuild and redeploy:
```bash
npm run build
npm run deploy
```

## Customization

### Flex Slot Options

Edit these files to customize which cards appear in flex slot menus:

- `src/spell-flex-options.json` - For spell slots
- `src/land-flex-options.json` - For land slots  
- `src/sideboard-flex-options.json` - For sideboard slots

### Card Notes/Blurbs

Add strategic notes that appear when hovering over cards:

Edit `src/card-blurbs.json`:
```json
{
  "Card Name": {
    "blurb": "Your strategic note about this card..."
  }
}
```

### Colors and Styling

Edit `src/VintageDeckGrid.css` to customize:
- Card colors
- Layout spacing
- Font sizes
- Hover effects

## Project Structure

```
vintagedeckwebsite/
├── src/
│   ├── App.jsx                          # Main application
│   ├── VintageDeckGrid.css             # Styles
│   ├── grixis-tinker-vintage.json      # Your deck data
│   ├── spell-flex-options.json         # Spell flex slots
│   ├── land-flex-options.json          # Land flex slots
│   ├── sideboard-flex-options.json     # Sideboard flex slots
│   └── card-blurbs.json                # Card hover notes
├── vite.config.js                       # Vite configuration
├── package.json                         # Dependencies
└── README.md                            # This file
```

## Development Commands

```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run preview  # Preview production build
npm run deploy   # Deploy to GitHub Pages
```

## Updating Your Deck

1. Edit `src/grixis-tinker-vintage.json` with new cards
2. Rebuild: `npm run build`
3. Redeploy: `npm run deploy`
4. Changes will be live in 1-2 minutes

## Troubleshooting

### Site shows blank page after deploy
- Check `vite.config.js` has correct `base` path
- For repo deployment: `base: "/your-repo-name/"`
- For custom domain: `base: "/"`

### Cards not showing
- Verify JSON syntax in deck file (use a JSON validator)
- Check browser console for errors (F12)

### GitHub Pages not updating
- Wait 1-2 minutes for deployment
- Check Settings → Pages shows "Your site is live"
- Hard refresh your browser (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows)

### CSS/images not loading
- Ensure `base` in `vite.config.js` matches your deployment method
- Clear browser cache

## Contributing

Feel free to fork this project and customize it for your own decks!

## License

MIT License - Feel free to use this for your own deck building needs.

## Credits

Built with React, Vite, and a love for Magic: The Gathering.

---

**Enjoy testing your Vintage deck!** 🎴✨
