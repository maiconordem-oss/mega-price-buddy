import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// ── Credenciais do app ML — ficam APENAS no servidor, nunca no browser ──────
const ML_CLIENT_ID     = "285337336691848";
const ML_CLIENT_SECRET = "FppbNCTNuvQJfLfpcGcgDIRFQRpVxYTn";
const ML_REDIRECT_URI  = "https://mega-price-buddy.lovable.app/auth/callback";
const ML_API_BASE      = "https://api.mercadolibre.com";
const ML_AUTH_BASE     = "https://auth.mercadolivre.com.br";

// ── Troca code por access_token (PKCE) ────────────────────────────────────
export const exchangeCodeForToken = createServerFn({ method: "POST" })
  .inputValidator(z.object({ code: z.string(), code_verifier: z.string() }))
  .handler(async ({ data }) => {
    const body = new URLSearchParams({
      grant_type:    "authorization_code",
      client_id:     ML_CLIENT_ID,
      client_secret: ML_CLIENT_SECRET,
      code:          data.code,
      redirect_uri:  ML_REDIRECT_URI,
      code_verifier: data.code_verifier,
    });

    const res = await fetch(`${ML_AUTH_BASE}/jms/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
      body,
    });

    const json = await res.json() as Record<string, unknown>;
    if (!res.ok) throw new Error(String(json.message || json.error || `HTTP ${res.status}`));

    return {
      access_token:  String(json.access_token),
      refresh_token: String(json.refresh_token || ""),
      expires_in:    Number(json.expires_in || 21600),
      user_id:       Number(json.user_id || 0),
    };
  });

// ── Renova access_token via refresh_token ─────────────────────────────────
export const refreshAccessToken = createServerFn({ method: "POST" })
  .inputValidator(z.object({ refresh_token: z.string() }))
  .handler(async ({ data }) => {
    const body = new URLSearchParams({
      grant_type:    "refresh_token",
      client_id:     ML_CLIENT_ID,
      client_secret: ML_CLIENT_SECRET,
      refresh_token: data.refresh_token,
    });

    const res = await fetch(`${ML_AUTH_BASE}/jms/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
      body,
    });

    const json = await res.json() as Record<string, unknown>;
    if (!res.ok) throw new Error(String(json.message || json.error || `HTTP ${res.status}`));

    return {
      access_token:  String(json.access_token),
      refresh_token: String(json.refresh_token || ""),
      expires_in:    Number(json.expires_in || 21600),
    };
  });

// ── Proxy GET para a API ML ───────────────────────────────────────────────
export const mlApiGet = createServerFn({ method: "POST" })
  .inputValidator(z.object({ path: z.string(), access_token: z.string() }))
  .handler(async ({ data }): Promise<string> => {
    const res = await fetch(`${ML_API_BASE}${data.path}`, {
      headers: {
        "Authorization": `Bearer ${data.access_token}`,
        "Accept":        "application/json",
      },
    });

    const text = await res.text();
    if (!res.ok) {
      let msg = `ML API HTTP ${res.status}`;
      try { const j = JSON.parse(text); msg = j.message || j.error || msg; } catch {}
      throw new Error(msg);
    }
    return text; // JSON serializado como string — o cliente faz o parse
  });

// ── Proxy POST/PUT/DELETE para a API ML ──────────────────────────────────
export const mlApiMutate = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    method:       z.enum(["POST", "PUT", "DELETE"]),
    path:         z.string(),
    access_token: z.string(),
    body:         z.string().optional(), // JSON.stringify no cliente
  }))
  .handler(async ({ data }): Promise<string> => {
    const res = await fetch(`${ML_API_BASE}${data.path}`, {
      method: data.method,
      headers: {
        "Authorization": `Bearer ${data.access_token}`,
        "Content-Type":  "application/json",
        "Accept":        "application/json",
      },
      body: data.body,
    });

    if (res.status === 204) return JSON.stringify({ ok: true });
    const text = await res.text();
    if (!res.ok) {
      let msg = `ML API HTTP ${res.status}`;
      try { const j = JSON.parse(text); msg = j.message || j.error || msg; } catch {}
      throw new Error(msg);
    }
    return text;
  });

// ── Gera URL de autorização ML (client_id é público por design OAuth) ────
export const getAuthUrl = createServerFn({ method: "POST" })
  .inputValidator(z.object({ code_challenge: z.string() }))
  .handler(async ({ data }) => {
    const params = new URLSearchParams({
      response_type:         "code",
      client_id:             ML_CLIENT_ID,
      redirect_uri:          ML_REDIRECT_URI,
      code_challenge:        data.code_challenge,
      code_challenge_method: "S256",
    });
    return { url: `${ML_AUTH_BASE}/authorization?${params.toString()}` };
  });
