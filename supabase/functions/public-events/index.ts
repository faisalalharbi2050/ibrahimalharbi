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
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

function cleanGeo(value: unknown, max = 120) {
  const decoded = String(value || "").replace(/\+/g, " ");
  try { return decodeURIComponent(decoded).trim().slice(0, max); }
  catch { return decoded.trim().slice(0, max); }
}

const GEO_AR_NAMES: Record<string, string> = {
  "saudi arabia": "السعودية", "kingdom of saudi arabia": "السعودية", "sa": "السعودية",
  "united arab emirates": "الإمارات", "uae": "الإمارات", "ae": "الإمارات",
  "kuwait": "الكويت", "kw": "الكويت", "qatar": "قطر", "qa": "قطر", "bahrain": "البحرين", "bh": "البحرين",
  "oman": "عمان", "om": "عمان", "egypt": "مصر", "eg": "مصر", "jordan": "الأردن", "jo": "الأردن",
  "riyadh": "الرياض", "ar riyad": "الرياض", "ar riyadh": "الرياض",
  "jeddah": "جدة", "jidda": "جدة", "makkah": "مكة", "mecca": "مكة", "medina": "المدينة المنورة", "madinah": "المدينة المنورة",
  "dammam": "الدمام", "khobar": "الخبر", "al khobar": "الخبر", "dhahran": "الظهران", "taif": "الطائف",
  "tabuk": "تبوك", "abha": "أبها", "khamis mushait": "خميس مشيط", "buraidah": "بريدة", "buraydah": "بريدة",
  "hail": "حائل", "ha il": "حائل", "najran": "نجران", "jazan": "جازان", "jizan": "جازان", "al ahsa": "الأحساء",
  "eastern province": "المنطقة الشرقية", "eastern region": "المنطقة الشرقية", "makkah province": "منطقة مكة المكرمة", "makkah region": "منطقة مكة المكرمة", "mecca province": "منطقة مكة المكرمة", "mecca region": "منطقة مكة المكرمة", "makkah al mukarramah province": "منطقة مكة المكرمة", "makkah al mukarramah region": "منطقة مكة المكرمة", "riyadh province": "منطقة الرياض", "riyadh region": "منطقة الرياض",
  "al madinah region": "منطقة المدينة المنورة", "madinah region": "منطقة المدينة المنورة", "medina region": "منطقة المدينة المنورة", "qassim province": "منطقة القصيم", "qassim region": "منطقة القصيم", "al qassim region": "منطقة القصيم", "asir province": "منطقة عسير", "asir region": "منطقة عسير",
  "tabuk province": "منطقة تبوك", "hail region": "منطقة حائل", "jazan region": "منطقة جازان", "najran region": "منطقة نجران",
};

function geoAr(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/[\u0600-\u06FF]/.test(raw)) return raw;
  const key = raw.toLowerCase().replace(/[._-]/g, " ").replace(/\s+/g, " ").trim();
  return GEO_AR_NAMES[key] || raw;
}
function publicIp(value: string) {
  if (!value || value === "unknown") return "";
  if (/^(10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[0-1])\.|192\.168\.)/.test(value)) return "";
  if (/^(::1|fc00:|fd00:|fe80:)/i.test(value)) return "";
  return value;
}

function normalizePhone(value: unknown) {
  const raw = clean(value, 30);
  const hasPlus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  return (hasPlus ? "+" : "") + digits;
}

function addMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function collectTrackableIds(data: Record<string, unknown>) {
  const ids = new Set(["collab_wa"]);
  for (const item of Array.isArray(data.social) ? data.social : []) if (item?.id) ids.add(String(item.id));
  for (const book of Array.isArray(data.books) ? data.books : []) {
    const links = Array.isArray(book?.links) ? book.links : [];
    links.forEach((_link: unknown, index: number) => ids.add(String(book.id) + "_link_" + index));
  }
  for (const item of Array.isArray(data.adLinks) ? data.adLinks : []) if (item?.id) ids.add(String(item.id));
  const collab = data.collab as Record<string, unknown> | undefined;
  const plans = Array.isArray(collab?.plans) ? collab.plans as Array<Record<string, unknown>> : [];
  for (const plan of plans) if (plan?.id) ids.add("advert_" + String(plan.id));
  return ids;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function resolveClickGeo(req: Request, supabase: ReturnType<typeof createClient>, ipHash: string, ip: string) {
  const headerRegion = cleanGeo(req.headers.get("x-vercel-ip-country-region") || req.headers.get("x-vercel-ip-region"));
  const headerCity = cleanGeo(req.headers.get("x-vercel-ip-city") || req.headers.get("x-vercel-ip-city-name"));
  const headerTimezone = cleanGeo(req.headers.get("x-vercel-ip-timezone"), 80);
  const fromHeaders = {
    country: geoAr(req.headers.get("x-vercel-ip-country") || ""),
    region: geoAr(headerRegion),
    city: geoAr(headerCity),
    timezone: headerTimezone,
    geo_source: headerCity ? "edge_headers" : "",
  };
  if (fromHeaders.city && fromHeaders.country) return fromHeaders;

  const { data: cached } = await supabase
    .from("public_geo_cache")
    .select("country,region,city,timezone,geo_source,expires_at")
    .eq("ip_hash", ipHash)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (cached) return cached;

  const safeIp = publicIp(ip);
  if (!safeIp) return fromHeaders;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const res = await fetch("https://ipapi.co/" + encodeURIComponent(safeIp) + "/json/", {
      headers: { "Accept": "application/json", "User-Agent": "ibrahimalharbi-analytics/1.0" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return fromHeaders;
    const data = await res.json();
    const geo = {
      country: geoAr(data.country_name || data.country_code || fromHeaders.country),
      region: geoAr(data.region || data.region_code || fromHeaders.region),
      city: geoAr(data.city || fromHeaders.city),
      timezone: cleanGeo(data.timezone || fromHeaders.timezone, 80),
      geo_source: "ipapi",
    };
    await supabase.from("public_geo_cache").upsert({
      ip_hash: ipHash,
      ...geo,
      expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      updated_at: new Date().toISOString(),
    });
    return geo;
  } catch { return fromHeaders; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);
  const origin = req.headers.get("origin") || "";
  const localOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!origin || (!localOrigin && !allowedOrigins.includes(origin))) return json(req, { error: "origin_not_allowed" }, 403);

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 32_768) return json(req, { error: "payload_too_large" }, 413);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const rateSalt = Deno.env.get("PUBLIC_RATE_LIMIT_SALT");
  if (!url || !serviceKey || !rateSalt) return json(req, { error: "server_not_configured" }, 500);

  const body = await req.json().catch(() => null);
  if (body && JSON.stringify(body).length > 32_768) return json(req, { error: "payload_too_large" }, 413);
  const type = clean(body?.type, 32);
  if (!body || !["visit", "click", "collab_request", "collab_request_update"].includes(type)) return json(req, { error: "invalid_event" }, 400);

  const forwarded = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ipHash = await sha256(`${rateSalt}:${forwarded}`);
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  async function consumeRateLimit(key: string, windowSeconds: number) {
    const { data, error } = await supabase.rpc("consume_public_rate_limit", {
      p_key: key,
      p_window_seconds: windowSeconds,
    });
    if (error) throw error;
    return data === true;
  }

  async function rateLimitRetryAfterSeconds(key: string) {
    const { data } = await supabase
      .from("public_rate_limits")
      .select("expires_at")
      .eq("rate_key", key)
      .maybeSingle();
    const expiresAt = data?.expires_at ? new Date(String(data.expires_at)).getTime() : 0;
    return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  }

  if (type === "visit") {
    try {
      if (!(await consumeRateLimit("visit:ip:" + ipHash, 30 * 60))) return json(req, { error: "rate_limited" }, 429);
    } catch { return json(req, { error: "rate_limit_unavailable" }, 503); }
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
    const { data: content, error: contentError } = await supabase
      .from("site_data").select("data").eq("id", "main").single();
    if (contentError || !collectTrackableIds(content?.data || {}).has(linkId)) {
      return json(req, { error: "invalid_click" }, 400);
    }
    try {
      const clickHash = await sha256(linkId);
      if (!(await consumeRateLimit("click:ip:" + ipHash + ":link:" + clickHash, 60))) {
        return json(req, { error: "rate_limited" }, 429);
      }
    } catch { return json(req, { error: "rate_limit_unavailable" }, 503); }
    const geo = await resolveClickGeo(req, supabase, ipHash, forwarded);
    const { error } = await supabase.from("clicks").insert({
      link_id: linkId,
      device: ["mobile", "desktop"].includes(device) ? device : "unknown",
      country: geo.country || null,
      region: geo.region || null,
      city: geo.city || null,
      timezone: geo.timezone || null,
      geo_source: geo.geo_source || null,
      hour: new Date().getUTCHours(),
      ts: new Date().toISOString(),
    });
    return error ? json(req, { error: "event_not_saved" }, 503) : json(req, { ok: true });
  }

  const payload = body.payload || {};

  if (type === "collab_request_update") {
    const requestId = clean(payload.request_id, 80);
    const editToken = clean(payload.edit_token, 160);
    const editTokenHash = editToken ? await sha256(rateSalt + ":edit:" + editToken) : "";
    const patch = {
      plan_id: clean(payload.plan_id, 80) || null,
      plan_title: clean(payload.plan_title, 160) || "\u0637\u0644\u0628 \u0625\u0639\u0644\u0627\u0646",
      name: clean(payload.name, 120),
      phone: normalizePhone(payload.phone),
      company: clean(payload.company, 160),
      product: clean(payload.product, 500),
      platforms: clean(payload.platforms, 300),
      budget: clean(payload.budget, 80) || null,
      notes: clean(payload.notes, 2000),
      edit_used_at: new Date().toISOString(),
      editable_until: new Date().toISOString(),
      edit_token_hash: null,
    };
    if (!requestId || !editTokenHash) return json(req, { error: "invalid_edit_token" }, 403);
    if (!patch.name || !patch.phone || !patch.company || !patch.product || !patch.platforms || !patch.notes) {
      return json(req, { error: "missing_required_fields" }, 400);
    }
    if (!/^\+?[0-9]{8,15}$/.test(patch.phone)) return json(req, { error: "invalid_phone" }, 400);

    try {
      const editKey = "collab:edit:" + await sha256(requestId);
      if (!(await consumeRateLimit(editKey, 10))) return json(req, { error: "rate_limited" }, 429);
    } catch { return json(req, { error: "rate_limit_unavailable" }, 503); }

    const { data: updated, error } = await supabase
      .from("collab_requests")
      .update(patch)
      .eq("id", requestId)
      .eq("edit_token_hash", editTokenHash)
      .is("edit_used_at", null)
      .gt("editable_until", new Date().toISOString())
      .select("request_no, editable_until, edit_used_at")
      .maybeSingle();
    if (error) return json(req, { error: "request_not_saved" }, 503);
    if (!updated) return json(req, { error: "edit_window_closed" }, 403);
    return json(req, { ok: true, requestNo: updated.request_no, editableUntil: updated.editable_until });
  }

  const normalizedPhone = normalizePhone(payload.phone);
  const editToken = crypto.randomUUID() + "-" + crypto.randomUUID();
  const editableUntil = addMinutes(30);
  const request = {
    id: crypto.randomUUID(),
    request_no: "pending",
    plan_id: clean(payload.plan_id, 80) || null,
    plan_title: clean(payload.plan_title, 160) || "طلب إعلان",
    name: clean(payload.name, 120),
    phone: normalizedPhone,
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
    edit_token_hash: await sha256(rateSalt + ":edit:" + editToken),
    editable_until: editableUntil,
    edit_used_at: null,
  };

  if (!request.name || !request.phone || !request.company || !request.product || !request.platforms || !request.notes) {
    return json(req, { error: "missing_required_fields" }, 400);
  }
  if (!/^\+?[0-9]{8,15}$/.test(request.phone)) return json(req, { error: "invalid_phone" }, 400);

  const phoneHash = await sha256(rateSalt + ":phone:" + request.phone);
  const ipRateKey = "collab:ip:" + ipHash;
  const phoneRateKey = "collab:phone:" + phoneHash;
  try {
    const ipAllowed = await consumeRateLimit(ipRateKey, 30 * 60);
    if (!ipAllowed) {
      return json(req, { error: "request_recently_received", retryAfterSeconds: await rateLimitRetryAfterSeconds(ipRateKey) }, 429);
    }
    const phoneAllowed = await consumeRateLimit(phoneRateKey, 12 * 60 * 60);
    if (!phoneAllowed) {
      await supabase.from("public_rate_limits").delete().eq("rate_key", ipRateKey);
      return json(req, { error: "request_recently_received", retryAfterSeconds: await rateLimitRetryAfterSeconds(phoneRateKey) }, 429);
    }
  } catch { return json(req, { error: "rate_limit_unavailable" }, 503); }

  // request_no is assigned server-side by a DB trigger (AB-<seq>); the value
  // sent by the client is ignored. Return the canonical number to the caller.
  const { data: inserted, error } = await supabase
    .from("collab_requests")
    .insert(request)
    .select("request_no")
    .single();
  if (error) {
    await supabase.from("public_rate_limits").delete().in("rate_key", [ipRateKey, phoneRateKey]);
    return json(req, { error: "request_not_saved" }, 503);
  }
  return json(req, {
    ok: true,
    requestId: request.id,
    requestNo: inserted?.request_no || request.request_no,
    editToken,
    editableUntil,
  });
});
