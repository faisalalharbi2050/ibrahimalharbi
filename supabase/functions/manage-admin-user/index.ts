import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function isValidAdminPassword(password: string) {
  return (password.match(/\p{L}/gu) || []).length >= 6 && (password.match(/\p{N}/gu) || []).length >= 4;
}

function sessionIdFromAuthorization(authHeader: string) {
  try {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const encoded = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")));
    return String(payload.session_id || "");
  } catch { return ""; }
}
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return json({ error: "missing_supabase_env" }, 500);

  const authHeader = req.headers.get("Authorization") || "";
  const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  const callerRole = String(callerData.user?.app_metadata?.platform_role || callerData.user?.app_metadata?.role || "");
  const sessionId = sessionIdFromAuthorization(authHeader);
  const { data: guardedSession } = await adminClient.from("admin_login_sessions")
    .select("session_id").eq("session_id", sessionId).eq("user_id", callerData.user?.id || "00000000-0000-0000-0000-000000000000")
    .gt("expires_at", new Date().toISOString()).maybeSingle();
  if (callerError || !callerData.user || callerRole !== "owner" || !guardedSession) {
    return json({ error: "admin_auth_required" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  const userId = String(body.userId || "");
  if (!userId || !["update", "delete"].includes(action)) return json({ error: "invalid_request" }, 400);
  if (userId === callerData.user.id) return json({ error: "cannot_modify_current_user" }, 400);

  if (action === "delete") {
    const { error } = await adminClient.auth.admin.deleteUser(userId);
    return error ? json({ error: error.message }, 400) : json({ ok: true });
  }

  const role = String(body.role || "editor");
  if (!["admin", "editor", "analyst", "support"].includes(role)) return json({ error: "invalid_role" }, 400);
  const sections = Array.isArray(body.sections) ? body.sections.map(String).slice(0, 20) : [];
  const active = body.active !== false;
  const password = String(body.password || "");
  if (password && !isValidAdminPassword(password)) return json({ error: "weak_password" }, 400);
  const { error } = await adminClient.auth.admin.updateUserById(userId, {
    ban_duration: active ? "none" : "876000h",
    user_metadata: { name: String(body.name || "").slice(0, 120), role, sections },
    app_metadata: { role: role === "admin" ? "admin" : "staff", platform_role: role, sections },
    ...(password ? { password } : {}),
  });
  return error ? json({ error: error.message }, 400) : json({ ok: true });
});
