import { projectId, publicAnonKey } from "../../../utils/supabase/info";

export const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;
export const AH: HeadersInit = { Authorization: `Bearer ${publicAnonKey}` };
export const JH: HeadersInit = { ...AH, "Content-Type": "application/json" };

type CacheEntry<T> = {
  expiresAt: number;
  data?: T;
  promise?: Promise<T>;
};

const cache = new Map<string, CacheEntry<any>>();

function now() {
  return Date.now();
}

export function invalidateUrlPrefix(prefix: string) {
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}

export async function getJson<T>(
  url: string,
  opts?: { ttlMs?: number; force?: boolean; signal?: AbortSignal },
): Promise<T> {
  const ttlMs = opts?.ttlMs ?? 30_000;
  const force = !!opts?.force;
  const key = url;

  if (!force) {
    const e = cache.get(key) as CacheEntry<T> | undefined;
    if (e?.data !== undefined && e.expiresAt > now()) return e.data;
    if (e?.promise) return e.promise;
  }

  const p = (async () => {
    const res = await fetch(url, { headers: AH, signal: opts?.signal });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(txt ? txt.slice(0, 240) : `HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  })();

  cache.set(key, { expiresAt: now() + ttlMs, promise: p });

  try {
    const data = await p;
    cache.set(key, { expiresAt: now() + ttlMs, data });
    return data;
  } catch (err) {
    cache.delete(key);
    throw err;
  }
}

