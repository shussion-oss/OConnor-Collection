// The shared family collection: cards, photos, and family-wide lists.
// Every phone that knows the family code reads and writes the same data.
//
// Secrets: FAMILY_CODE. Provided by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
//   GET  ?action=version      → { version }                    (cheap "anything new?" check)
//   GET  ?action=sync         → { cards, kv, images, version }  (everything; images = signed photo links)
//   POST ?action=put-card     { card, images: { key: { media_type, data } } } → { images, version }
//   POST ?action=delete-card  { id }                          → { version }
//   POST ?action=put-kv       { key, value }                  → { version }
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
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const BUCKET = "card-photos";
const LINK_SECONDS = 7 * 24 * 3600;
const KV_KEYS = new Set(["settings", "wants", "sets", "history", "badges"]);
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/svg+xml"]);

function sameText(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const safeId = (v: unknown) => {
  const s = String(v ?? "");
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(s)) throw new UserError("Bad id");
  return s;
};

// A single row that changes on every write, so phones can cheaply ask "anything new?".
async function bump() {
  const version = new Date().toISOString();
  await db.from("family_kv").upsert({ key: "_version", value: version, updated_at: version });
  return version;
}

async function currentVersion() {
  const { data } = await db.from("family_kv").select("value").eq("key", "_version").maybeSingle();
  return (data?.value as string) ?? null;
}

async function signedLinks(paths: string[]) {
  const links: Record<string, string> = {};
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const { data, error } = await db.storage.from(BUCKET).createSignedUrls(chunk, LINK_SECONDS);
    if (error) throw error;
    for (const row of data ?? []) if (row.signedUrl && row.path) links[row.path] = row.signedUrl;
  }
  return links;
}

// Photos live at "<cardId>/<imageKey>". The app refers to them by imageKey.
const photoPath = (cardId: string, key: string) => `${cardId}/${key}`;

async function sync() {
  const { data: rows, error } = await db.from("cards").select("data");
  if (error) throw error;
  const cards = (rows ?? []).map((r) => r.data);
  const { data: kvRows } = await db.from("family_kv").select("key, value");
  const kv: Record<string, unknown> = {};
  let version: string | null = null;
  for (const r of kvRows ?? []) {
    if (r.key === "_version") version = r.value as string;
    else kv[r.key] = r.value;
  }
  const paths: string[] = [];
  const keyOf: Record<string, string> = {};
  for (const c of cards) {
    for (const key of [c.frontImg, c.backImg]) {
      if (!key) continue;
      const p = photoPath(c.id, key);
      paths.push(p);
      keyOf[p] = key;
    }
  }
  const links = await signedLinks(paths);
  const images: Record<string, string> = {};
  for (const [p, url] of Object.entries(links)) images[keyOf[p]] = url;
  return { cards, kv, images, version };
}

// deno-lint-ignore no-explicit-any
async function putCard(body: any) {
  const card = body?.card;
  if (!card || typeof card !== "object") throw new UserError("Missing card");
  const id = safeId(card.id);
  if (!card.player) throw new UserError("A card needs a player name");

  // Upload any new photos.
  const uploads = Object.entries(body.images ?? {}) as [string, { media_type: string; data: string }][];
  for (const [key, img] of uploads) {
    safeId(key);
    if (key !== card.frontImg && key !== card.backImg) continue;
    if (!IMAGE_TYPES.has(img.media_type)) throw new UserError("Photos must be JPEG or PNG");
    const bytes = Uint8Array.from(atob(img.data), (c) => c.charCodeAt(0));
    if (bytes.length > 8_000_000) throw new UserError("A photo is too large");
    const { error } = await db.storage.from(BUCKET).upload(photoPath(id, key), bytes, { contentType: img.media_type, upsert: true });
    if (error) throw new UserError(`Couldn't save photo: ${error.message}`);
  }

  const { error } = await db.from("cards").upsert({ id, data: card, updated_at: new Date().toISOString() });
  if (error) throw error;

  // Remove photos this card no longer uses (e.g. a re-taken front photo).
  const keep = new Set([card.frontImg, card.backImg].filter(Boolean));
  const { data: files } = await db.storage.from(BUCKET).list(id, { limit: 100 });
  const stale = (files ?? []).filter((f) => !keep.has(f.name)).map((f) => photoPath(id, f.name));
  if (stale.length) await db.storage.from(BUCKET).remove(stale);

  const links = await signedLinks([...keep].map((k) => photoPath(id, k as string)));
  const images: Record<string, string> = {};
  for (const k of keep) if (links[photoPath(id, k as string)]) images[k as string] = links[photoPath(id, k as string)];
  return { images, version: await bump() };
}

// deno-lint-ignore no-explicit-any
async function deleteCard(body: any) {
  const id = safeId(body?.id);
  await db.from("cards").delete().eq("id", id);
  const { data: files } = await db.storage.from(BUCKET).list(id, { limit: 100 });
  if (files?.length) await db.storage.from(BUCKET).remove(files.map((f) => photoPath(id, f.name)));
  return { version: await bump() };
}

// deno-lint-ignore no-explicit-any
async function putKv(body: any) {
  const key = String(body?.key ?? "");
  if (!KV_KEYS.has(key)) throw new UserError("Unknown setting");
  let value = body.value;
  if (key === "settings" && value && typeof value === "object") {
    // The family code is never stored on the server.
    value = { ...value };
    delete value.familyCode;
  }
  const { error } = await db.from("family_kv").upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw error;
  return { version: await bump() };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!sameText(req.headers.get("x-family-code") ?? "", env("FAMILY_CODE"))) {
    return json({ error: "Wrong family code. Check Settings." }, 401);
  }
  const action = new URL(req.url).searchParams.get("action");
  try {
    if (req.method === "GET" && action === "version") return json({ version: await currentVersion() });
    if (req.method === "GET" && action === "sync") return json(await sync());
    if (req.method === "POST") {
      const body = await req.json();
      if (action === "put-card") return json(await putCard(body));
      if (action === "delete-card") return json(await deleteCard(body));
      if (action === "put-kv") return json(await putKv(body));
    }
    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    if (err instanceof UserError) return json({ error: err.message }, 400);
    console.error(err);
    return json({ error: "Something went wrong saving to the family collection." }, 500);
  }
});
