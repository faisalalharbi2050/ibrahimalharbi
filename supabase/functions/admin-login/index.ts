import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const allowedOrigins = (Deno.env.get("PUBLIC_ALLOWED_ORIGINS") || "")
  .split(",").map((value) => value.trim()).filter(Boolean);
const allowedRoles = new Set(["owner", "admin", "editor", "analyst", "support"]);

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin) || local ? origin : allowedOrigins[0] || "null",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}
function json(req: Request, body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { ...cors(req), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function jwtPayload(token: string) {
  try {
    const encoded = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")));
  } catch { return {}; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);
  const origin = req.headers.get("origin") || "";
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (origin && !local && !allowedOrigins.includes(origin)) return json(req, { error: "origin_not_allowed" }, 403);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const salt = Deno.env.get("ADMIN_LOGIN_RATE_SALT") || Deno.env.get("PUBLIC_RATE_LIMIT_SALT");
  if (!url || !anonKey || !serviceKey || !salt) return json(req, { error: "server_not_configured" }, 500);

  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
  const password = String(body.password || "");
  if (!email || !password || password.length > 512) return json(req, { error: "invalid_credentials" }, 401);

  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("cf-connecting-ip") || "unknown";
  const ipHash = await sha256(`${salt}:ip:${forwarded}`);
  const accountHash = await sha256(`${salt}:account:${email}:${forwarded}`);
  const keys = [ipHash, accountHash];
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: lockedUntil } = await admin.rpc("admin_login_lock_until", { p_keys: keys });
  if (lockedUntil && new Date(lockedUntil).getTime() > Date.now()) {
    const retryAfter = Math.max(1, Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 1000));
    return json(req, { error: "login_locked", retry_after: retryAfter }, 429);
  }

  const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  const role = String(data.user?.app_metadata?.platform_role || data.user?.app_metadata?.role || "");
  if (error || !data.session || !data.user || !allowedRoles.has(role)) {
    let locked: string | null = null;
    let failures = 0;
    for (const key of keys) {
      const { data: result } = await admin.rpc("record_admin_login_failure", { p_key: key, p_max_attempts: 3, p_window_minutes: 15, p_lock_minutes: 15 });
      failures = Math.max(failures, Number(result?.failures || 0));
      if (result?.locked_until) locked = result.locked_until;
    }
    if (data.session) await auth.auth.signOut();
    if (locked) return json(req, { error: "login_locked", retry_after: 900 }, 429);
    return json(req, { error: "invalid_credentials", remaining_attempts: Math.max(0, 3 - failures) }, 401);
  }

  const payload = jwtPayload(data.session.access_token);
  const sessionId = String(payload.session_id || "");
  if (!sessionId) return json(req, { error: "session_not_guarded" }, 503);
  const expiresAt = new Date(Math.min(Number(payload.exp || 0) * 1000 + 11 * 60 * 60 * 1000, Date.now() + 12 * 60 * 60 * 1000)).toISOString();
  const { error: grantError } = await admin.rpc("register_admin_login_session", { p_session_id: sessionId, p_user_id: data.user.id, p_expires_at: expiresAt, p_ip_hash: ipHash });
  if (grantError) return json(req, { error: "session_not_guarded" }, 503);
  await admin.rpc("clear_admin_login_failures", { p_keys: keys });

  return json(req, {
    ok: true,
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
  });
});