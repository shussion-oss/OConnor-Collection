# ⚾ The Dugout: Family Baseball Card Collection

A simple, good-looking web app for a dad and his sons to catalog, enjoy and sell their baseball cards.

## What it does
- **Front & back photos** for every card. Snap them with a phone camera, then tap a card to flip it over.
- **Categories:** Rookie Cards, Hall of Famers, Vintage, Autographs and more. You can edit the list in Settings. Filter by category, by collector (Dad, each son) or by status.
- **Card details:** player, year, set, card #, team, condition, grading (PSA/BGS/SGC), and the story behind the card.
- **What we paid vs. what it's worth:** each card shows the price paid, the estimated value and the gain or loss. The scoreboard at the top totals the whole collection.
- **Sell on eBay:** one button builds an eBay-ready **title** (kept under eBay's 80-character limit), a full **description**, and a **suggested starting bid**. The bid is 70% of the estimated value by default and can be changed in Settings. The button copies the title and opens eBay's "create listing" page. Other links show recent eBay sold prices for that card and his eBay page.
- Tracks cards that are **Listed** and **Sold**, including the sold price.
- **Back up & restore:** cards and photos are saved on the device. Download a backup file to keep a copy or move to another device.
- Works offline and can be added to a phone's home screen.

## Running it
No build step. It's plain HTML/CSS/JavaScript.

- **Online (recommended):** turn on GitHub Pages (Settings → Pages → Deploy from branch → `main` / root). The app is then at `https://<user>.github.io/<repo>/`. Open it on a phone and choose "Add to Home Screen".
- **Locally:** `python3 -m http.server` in this folder, then open http://localhost:8000.

## First-time setup
1. Open **Settings** and enter the **eBay username**.
2. Rename the collection if you like, and adjust the categories.
3. Tap **Add Card** and start snapping!

## Note on eBay
eBay doesn't let outside websites fill in a listing for you. So the app prepares everything, copies the title to the clipboard, and opens eBay's listing page signed in to whoever is logged in on that device. Paste the title, description and starting bid, then upload the front and back photos ("Save photos for eBay" downloads them).
