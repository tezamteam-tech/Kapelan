import { projectId, publicAnonKey } from "../../../utils/supabase/info";

export const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-1df47c03`;
export const AH: HeadersInit = { Authorization: `Bearer ${publicAnonKey}` };
export const JH: HeadersInit = { ...AH, "Content-Type": "application/json" };

type CacheEntry<T> = {
  expiresAt: number;
  staleUntil?: number;
  data?: T;
  promise?: Promise<T>;
};

const cache = new Map<string, CacheEntry<any>>();
const MAX_CACHE_ENTRIES = 250;

// ─── Global network activity (for UI loaders) ────────────────────────────────
let inFlight = 0;
const listeners = new Set<(count: number) => void>();
function emit() {
  for (const fn of listeners) {
    try {
      fn(inFlight);
    } catch {}
  }
}
export function subscribeNetworkActivity(fn: (count: number) => void) {
  listeners.add(fn);
  // immediate sync
  try {
    fn(inFlight);
  } catch {}
  return () => listeners.delete(fn);
}
export function getNetworkInFlightCount() {
  return inFlight;
}

function pruneCache() {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  // Drop oldest-by-expiry first (cheap heuristic)
  const entries = [...cache.entries()].sort((a, b) => (a[1].expiresAt ?? 0) - (b[1].expiresAt ?? 0));
  const drop = Math.max(0, cache.size - MAX_CACHE_ENTRIES);
  for (let i = 0; i < drop; i++) cache.delete(entries[i]![0]);
}

function now() {
  return Date.now();
}

export function invalidateUrlPrefix(prefix: string) {
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}

export function primeJson<T>(url: string, data: T, opts?: { ttlMs?: number; staleTtlMs?: number }) {
  const ttlMs = opts?.ttlMs ?? 30_000;
  const staleTtlMs = opts?.staleTtlMs ?? Math.max(ttlMs * 3, 60_000);
  cache.set(url, { expiresAt: now() + ttlMs, staleUntil: now() + staleTtlMs, data });
  pruneCache();
}

export async function getJson<T>(
  url: string,
  opts?: { ttlMs?: number; force?: boolean; signal?: AbortSignal; swr?: boolean; staleTtlMs?: number },
): Promise<T> {
  const ttlMs = opts?.ttlMs ?? 30_000;
  const force = !!opts?.force;
  const swr = opts?.swr !== false;
  const staleTtlMs = opts?.staleTtlMs ?? Math.max(ttlMs * 3, 60_000);
  const key = url;

  if (!force) {
    const e = cache.get(key) as CacheEntry<T> | undefined;
    const t = now();
    // Fresh
    if (e?.data !== undefined && e.expiresAt > t) return e.data;
    // Stale-while-revalidate: return stale immediately, refresh in background
    if (swr && e?.data !== undefined && (e.staleUntil ?? 0) > t) {
      if (!e.promise) {
        // kick refresh without awaiting
        void getJson<T>(url, { ...opts, force: true, swr: false }).catch(() => null);
      }
      return e.data;
    }
    // Dedupe in-flight
    if (e?.promise) return e.promise;
  }

  const p = (async () => {
    inFlight++;
    emit();
    const res = await fetch(url, { headers: AH, signal: opts?.signal });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(txt ? txt.slice(0, 240) : `HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  })();

  cache.set(key, { expiresAt: now() + ttlMs, staleUntil: now() + staleTtlMs, promise: p });
  pruneCache();

  try {
    const data = await p;
    cache.set(key, { expiresAt: now() + ttlMs, staleUntil: now() + staleTtlMs, data });
    pruneCache();
    return data;
  } catch (err) {
    cache.delete(key);
    throw err;
  } finally {
    inFlight = Math.max(0, inFlight - 1);
    emit();
  }
}

