'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    cache: 'no-store',
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = body?.error ?? {};
    throw new ApiError(err.message ?? `Request failed (${res.status})`, res.status, err.code, err.details);
  }
  return body as T;
}

/** Admin API (through the dashboard's server-side proxy). */
export const admin = {
  get: <T,>(path: string) => request<T>(`/api/backend${path}`),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(`/api/backend${path}`, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T,>(path: string, body: unknown) => request<T>(`/api/backend${path}`, { method: 'PATCH', body: JSON.stringify(body) }),
};

/** Fetch + refetch helper. `reload()` re-runs; data stays visible while refreshing. */
export function useAdmin<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [settled, setSettled] = useState(false);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    admin
      .get<T>(path)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e : new ApiError(String(e), 0));
      })
      .finally(() => {
        if (!cancelled) setSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [path, version]);

  return { data, error, loading: !settled, reload };
}

export interface LiveEvent {
  type: string;
  order_id?: string;
  status?: string;
  protocol?: string;
  at: string;
}

type Listener = (e: LiveEvent) => void;
const listeners = new Set<Listener>();
const statusListeners = new Set<() => void>();
let source: EventSource | null = null;
let status: 'connecting' | 'live' | 'offline' = 'connecting';

function setStatus(s: typeof status) {
  status = s;
  statusListeners.forEach((l) => l());
}

function ensureSource() {
  if (source || typeof window === 'undefined') return;
  source = new EventSource('/api/backend/events');
  source.addEventListener('ready', () => setStatus('live'));
  source.onerror = () => setStatus(source?.readyState === EventSource.CLOSED ? 'offline' : 'connecting');
  const types = ['order.created', 'order.updated', 'mandate.created', 'mandate.revoked', 'product.updated'];
  for (const t of types) {
    source.addEventListener(t, (msg) => {
      const e = JSON.parse((msg as MessageEvent).data) as LiveEvent;
      listeners.forEach((l) => l(e));
    });
  }
}

/** Subscribe to the console's live event stream (one shared SSE connection). */
export function useLiveEvents(onEvent: Listener) {
  const ref = useRef(onEvent);
  useEffect(() => {
    ref.current = onEvent;
  });
  useEffect(() => {
    ensureSource();
    const l: Listener = (e) => ref.current(e);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
}

function subscribeStatus(cb: () => void) {
  ensureSource();
  statusListeners.add(cb);
  return () => {
    statusListeners.delete(cb);
  };
}

export function useLiveStatus() {
  return useSyncExternalStore(subscribeStatus, () => status, () => 'connecting' as const);
}

/** Re-run `reload` whenever a matching live event arrives (debounced). */
export function useLiveReload(reload: () => void, filter: (e: LiveEvent) => boolean = () => true) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLiveEvents((e) => {
    if (!filter(e)) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(reload, 250);
  });
}
