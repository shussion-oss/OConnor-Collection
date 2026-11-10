// Reads a sports card from its photos and suggests the details for the "Add a Card" form.
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

const CATEGORIES = [
  "Rookie Cards", "Hall of Famers", "Vintage (pre-1980)", "Superstars",
  "Autographs", "Inserts & Parallels", "Commons",
];
const CONDITIONS = [
  "", "Gem Mint", "Mint", "Near Mint-Mint", "Near Mint", "Excellent", "Very Good", "Good", "Fair", "Poor",
];

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "sport", "player", "year", "brand", "cardNumber", "team", "position",
    "gradeCompany", "grade", "condition", "categories", "description",
  ],
  properties: {
    sport: {
      type: "string",
      enum: ["Baseball", "Football", "Basketball", "Hockey", "Soccer", "Golf", "Racing", "Wrestling", "Other"],
    },
    player: { type: "string", description: "Player's full name, or empty if unreadable" },
    year: { type: "string", description: "4-digit card year (copyright year on the back), or empty" },
    brand: { type: "string", description: "Manufacturer / set, e.g. Topps, Topps Chrome, Fleer, Upper Deck" },
    cardNumber: { type: "string", description: "Card number printed on the card, digits/letters only, no #" },
    team: { type: "string" },
    position: { type: "string", description: "Abbreviation like P, C, 1B, SS, OF" },
    gradeCompany: { type: "string", enum: ["", "PSA", "BGS", "SGC", "CGC"] },
    grade: { type: "string", description: "Numeric grade on the slab label, or empty" },
    condition: { type: "string", enum: CONDITIONS },
    categories: { type: "array", items: { type: "string", enum: CATEGORIES } },
    description: { type: "string" },
  },
};

const SYSTEM = `You identify sports trading cards (mostly baseball) from photos for a family's collection app (a dad and his sons).
Read only what the photos show: the name, team, set logo, card number, copyright year on the back, and any grading slab label.
Leave a field as an empty string when you cannot read it or are unsure. Never guess a card number or year you cannot see.
For an ungraded card, estimate "condition" from visible corners, edges, centering and surface. Leave it empty if the photo is too unclear.
Pick categories only when you are confident (for example, the card shows an RC logo or says "Rookie" → Rookie Cards; a Hall of Fame player → Hall of Famers; year before 1980 → Vintage (pre-1980)).
Write "description" as 1–3 friendly sentences a kid would enjoy: who the player is and what is notable about this card. Do not mention prices or values.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const expected = Deno.env.get("FAMILY_CODE") ?? "";
  if (!sameText(req.headers.get("x-family-code") ?? "", expected)) {
    return json({ error: "Wrong family code. Check Settings." }, 401);
  }

  let images: { media_type: string; data: string }[] = [];
  try {
    ({ images } = await req.json());
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  images = (images || []).slice(0, 2).filter(
    (i) => (i.media_type === "image/jpeg" || i.media_type === "image/png") && typeof i.data === "string" && i.data.length < 7_000_000,
  );
  if (!images.length) return json({ error: "Please add a JPEG or PNG photo of the card." }, 400);

  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  try {
    const params = {
      model: "claude-opus-5-5",
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{
        role: "user",
        content: [
          ...images.map((img, i) => [
            { type: "text", text: i === 0 ? "Front of the card:" : "Back of the card:" },
            { type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } },
          ]).flat(),
          { type: "text", text: "Fill in this card's details." },
        ],
      }],
    };
    // deno-lint-ignore no-explicit-any
    const response = await client.beta.messages.create(params as any);

    if (response.stop_reason === "refusal") {
      return json({ error: "Couldn't read that card. Please fill it in by hand." }, 422);
    }
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return json({ error: "No answer came back. Try again." }, 502);
    const result = JSON.parse(text.text);
    result.year = /^\d{4}$/.test(result.year) ? Number(result.year) : null;
    return json(result);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json({ error: "Busy right now. Try again in a minute." }, 429);
    if (err instanceof Anthropic.AuthenticationError) return json({ error: "The AI key on the server is missing or wrong." }, 500);
    if (err instanceof Anthropic.APIError) return json({ error: `AI service error (${err.status}).` }, 502);
    console.error(err);
    return json({ error: "Something went wrong reading the card." }, 500);
  }
});
