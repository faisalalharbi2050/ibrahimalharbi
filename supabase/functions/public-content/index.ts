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
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    Vary: "Origin",
  };
}

serve(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "GET") return Response.json({ error: "method_not_allowed" }, { status: 405, headers });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return Response.json({ error: "server_not_configured" }, { status: 500, headers });

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await supabase.from("site_data").select("data,updated_at").eq("id", "main").single();
  if (error) return Response.json({ error: "content_unavailable" }, { status: 503, headers });

  return Response.json(
    { data: data.data, updatedAt: data.updated_at },
    {
      headers: {
        ...headers,
        "Cache-Control": "public, max-age=10, s-maxage=30, stale-while-revalidate=120",
        "Content-Type": "application/json; charset=utf-8",
      },
    },
  );
});
