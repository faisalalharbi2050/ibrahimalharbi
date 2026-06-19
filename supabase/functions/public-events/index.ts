import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const allowedOrigins = (Deno.env.get("PUBLIC_ALLOWED_ORIGINS") || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin) || local ? origin : allowedOrigins[0] || "null",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { ...cors(req), "Content-Type": "application/json; charset=utf-8" } });
}

function clean(value: unknown, max: number) {
  return String(value || "").trim().slice(0, max);
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);
  const origin = req.headers.get("origin") || "";
  const localOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (origin && !localOrigin && !allowedOrigins.includes(origin)) return json(req, { error: "origin_not_allowed" }, 403);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const rateSalt = Deno.env.get("PUBLIC_RATE_LIMIT_SALT");
  if (!url || !serviceKey || !rateSalt) return json(req, { error: "server_not_configured" }, 500);

  const body = await req.json().catch(() => null);
  const type = clean(body?.type, 32);
  if (!body || !["visit", "click", "collab_request"].includes(type)) return json(req, { error: "invalid_event" }, 400);

  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ipHash = await sha256(`${rateSalt}:${forwarded}`);
  const windowMs = type === "visit" ? 30 * 60_000 : type === "collab_request" ? 10 * 60_000 : 60_000;
  const bucket = new Date(Math.floor(Date.now() / windowMs) * windowMs).toISOString();
  const clickKey = type === "click" ? clean(body.payload?.link_id, 120) : type;
  const rateKey = `${type}:${clickKey}:${ipHash}`;
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { error: rateError } = await supabase.from("event_rate_limits").insert({ rate_key: rateKey, bucket });
  if (rateError?.code === "23505") return json(req, { error: "rate_limited" }, 429);
  if (rateError) return json(req, { error: "rate_limit_unavailable" }, 503);

  if (Math.random() < 0.01) await supabase.rpc("purge_expired_public_data");

  if (type === "visit") {
    const visitDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Riyadh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const { data, error } = await supabase.rpc("record_daily_visit", { p_visit_date: visitDate });
    return error
      ? json(req, { error: "visit_not_saved" }, 503)
      : json(req, { ok: true, count: Number(data || 0) });
  }

  if (type === "click") {
    const linkId = clean(body.payload?.link_id, 120);
    const device = clean(body.payload?.device, 20);
    if (!linkId) return json(req, { error: "invalid_click" }, 400);
    const { error } = await supabase.from("clicks").insert({
      link_id: linkId,
      device: ["mobile", "desktop"].includes(device) ? device : "unknown",
      hour: new Date().getUTCHours(),
      ts: new Date().toISOString(),
    });
    return error ? json(req, { error: "event_not_saved" }, 503) : json(req, { ok: true });
  }

  const payload = body.payload || {};
  const request = {
    id: clean(payload.id, 80),
    request_no: clean(payload.request_no, 80),
    plan_id: clean(payload.plan_id, 80) || null,
    plan_title: clean(payload.plan_title, 160) || "طلب إعلان",
    name: clean(payload.name, 120),
    phone: clean(payload.phone, 30),
    company: clean(payload.company, 160),
    product: clean(payload.product, 500),
    platforms: clean(payload.platforms, 300),
    budget: clean(payload.budget, 80) || null,
    notes: clean(payload.notes, 2000),
    status: "new",
    archived: false,
    internal_notes: "",
    consent: true,
    legal_acknowledgement: true,
  };

  if (!request.id || !request.request_no || !request.name || !request.phone || !request.company || !request.product || !request.platforms || !request.notes) {
    return json(req, { error: "missing_required_fields" }, 400);
  }
  if (!/^\+?[0-9\s-]{8,20}$/.test(request.phone)) return json(req, { error: "invalid_phone" }, 400);

  const { error } = await supabase.from("collab_requests").insert(request);
  return error ? json(req, { error: "request_not_saved" }, 503) : json(req, { ok: true, requestNo: request.request_no });
});
