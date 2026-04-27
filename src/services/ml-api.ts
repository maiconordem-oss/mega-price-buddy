/**
 * Serviço central para API do Mercado Livre via token.php (proxy)
 * Todos os GET passam por aqui; POST/DELETE também via proxyPost()
 */

export const PROXY_URL = "https://megalabs.shop/token.php";

let _token = "";
let _shopId = "";

export function setToken(token: string) {
  _token = token;
}
export function setShopId(id: string) {
  _shopId = id;
}
export function getToken() {
  return _token;
}
export function getShopId() {
  return _shopId;
}

/** GET à API ML via proxy (auto-renova 401) */
export async function ml(path: string): Promise<unknown> {
  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "api", path, access_token: _token }),
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data as Record<string, string>;
    throw new Error(err.message || err.error || `HTTP ${res.status}`);
  }
  return data;
}

/** POST/PUT/DELETE à API ML via proxy */
export async function proxyPost(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "api", method, path, access_token: _token, body }),
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data as Record<string, string>;
    throw new Error(err.message || err.error || `HTTP ${res.status}`);
  }
  return data;
}

/** Salva dados no servidor (data_{shopId}_{key}.json) */
export async function serverSave(key: string, data: unknown): Promise<void> {
  await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "server_save", shop_id: _shopId, key, data }),
  });
}

/** Carrega dados do servidor */
export async function serverLoad<T>(key: string): Promise<{ data: T; ts: string } | null> {
  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "server_load", shop_id: _shopId, key }),
  });
  if (!res.ok) return null;
  const j = await res.json().catch(() => null);
  return j?.data != null ? j : null;
}

/** Login usuário no sistema */
export async function loginUser(username: string, passwordHash: string) {
  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", usuario: username, senha_hash: passwordHash }),
  });
  return res.json();
}

/** Busca token ML armazenado para uma loja */
export async function getMLToken(shopId: string): Promise<string | null> {
  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "get_ml_token", shop_id: shopId }),
  });
  const j = await res.json().catch(() => null);
  return j?.access_token ?? null;
}

/** Data formatada para a API ML (com timezone) */
export function toMLDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return (
    d.getFullYear() +
    "-" +
    pad(d.getMonth() + 1) +
    "-" +
    pad(d.getDate()) +
    "T" +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes()) +
    ":" +
    pad(d.getSeconds()) +
    ".000" +
    sign +
    pad(Math.floor(abs / 60)) +
    ":" +
    pad(abs % 60)
  );
}

/** Chunks de array em lotes de N */
export function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** BRL formatter */
export function BRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
