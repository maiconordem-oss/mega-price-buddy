/**
 * Camada de acesso à API do Mercado Livre.
 * Roda inteiramente no browser — usa CORS do ML diretamente.
 * O client_secret NÃO é usado no fluxo PKCE puro.
 */

const ML_CLIENT_ID    = "285337336691848";
const ML_REDIRECT_URI = "https://mega-price-buddy.lovable.app/auth/callback";
const ML_API_BASE     = "https://api.mercadolibre.com";
const ML_AUTH_BASE    = "https://auth.mercadolivre.com.br";

export const PROXY_URL = ""; // mantido para compatibilidade — não usado

let _token  = "";
let _shopId = "";

export function setToken(token: string)  { _token  = token;  }
export function setShopId(id: string)    { _shopId = id;     }
export function getToken()               { return _token;    }
export function getShopId()              { return _shopId;   }
export function getClientId()            { return ML_CLIENT_ID;    }
export function getRedirectUri()         { return ML_REDIRECT_URI; }
export function getAuthBase()            { return ML_AUTH_BASE;    }

/** GET direto à API ML com CORS */
export async function ml(path: string): Promise<unknown> {
  if (!_token) throw new Error("Não autenticado. Conecte o Mercado Livre.");
  const res = await fetch(`${ML_API_BASE}${path}`, {
    headers: { "Authorization": `Bearer ${_token}`, "Accept": "application/json" },
  });
  const json: unknown = await res.json();
  if (!res.ok) {
    const e = json as Record<string, string>;
    throw new Error(e.message || e.error || `ML HTTP ${res.status}`);
  }
  return json;
}

/** POST/PUT/DELETE direto à API ML */
export async function proxyPost(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<unknown> {
  if (!_token) throw new Error("Não autenticado.");
  const res = await fetch(`${ML_API_BASE}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${_token}`,
      "Content-Type":  "application/json",
      "Accept":        "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return { ok: true };
  const json: unknown = await res.json();
  if (!res.ok) {
    const e = json as Record<string, string>;
    throw new Error(e.message || e.error || `ML HTTP ${res.status}`);
  }
  return json;
}

/**
 * Troca code por access_token via PKCE puro (sem client_secret).
 * O ML aceita PKCE sem secret quando o app está configurado como público.
 * Se retornar erro, usa o proxy megalabs.shop como fallback.
 */
export async function exchangeCode(code: string, codeVerifier: string): Promise<{
  access_token: string;
  refresh_token: string;
  user_id: number;
  expires_in: number;
}> {
  const body = new URLSearchParams({
    grant_type:    "authorization_code",
    client_id:     ML_CLIENT_ID,
    code,
    redirect_uri:  ML_REDIRECT_URI,
    code_verifier: codeVerifier,
  });

  // Tenta direto (PKCE puro — funciona se o app ML for "público")
  try {
    const res = await fetch(`${ML_AUTH_BASE}/jms/oauth/token`, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = await res.json() as Record<string, unknown>;
    if (res.ok && json.access_token) {
      return {
        access_token:  String(json.access_token),
        refresh_token: String(json.refresh_token || ""),
        user_id:       Number(json.user_id || 0),
        expires_in:    Number(json.expires_in || 21600),
      };
    }
    // Se falhou, cai no proxy
    throw new Error(String(json.message || json.error || "falha PKCE puro"));
  } catch (directErr) {
    // Fallback: proxy megalabs.shop (com client_secret no servidor)
    const proxyRes = await fetch("https://megalabs.shop/token.php", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action:        "exchange_v2",
        code,
        code_verifier: codeVerifier,
        client_id:     ML_CLIENT_ID,
        redirect_uri:  ML_REDIRECT_URI,
      }),
    });
    const pj = await proxyRes.json() as Record<string, unknown>;
    if (!proxyRes.ok || !pj.access_token) {
      throw new Error(String(pj.message || pj.error || directErr));
    }
    return {
      access_token:  String(pj.access_token),
      refresh_token: String(pj.refresh_token || ""),
      user_id:       Number(pj.user_id || 0),
      expires_in:    Number(pj.expires_in || 21600),
    };
  }
}

/** Renova access_token via refresh_token */
export async function refreshToken(refresh: string): Promise<{ access_token: string; refresh_token: string }> {
  const body = new URLSearchParams({
    grant_type:    "refresh_token",
    client_id:     ML_CLIENT_ID,
    refresh_token: refresh,
  });

  try {
    const res = await fetch(`${ML_AUTH_BASE}/jms/oauth/token`, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = await res.json() as Record<string, unknown>;
    if (res.ok && json.access_token) {
      return { access_token: String(json.access_token), refresh_token: String(json.refresh_token || refresh) };
    }
    throw new Error(String(json.message || json.error || "falha refresh"));
  } catch {
    // Fallback proxy
    const proxyRes = await fetch("https://megalabs.shop/token.php", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "refresh_v2", refresh_token: refresh, client_id: ML_CLIENT_ID }),
    });
    const pj = await proxyRes.json() as Record<string, unknown>;
    if (!proxyRes.ok || !pj.access_token) throw new Error(String(pj.message || pj.error || "falha refresh proxy"));
    return { access_token: String(pj.access_token), refresh_token: String(pj.refresh_token || refresh) };
  }
}

// ── Persistência local por shop ──────────────────────────────────────────────
function storageKey(key: string) {
  return `megalabs:${_shopId || "default"}:${key}`;
}
export async function serverSave(key: string, data: unknown): Promise<void> {
  try { localStorage.setItem(storageKey(key), JSON.stringify({ data, ts: new Date().toISOString() })); } catch {}
}
export async function serverLoad<T>(key: string): Promise<{ data: T; ts: string } | null> {
  try {
    const raw = localStorage.getItem(storageKey(key));
    return raw ? (JSON.parse(raw) as { data: T; ts: string }) : null;
  } catch { return null; }
}

/** Data formatada para a API ML */
export function toMLDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const off  = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs  = Math.abs(off);
  return (
    d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
    "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()) +
    ".000" + sign + pad(Math.floor(abs / 60)) + ":" + pad(abs % 60)
  );
}

export function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function BRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
