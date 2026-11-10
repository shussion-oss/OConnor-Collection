# ⚾ The Dugout: Family Baseball Card Collection

A simple, good-looking web app for a dad and his sons to catalog, enjoy and sell their baseball cards.

## What it does

**Collect**
- **Front & back photos** for every card. Snap them with a phone camera, then tap a card to flip it.
- **✨ Fill in from photos:** the app reads the card from its photos and fills in player, year, set, card #, team, condition, categories and a fun description.
- **Sort & group by Sport, Player, Team, Era or Manufacturer.** Cards appear under headings with a count and value for each group. Eras follow the hobby's names: Pre-War, Post-War Vintage, the Seventies, the Junk Wax Era, Modern and Ultra-Modern.
- **Filter dropdowns** for the same five. They narrow each other: pick Football and the team list shows only football teams.
- **Categories** (Rookie Cards, Hall of Famers, Vintage…), plus filters by collector (Dad, each son) and status. Cards can be baseball, football, basketball, hockey and more.
- **📒 Binder view:** flip through 9-pocket binder pages, just like the real thing. Pick a collector to see only their binder.

**Have fun**
- **🏆 Trophy Case:** 27 trophies to unlock, such as Rookie Scout, Cooperstown Bound, Time Traveler, Gem Mint 10, First Sale and Set Builder. Confetti included.
- **🎯 Chase List:** each collector's want list for card shows. It has an eBay search button, and **Found it!** turns a wanted card into a collection card.
- **📚 Set Checklists:** "1989 Upper Deck: 312 of 800" with a progress bar and a checklist of the numbers you still need.

**Money**
- **💰 Check sold prices** (on the Add/Edit card screen) searches for recent sales of that exact card (eBay sold listings, 130point, PSA auction records, price guides). It shows the **highest sale in the last 6 months**, the typical price, and every sale with its date and a link to check it. One tap uses either price as the estimated value. eBay has no public sold-price data, so this is a web search: always glance at the linked sales. The **See eBay sold listings** button opens eBay's own sold results, highest first.
- **Paid vs. worth:** what was paid, the estimated value and the gain or loss for every card, totaled on the scoreboard.
- **📈 Value over time:** charts for each card and for the whole collection, plus a "Biggest winners" list. Use **Update value** on a card and check **Recent sales** to see what it actually sold for on eBay.
- **Sell on eBay:** the app writes the title (under eBay's 80-character limit), the description and a suggested starting bid (70% of value by default).
  - **Copy & open eBay** works with no setup.
  - **⚡ List it on eBay now** puts the auction up for you with both photos. This needs the online setup below.

**One family collection**
- Every phone that enters the **family code** (Settings) sees the same cards, photos, chase list, sets, trophies and value history.
- Each phone keeps a full copy, so the app opens instantly and works with no signal (at a card show, say). Changes made offline upload when the phone is back online.
- Phones pick up each other's changes when the app opens, when you switch back to it, and every minute while it's open.
- The badge under the title shows the status: ☁️ Family collection, 🔄 Syncing, ⚠️ Offline (with how many changes are waiting), or 📱 This phone only.
- When a phone that already has cards joins, it asks whether to add them to the family collection.
- **Settings → Download backup** still saves a full copy to a file.

## Running it
No build step. It's plain HTML/CSS/JavaScript.

- **Online (recommended):** GitHub Pages (Settings → Pages → Deploy from branch → `main` / root). Open it on a phone and choose "Add to Home Screen".
- **Locally:** `python3 -m http.server` in this folder, then open http://localhost:8000.

## Online features (AI card reading + one-tap eBay listing)

These run on a small [Supabase](https://supabase.com) backend in [`supabase/`](supabase):

| Piece | What it does |
|---|---|
| `functions/identify-card` | Sends the card photos to Claude (Anthropic's AI) and returns the card details |
| `functions/price-check` | Finds recent sold prices for a card (Claude + web search) and works out the highest and typical sale |
| `functions/collection` | The shared family collection: cards, photos (private bucket, signed links), settings and lists |
| `functions/ebay` | Connects his eBay seller account (secure eBay sign-in) and creates the auction listing |
| `migrations/…_init.sql` | eBay connection table + a public `listing-photos` storage bucket (eBay needs photo links) |

Every request needs the **family code**, so strangers who find the site can't use the AI or list items on his account.

### Setup steps
1. **Supabase:** create the project, run the migration, and deploy both functions with **JWT verification off** (they check the family code themselves, and eBay's sign-in redirect can't send a JWT).
2. **Secrets** (Supabase dashboard → Edge Functions → Secrets):
   - `FAMILY_CODE`: any passphrase the family will type into Settings.
   - `ANTHROPIC_API_KEY`: from console.anthropic.com (billed per card read; a few cents each).
   - `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_RUNAME`, `EBAY_ENV` (`production`, or `sandbox` for testing). See step 3.
3. **eBay developer keys** (free, at developer.ebay.com):
   1. Create a developer account, then **Application Keys → Create a keyset** (Production). Copy the App ID (Client ID) and Cert ID (Client Secret).
   2. **User Tokens → Get a Token from eBay via Your Application → Add eBay Redirect URL**. Set:
      - *Auth accepted URL*: `https://<project>.supabase.co/functions/v1/ebay`
      - *Auth declined URL*: `https://<project>.supabase.co/functions/v1/ebay?action=declined`
   3. Copy the **RuName** it creates. That is `EBAY_RUNAME`.
4. **His eBay seller account** needs **Business policies** (shipping, payment, returns). In eBay go to Account → Business policies and create one of each. The app uses the first of each.
5. Put the Supabase URL and anon key in `config.js`.
6. In the app: **Settings → family code + ship-from ZIP → Connect eBay account**.

### Notes
- Auctions are listed in eBay's *Sports Trading Card Singles* category (261328). Graded cards use eBay's grader and grade codes; raw cards use the card-condition code. If eBay rejects a listing, the app shows eBay's message. The **Copy & open eBay** path always works as a backup.
- Prices and "worth" are the family's own estimates. Use **Recent sales** to check real eBay sold prices.
