import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const allowedOrigins = (Deno.env.get("PUBLIC_ALLOWED_ORIGINS") || "").split(",").map((v) => v.trim()).filter(Boolean);

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin) || local ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { ...cors(req), "Cache-Control": "no-store" } });
}

function sessionId(authHeader: string) {
  try {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const encoded = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return String(JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="))).session_id || "");
  } catch {
    return "";
  }
}

function decodeDataUrl(value: string) {
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([a-z0-9+/=]+)$/i);
  if (!match) return null;
  const subtype = match[1].toLowerCase();
  const ext = subtype === "jpeg" ? "jpg" : subtype;
  const contentType = subtype === "jpeg" ? "image/jpeg" : `image/${subtype}`;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, ext, contentType };
}

function attr(tag: string, name: string) {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match ? match[2].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() : "";
}

function firstMetaContent(html: string, keys: string[]) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const key = (attr(tag, "property") || attr(tag, "name") || attr(tag, "itemprop")).toLowerCase();
    if (keys.includes(key)) {
      const content = attr(tag, "content");
      if (content) return content;
    }
  }
  return "";
}

function firstLinkHref(html: string, relName: string) {
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const rel = attr(tag, "rel").toLowerCase().split(/\s+/);
    if (rel.includes(relName)) {
      const href = attr(tag, "href");
      if (href) return href;
    }
  }
  return "";
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function safePreviewUrl(value: unknown) {
  try {
    const url = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1") return null;
    if (/^(10|127)\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return null;
    return url;
  } catch {
    return null;
  }
}

async function readLinkPreview(req: Request, body: Record<string, unknown>) {
  const pageUrl = safePreviewUrl(body?.url);
  if (!pageUrl) return json(req, { error: "invalid_url" }, 400);

  const pageRes = await fetch(pageUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(9000),
    headers: { "user-agent": "Mozilla/5.0 Link Preview Bot", accept: "text/html,application/xhtml+xml" },
  }).catch(() => null);
  if (!pageRes || !pageRes.ok) return json(req, { error: "page_fetch_failed" }, 502);
  const pageType = (pageRes.headers.get("content-type") || "").toLowerCase();
  if (pageType && !pageType.includes("text/html") && !pageType.includes("application/xhtml")) return json(req, { error: "page_not_html" }, 415);
  const html = (await pageRes.text()).slice(0, 700_000);
  const rawImage = firstMetaContent(html, ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src", "image"]) || firstLinkHref(html, "image_src");
  if (!rawImage) return json(req, { error: "image_not_found" }, 404);

  const imageUrl = safePreviewUrl(new URL(rawImage, pageUrl).href);
  if (!imageUrl) return json(req, { error: "invalid_image_url" }, 400);
  const imageRes = await fetch(imageUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(9000),
    headers: { "user-agent": "Mozilla/5.0 Link Preview Bot", accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.8" },
  }).catch(() => null);
  if (!imageRes || !imageRes.ok) return json(req, { error: "image_fetch_failed" }, 502);
  const imageType = (imageRes.headers.get("content-type") || "").split(";")[0].toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(imageType)) return json(req, { error: "unsupported_image_type" }, 415);
  const bytes = new Uint8Array(await imageRes.arrayBuffer());
  if (bytes.byteLength > 3 * 1024 * 1024) return json(req, { error: "preview_image_too_large" }, 413);

  const title = firstMetaContent(html, ["og:title", "twitter:title"]) || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim();
  return json(req, { ok: true, image: `data:${imageType};base64,${bytesToBase64(bytes)}`, imageUrl: imageUrl.href, title: title.slice(0, 160) });
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
  if (!url || !anonKey || !serviceKey) return json(req, { error: "server_not_configured" }, 500);

  const authHeader = req.headers.get("authorization") || "";
  const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  const caller = callerData.user;
  const role = String(caller?.app_metadata?.platform_role || caller?.app_metadata?.role || "");
  const sid = sessionId(authHeader);
  const { data: guarded } = await adminClient
    .from("admin_login_sessions")
    .select("session_id")
    .eq("session_id", sid)
    .eq("user_id", caller?.id || "00000000-0000-0000-0000-000000000000")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (callerError || !caller || !["owner", "admin", "editor"].includes(role) || !guarded) return json(req, { error: "admin_auth_required" }, 403);

  const body = await req.json().catch(() => null);
  if (String(body?.action || "") === "link-preview") return await readLinkPreview(req, body || {});

  const decoded = decodeDataUrl(String(body?.image || ""));
  if (!decoded) return json(req, { error: "invalid_image" }, 400);
  if (decoded.bytes.byteLength > 2 * 1024 * 1024) return json(req, { error: "image_too_large" }, 413);

  const safeKey = String(body?.key || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 96);
  const path = `content/${safeKey}.${decoded.ext}`;
  const { error: uploadError } = await adminClient.storage
    .from("public-media")
    .upload(path, decoded.bytes, { contentType: decoded.contentType, upsert: true, cacheControl: "31536000" });
  if (uploadError) return json(req, { error: "upload_failed", detail: uploadError.message }, 502);

  const publicUrl = adminClient.storage.from("public-media").getPublicUrl(path).data.publicUrl;
  return json(req, { ok: true, url: publicUrl });
});
