/**
 * Camada de acesso à API do Mercado Livre.
 * Todas as chamadas passam pelas server functions (src/server/ml-oauth.ts)
 * — as credenciais do app ML NUNCA chegam ao browser.
 */
import { mlApiGet, mlApiMutate } from "@/server/ml-oauth";

let _token = "";
let _shopId = "";

export const PROXY_URL = ""; // não mais usado — mantido para compatibilidade de import

export function setToken(token: string) { _token = token; }
export function setShopId(id: string)   { _shopId = id;   }
export function getToken()               { return _token;  }
export function getShopId()              { return _shopId; }

/** GET à API ML via server function */
export async function ml(path: string): Promise<unknown> {
  if (!_token) throw new Error("Não autenticado. Faça login com o Mercado Livre.");
  const text = await mlApiGet({ data: { path, access_token: _token } });
  return JSON.parse(text);
}

/** POST / PUT / DELETE à API ML via server function */
export async function proxyPost(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<unknown> {
  if (!_token) throw new Error("Não autenticado.");
  const text = await mlApiMutate({
    data: {
      method,
      path,
      access_token: _token,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
  });
  return JSON.parse(text);
}

// ── Persistência local (substituindo serverSave/serverLoad do token.php) ──
// Dados ficam no localStorage por shop; podem ser migrados para KV Cloudflare futuramente.

function storageKey(key: string) {
  return `megalabs:${_shopId || "default"}:${key}`;
}

export async function serverSave(key: string, data: unknown): Promise<void> {
  try {
    localStorage.setItem(storageKey(key), JSON.stringify({ data, ts: new Date().toISOString() }));
  } catch {}
}

export async function serverLoad<T>(key: string): Promise<{ data: T; ts: string } | null> {
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return null;
    return JSON.parse(raw) as { data: T; ts: string };
  } catch { return null; }
}

/** Data formatada para a API ML (com timezone) */
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

/** Chunks de array em lotes de N */
export function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Formata valor em BRL */
export function BRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
