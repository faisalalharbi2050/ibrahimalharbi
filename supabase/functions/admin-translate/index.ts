import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const allowedOrigins = (Deno.env.get("PUBLIC_ALLOWED_ORIGINS") || "").split(",").map(v => v.trim()).filter(Boolean);
function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return { "Access-Control-Allow-Origin": allowedOrigins.includes(origin) || local ? origin : "null", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" };
}
function json(req: Request, body: Record<string, unknown>, status = 200) { return Response.json(body, { status, headers: { ...cors(req), "Cache-Control": "no-store" } }); }
function sessionId(authHeader: string) {
  try {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const encoded = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return String(JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="))).session_id || "");
  } catch { return ""; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);
  const origin = req.headers.get("origin") || "";
  const localOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!origin || (!localOrigin && !allowedOrigins.includes(origin))) return json(req, { error: "origin_not_allowed" }, 403);
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!url || !anonKey || !serviceKey || !anthropicKey) return json(req, { error: "server_not_configured" }, 500);
  const authHeader = req.headers.get("authorization") || "";
  const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  const caller = callerData.user;
  const role = String(caller?.app_metadata?.platform_role || "");
  const sid = sessionId(authHeader);
  const { data: guarded } = await adminClient.from("admin_login_sessions").select("session_id").eq("session_id", sid).eq("user_id", caller?.id || "00000000-0000-0000-0000-000000000000").gt("expires_at", new Date().toISOString()).maybeSingle();
  if (callerError || !caller || !["owner","admin","editor"].includes(role) || !guarded) return json(req, { error: "admin_auth_required" }, 403);
  const body = await req.json().catch(() => null);
  const input = body?.input;
  if (!input || typeof input !== "object" || JSON.stringify(input).length > 5000) return json(req, { error: "invalid_input" }, 400);
  const maxTokens = Math.max(50, Math.min(Number(body?.max_tokens || 300), 800));
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: maxTokens, messages: [{ role: "user", content: "Translate the values to English. Return one JSON object with exactly the same keys and no markdown. Input: " + JSON.stringify(input) }] }),
  });
  if (!response.ok) return json(req, { error: "translation_unavailable" }, 503);
  const result = await response.json();
  const text = String(result?.content?.[0]?.text || "").split(String.fromCharCode(96)).join("").replace(/^json\s*/i, "").trim();
  try { return json(req, { ok: true, translation: JSON.parse(text) }); } catch { return json(req, { error: "invalid_translation" }, 502); }
});
