import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "missing_supabase_env" }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  const caller = callerData?.user;
  const callerRole = String(caller?.app_metadata?.platform_role || caller?.app_metadata?.role || "");
  const sessionId = sessionIdFromAuthorization(authHeader);
  const { data: guardedSession } = await adminClient.from("admin_login_sessions")
    .select("session_id").eq("session_id", sessionId).eq("user_id", caller?.id || "00000000-0000-0000-0000-000000000000")
    .gt("expires_at", new Date().toISOString()).maybeSingle();
  if (callerError || !caller || !["owner", "admin"].includes(callerRole) || !guardedSession) {
    return json({ error: "admin_auth_required" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const name = String(body.name || "").trim();
  const role = String(body.role || "editor");
  const sections = Array.isArray(body.sections) ? body.sections : [];

  if (!email || !email.includes("@")) return json({ error: "invalid_email" }, 400);
  if (!isValidAdminPassword(password)) return json({ error: "weak_password" }, 400);
  if (!["admin", "editor", "analyst", "support"].includes(role)) {
    return json({ error: "invalid_role" }, 400);
  }

  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, role, sections },
    app_metadata: { role: role === "admin" ? "admin" : "staff", platform_role: role, sections },
  });

  if (error) return json({ error: error.message }, 400);
  return json({ ok: true, userId: data.user?.id || null, email });
});
