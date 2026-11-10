// eBay connection + one-tap auction listing for the family's seller account.
//
// Secrets: FAMILY_CODE, EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_RUNAME, EBAY_ENV ("production" | "sandbox")
// Provided automatically by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Routes (all on this one function):
//   GET  ?action=status                → { connected }
//   GET  ?action=auth-url&return_to=…  → { url }  (eBay sign-in page)
//   GET  ?code=…&state=…               ← eBay sends the user back here after sign-in
//   POST ?action=list                  → { listingId, url }
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-family-code",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

class UserError extends Error {}

const env = (k: string) => Deno.env.get(k) ?? "";
const SANDBOX = env("EBAY_ENV") === "sandbox";
const API = SANDBOX ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
const AUTH = SANDBOX ? "https://auth.sandbox.ebay.com" : "https://auth.ebay.com";
const ITEM_URL = SANDBOX ? "https://sandbox.ebay.com/itm/" : "https://www.ebay.com/itm/";
const SCOPES = [
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
].join(" ");
const MARKETPLACE = "EBAY_US";
const CATEGORY_TRADING_CARD_SINGLES = "261328";

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

function sameText(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------- OAuth ----------------
const basicAuth = () => "Basic " + btoa(`${env("EBAY_CLIENT_ID")}:${env("EBAY_CLIENT_SECRET")}`);

async function tokenRequest(form: Record<string, string>) {
  const res = await fetch(`${API}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  const data = await res.json();
  if (!res.ok) throw new UserError(`eBay sign-in failed: ${data.error_description || data.error || res.status}`);
  return data as { access_token: string; expires_in: number; refresh_token?: string; refresh_token_expires_in?: number };
}

const inSeconds = (s: number) => new Date(Date.now() + s * 1000).toISOString();

async function accessToken(): Promise<string> {
  const { data: row } = await db.from("ebay_auth").select("*").eq("id", 1).maybeSingle();
  if (!row?.refresh_token) throw new UserError("eBay isn't connected yet. Open Settings → Connect eBay account.");
  if (row.access_token && new Date(row.access_expires_at).getTime() > Date.now() + 120_000) return row.access_token;
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: row.refresh_token, scope: SCOPES });
  await db.from("ebay_auth").update({
    access_token: t.access_token, access_expires_at: inSeconds(t.expires_in), updated_at: new Date().toISOString(),
  }).eq("id", 1);
  return t.access_token;
}

// ---------------- eBay REST helper ----------------
async function ebay(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
      "Accept-Language": "en-US",
      "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  // deno-lint-ignore no-explicit-any
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

// deno-lint-ignore no-explicit-any
function ebayError(step: string, r: { status: number; data: any }) {
  const e = r.data?.errors?.[0];
  return new UserError(`eBay said no while ${step}: ${e?.longMessage || e?.message || `error ${r.status}`}`);
}

// ---------------- Trading card condition codes ----------------
// eBay's Trading Card Singles category needs "condition descriptors".
// Graded → LIKE_NEW (2750) + grader (27501) + grade (27502). Ungraded → USED_VERY_GOOD (4000) + card condition (40001).
const GRADERS: Record<string, string> = { PSA: "275010", BGS: "275013", SGC: "275016", CGC: "275015" };
const GRADES: Record<string, string> = {
  "10": "275020", "9.5": "275021", "9": "275022", "8.5": "275023", "8": "275024", "7.5": "275025",
  "7": "275026", "6.5": "275027", "6": "275028", "5.5": "275029", "5": "2750210", "4.5": "2750211",
  "4": "2750212", "3.5": "2750213", "3": "2750214", "2.5": "2750215", "2": "2750216", "1.5": "2750217", "1": "2750218",
};
const RAW_CONDITION: Record<string, string> = {
  "Gem Mint": "400010", "Mint": "400010", "Near Mint-Mint": "400010", "Near Mint": "400010",
  "Excellent": "400011", "Very Good": "400012", "Good": "400012", "Fair": "400013", "Poor": "400013",
};

// deno-lint-ignore no-explicit-any
function conditionFor(card: any) {
  const grader = GRADERS[card.gradeCompany];
  const grade = GRADES[String(parseFloat(card.grade))];
  if (grader && grade) {
    return {
      condition: "LIKE_NEW",
      conditionDescriptors: [{ name: "27501", values: [grader] }, { name: "27502", values: [grade] }],
    };
  }
  return {
    condition: "USED_VERY_GOOD",
    conditionDescriptors: [{ name: "40001", values: [RAW_CONDITION[card.condition] || "400012"] }],
  };
}

// deno-lint-ignore no-explicit-any
function aspectsFor(card: any) {
  const sport = card.sport && card.sport !== "Other" ? String(card.sport) : "Baseball";
  const a: Record<string, string[]> = { Sport: [sport] };
  const LEAGUES: Record<string, string> = {
    Baseball: "Major League (MLB)", Football: "National Football League (NFL)",
    Basketball: "National Basketball Association (NBA)", Hockey: "National Hockey League (NHL)",
  };
  if (LEAGUES[sport]) a["League"] = [LEAGUES[sport]];
  const cats = (card.categories || []).map((c: string) => c.toLowerCase());
  if (card.player) a["Player/Athlete"] = [card.player];
  if (card.year) { a["Season"] = [String(card.year)]; a["Year Manufactured"] = [String(card.year)]; }
  if (card.brand) a["Manufacturer"] = [card.brand];
  if (card.team) a["Team"] = [card.team];
  if (card.cardNumber) a["Card Number"] = [String(card.cardNumber).replace(/^#/, "")];
  a["Graded"] = [card.gradeCompany ? "Yes" : "No"];
  if (card.gradeCompany) { a["Professional Grader"] = [card.gradeCompany]; if (card.grade) a["Grade"] = [String(card.grade)]; }
  a["Autographed"] = [cats.some((c: string) => c.includes("autograph")) ? "Yes" : "No"];
  if (cats.some((c: string) => c.includes("rookie"))) a["Features"] = ["Rookie"];
  a["Type"] = ["Sports Trading Card"];
  return a;
}

const toHtml = (text: string) =>
  text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)
    .split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");

// ---------------- Listing ----------------
// deno-lint-ignore no-explicit-any
async function listCard(p: any) {
  const sku = String(p.sku || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 50);
  if (!sku) throw new UserError("Missing card id.");
  const title = String(p.title || "").trim().slice(0, 80);
  if (!title) throw new UserError("The listing needs a title.");
  const description = String(p.description || "").slice(0, 20000);
  const start = Math.round(Number(p.startingBid) * 100) / 100;
  if (!(start >= 0.99)) throw new UserError("Starting bid must be at least $0.99.");
  const days = [1, 3, 5, 7, 10].includes(Number(p.durationDays)) ? Number(p.durationDays) : 7;
  const zip = String(p.zip || "").trim();
  if (!/^\d{5}(-\d{4})?$/.test(zip)) throw new UserError("Add a valid ship-from ZIP code in Settings.");
  const images = (p.images || []).slice(0, 2);
  if (!images.length) throw new UserError("Add front/back photos first.");

  const token = await accessToken();

  // 1) Upload photos to public storage so eBay can fetch them.
  const imageUrls: string[] = [];
  for (const [i, img] of images.entries()) {
    const type = img.media_type === "image/png" ? "image/png" : "image/jpeg";
    const bytes = Uint8Array.from(atob(img.data), (c) => c.charCodeAt(0));
    if (bytes.length > 7_000_000) throw new UserError("A photo is too large.");
    const path = `${sku}/${i === 0 ? "front" : "back"}-${Date.now()}.${type === "image/png" ? "png" : "jpg"}`;
    const { error } = await db.storage.from("listing-photos").upload(path, bytes, { contentType: type, upsert: true });
    if (error) throw new UserError(`Couldn't upload photo: ${error.message}`);
    imageUrls.push(db.storage.from("listing-photos").getPublicUrl(path).data.publicUrl);
  }

  // 2) Make sure a ship-from location exists.
  const locKey = `home-${zip.slice(0, 5)}`;
  const loc = await ebay(token, "GET", `/sell/inventory/v1/location/${locKey}`);
  if (!loc.ok) {
    const made = await ebay(token, "POST", `/sell/inventory/v1/location/${locKey}`, {
      location: { address: { postalCode: zip.slice(0, 5), country: "US" } },
      locationTypes: ["WAREHOUSE"],
      merchantLocationStatus: "ENABLED",
      name: "Home",
    });
    if (!made.ok && made.status !== 409) throw ebayError("setting up the ship-from location", made);
  }

  // 3) Use the seller's existing shipping / payment / return policies.
  const policy = async (kind: string, key: string) => {
    const r = await ebay(token, "GET", `/sell/account/v1/${kind}_policy?marketplace_id=${MARKETPLACE}`);
    if (!r.ok) throw ebayError(`reading ${kind} policies`, r);
    const list = r.data[key] || [];
    if (!list.length) {
      throw new UserError(`No ${kind} policy found on the eBay account. In eBay, open Account → Business policies, create one, then try again.`);
    }
    return list[0][`${kind}PolicyId`] as string;
  };
  const listingPolicies = {
    fulfillmentPolicyId: await policy("fulfillment", "fulfillmentPolicies"),
    paymentPolicyId: await policy("payment", "paymentPolicies"),
    returnPolicyId: await policy("return", "returnPolicies"),
  };

  // 4) Create or update the inventory item.
  const item = await ebay(token, "PUT", `/sell/inventory/v1/inventory_item/${sku}`, {
    availability: { shipToLocationAvailability: { quantity: 1 } },
    ...conditionFor(p.card || {}),
    product: { title, description, imageUrls, aspects: aspectsFor(p.card || {}) },
  });
  if (!item.ok) throw ebayError("saving the card details", item);

  // 5) Create (or reuse an unpublished) auction offer.
  const offerBody = {
    sku,
    marketplaceId: MARKETPLACE,
    format: "AUCTION",
    listingDuration: `DAYS_${days}`,
    availableQuantity: 1,
    categoryId: CATEGORY_TRADING_CARD_SINGLES,
    listingDescription: toHtml(description),
    listingPolicies,
    pricingSummary: { auctionStartPrice: { value: start.toFixed(2), currency: "USD" } },
    merchantLocationKey: locKey,
  };
  const existing = await ebay(token, "GET", `/sell/inventory/v1/offer?sku=${sku}&marketplace_id=${MARKETPLACE}`);
  // deno-lint-ignore no-explicit-any
  const old = existing.ok ? (existing.data.offers || []).find((o: any) => o.format === "AUCTION") : null;
  if (old?.status === "PUBLISHED" && old.listing?.listingId) {
    throw new UserError(`This card is already up on eBay: ${ITEM_URL}${old.listing.listingId}`);
  }
  let offerId: string;
  if (old) {
    const upd = await ebay(token, "PUT", `/sell/inventory/v1/offer/${old.offerId}`, offerBody);
    if (!upd.ok) throw ebayError("updating the auction", upd);
    offerId = old.offerId;
  } else {
    const made = await ebay(token, "POST", `/sell/inventory/v1/offer`, offerBody);
    if (!made.ok) throw ebayError("creating the auction", made);
    offerId = made.data.offerId;
  }

  // 6) Publish it.
  const pub = await ebay(token, "POST", `/sell/inventory/v1/offer/${offerId}/publish`);
  if (!pub.ok) throw ebayError("publishing the auction", pub);
  return { listingId: pub.data.listingId, url: `${ITEM_URL}${pub.data.listingId}` };
}

// ---------------- Router ----------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  try {
    // eBay redirect back after sign-in (no family code here; protected by the one-time state value).
    if (url.searchParams.has("state") && (url.searchParams.has("code") || action === "declined")) {
      const state = url.searchParams.get("state")!;
      const { data: row } = await db.from("ebay_oauth_state").delete().eq("state", state).select().maybeSingle();
      const back = (status: string, reason = "") => {
        const to = new URL(row?.return_to || "https://www.ebay.com");
        to.searchParams.set("ebay", status);
        if (reason) to.searchParams.set("reason", reason);
        return Response.redirect(to.toString(), 302);
      };
      if (!row || Date.now() - new Date(row.created_at).getTime() > 15 * 60_000) return back("error", "link expired, please try again");
      const code = url.searchParams.get("code");
      if (!code) return back("error", "sign-in was cancelled");
      try {
        const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: env("EBAY_RUNAME") });
        await db.from("ebay_auth").upsert({
          id: 1,
          refresh_token: t.refresh_token,
          refresh_expires_at: t.refresh_token_expires_in ? inSeconds(t.refresh_token_expires_in) : null,
          access_token: t.access_token,
          access_expires_at: inSeconds(t.expires_in),
          updated_at: new Date().toISOString(),
        });
        return back("connected");
      } catch (err) {
        return back("error", err instanceof Error ? err.message : "unknown");
      }
    }

    if (action === "declined") {
      return new Response("<p style='font:18px sans-serif'>eBay sign-in was cancelled. You can close this page and try again from the app.</p>", {
        headers: { "Content-Type": "text/html" },
      });
    }

    if (!sameText(req.headers.get("x-family-code") ?? "", env("FAMILY_CODE"))) {
      return json({ error: "Wrong family code. Check Settings." }, 401);
    }

    if (action === "status") {
      const { data } = await db.from("ebay_auth").select("refresh_token, refresh_expires_at").eq("id", 1).maybeSingle();
      const connected = !!data?.refresh_token && (!data.refresh_expires_at || new Date(data.refresh_expires_at) > new Date());
      return json({ connected, sandbox: SANDBOX });
    }

    if (action === "auth-url") {
      const returnTo = url.searchParams.get("return_to") || "";
      if (!/^https:\/\/|^http:\/\/localhost(:\d+)?\//.test(returnTo)) return json({ error: "Bad return address" }, 400);
      if (!env("EBAY_CLIENT_ID") || !env("EBAY_RUNAME")) return json({ error: "eBay app keys aren't set up on the server yet." }, 500);
      const state = crypto.randomUUID();
      await db.from("ebay_oauth_state").delete().lt("created_at", new Date(Date.now() - 3600_000).toISOString());
      await db.from("ebay_oauth_state").insert({ state, return_to: returnTo });
      const auth = new URL(`${AUTH}/oauth2/authorize`);
      auth.searchParams.set("client_id", env("EBAY_CLIENT_ID"));
      auth.searchParams.set("redirect_uri", env("EBAY_RUNAME"));
      auth.searchParams.set("response_type", "code");
      auth.searchParams.set("scope", SCOPES);
      auth.searchParams.set("state", state);
      return json({ url: auth.toString() });
    }

    if (action === "list" && req.method === "POST") {
      return json(await listCard(await req.json()));
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    if (err instanceof UserError) return json({ error: err.message }, 400);
    console.error(err);
    return json({ error: "Something went wrong talking to eBay." }, 500);
  }
});
