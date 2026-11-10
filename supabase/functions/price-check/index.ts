// Looks up recent sold prices for a card and reports the highest sale in the last 6 months.
// eBay offers no public sold-price API, so Claude searches the web (eBay sold listings,
// auction-record sites, price guides) and reports each sale it actually saw, with date and link.
// The highest / typical prices are computed here from those sales, not by the model.
// Secrets: ANTHROPIC_API_KEY, FAMILY_CODE
import Anthropic from "npm:@anthropic-ai/sdk";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-family-code",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function sameText(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const MONTHS = 6;

const REPORT_TOOL = {
  name: "report_sales",
  description: "Report the sold sales you found for this card. Call this exactly once, at the end.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["sales", "notes"],
    properties: {
      sales: {
        type: "array",
        description: "Completed sales of this exact card that you actually saw on a page, newest first. Up to 15.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["price", "date", "title", "url", "source", "condition"],
          properties: {
            price: { type: "number", description: "Final sale price in US dollars, not including shipping" },
            date: { type: "string", description: "Sale date as YYYY-MM-DD" },
            title: { type: "string", description: "Listing title as shown" },
            url: { type: "string", description: "Link to the page where you saw this sale" },
            source: { type: "string", description: "Site name, e.g. eBay, 130point, PSA Auction Prices" },
            condition: { type: "string", description: "Raw, or grader + grade like PSA 9" },
          },
        },
      },
      notes: {
        type: "string",
        description: "One or two plain sentences: how closely the sales match this card, and anything to watch out for.",
      },
    },
  },
};

const SYSTEM = `You look up what a specific sports trading card has actually SOLD for, for a family's collection app.
Search for completed (sold) sales, not active listings or asking prices. Good sources: eBay sold/completed listings, 130point.com, PSA Auction Prices Realized, PriceCharting/SportsCardsPro, Goldin, Heritage.
Only report a sale you actually saw on a page, with its price, date and link. Never estimate or invent a sale.
Match the exact card: same player, year, set/brand and card number. Match the grading too: a raw card's comparisons are raw sales; a PSA 9's comparisons are PSA 9 sales. Leave out lots, reprints, different parallels or variations, and different grades.
Only include sales from the last ${MONTHS} months before the date you are given.
When you are done, call report_sales once. If you found nothing reliable, call it with an empty list and say why in notes.`;

const describeCard = (c: Record<string, unknown>) =>
  [
    c.sport && `Sport: ${c.sport}`,
    c.player && `Player: ${c.player}`,
    c.year && `Year: ${c.year}`,
    c.brand && `Set / manufacturer: ${c.brand}`,
    c.cardNumber && `Card number: ${c.cardNumber}`,
    c.team && `Team: ${c.team}`,
    c.gradeCompany ? `Graded: ${c.gradeCompany} ${c.grade || ""}`.trim() : `Ungraded (raw)${c.condition ? `, about ${c.condition}` : ""}`,
    Array.isArray(c.categories) && c.categories.length && `Notes: ${(c.categories as string[]).join(", ")}`,
  ].filter(Boolean).join("\n");

type Sale = { price: number; date: string; title: string; url: string; source: string; condition: string };

function summarize(sales: Sale[], today: Date) {
  const cutoff = new Date(today);
  cutoff.setMonth(cutoff.getMonth() - MONTHS);
  const valid = sales
    .filter((s) => typeof s.price === "number" && s.price > 0 && /^https?:\/\//.test(s.url))
    .filter((s) => {
      const d = new Date(s.date + "T00:00:00Z");
      return !isNaN(d.getTime()) && d >= cutoff && d <= new Date(today.getTime() + 86400000);
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  const prices = valid.map((s) => s.price).sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const typical = prices.length ? (prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2) : null;
  const highest = valid.reduce<Sale | null>((best, s) => (!best || s.price > best.price ? s : best), null);
  return { sales: valid, highest, typical: typical == null ? null : Math.round(typical * 100) / 100, count: valid.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  if (!sameText(req.headers.get("x-family-code") ?? "", Deno.env.get("FAMILY_CODE") ?? "")) {
    return json({ error: "Wrong family code. Check Settings." }, 401);
  }

  let card: Record<string, unknown>;
  try {
    ({ card } = await req.json());
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  if (!card?.player) return json({ error: "Enter at least the player name first." }, 400);

  const today = new Date();
  const todayText = today.toISOString().slice(0, 10);
  const client = new Anthropic();
  // deno-lint-ignore no-explicit-any
  const messages: any[] = [{
    role: "user",
    content: `Today is ${todayText}. Find what this card has sold for in the last ${MONTHS} months:\n\n${describeCard(card)}`,
  }];

  try {
    for (let turn = 0; turn < 6; turn++) {
      const params = {
        model: "claude-opus-5-5",
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low" },
        system: SYSTEM,
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: 8 },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6 },
          REPORT_TOOL,
        ],
        messages,
      };
      // deno-lint-ignore no-explicit-any
      const response = await client.beta.messages.create(params as any);

      if (response.stop_reason === "refusal") return json({ error: "Couldn't look up this card. Try the eBay link instead." }, 422);
      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content });
        continue; // the server resumes its search where it left off
      }
      const report = response.content.find((b) => b.type === "tool_use" && b.name === "report_sales");
      if (report && report.type === "tool_use") {
        if (response.stop_reason === "max_tokens") break;
        const input = report.input as { sales: Sale[]; notes: string };
        return json({ ...summarize(input.sales || [], today), notes: input.notes || "", checkedOn: todayText });
      }
      if (response.stop_reason === "end_turn") {
        // It finished without reporting: ask once more for the report.
        messages.push({ role: "assistant", content: response.content });
        messages.push({ role: "user", content: "Please call report_sales now with what you found." });
        continue;
      }
      break;
    }
    return json({ error: "The search didn't finish. Try again in a minute." }, 504);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json({ error: "Busy right now. Try again in a minute." }, 429);
    if (err instanceof Anthropic.AuthenticationError) return json({ error: "The AI key on the server is missing or wrong." }, 500);
    if (err instanceof Anthropic.APIError) return json({ error: `AI service error (${err.status}).` }, 502);
    console.error(err);
    return json({ error: "Something went wrong checking prices." }, 500);
  }
});
