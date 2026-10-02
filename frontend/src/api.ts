import { storage } from "@/src/utils/storage";

import { AspectRatio, TemplateId } from "./templates";

const BASE = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api`;

// In-memory session token; set by AuthContext. Cleared on logout / 401.
let sessionToken: string | null = null;
let onUnauthorized: (() => void) | null = null;
export const setSessionToken = (t: string | null) => {
  sessionToken = t;
};
export const setUnauthorizedHandler = (fn: (() => void) | null) => {
  onUnauthorized = fn;
};

export type AuthUser = { user_id: string; email: string; name: string | null; picture: string | null; created_at: string };

export type SavedQuote = {
  id: string;
  device_id: string;
  raw_text: string;
  book_title: string | null;
  author: string | null;
  template_used: TemplateId;
  aspect_ratio: AspectRatio;
  created_at: string;
};

export type OcrResult = { ok: boolean; text: string; word_count: number; message?: string | null };

const DEVICE_KEY = "qc.device_id";
let cachedDeviceId: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  const existing = await storage.getItem(DEVICE_KEY, "");
  if (existing) {
    cachedDeviceId = existing;
    return existing;
  }
  const fresh = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  await storage.setItem(DEVICE_KEY, fresh);
  cachedDeviceId = fresh;
  return fresh;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401 && !path.startsWith("/auth/")) {
    onUnauthorized?.();
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

export const api = {
  exchangeSession: async (session_id: string) => {
    const device_id = await getDeviceId();
    return request<{ session_token: string; user: AuthUser; merged_quotes: number }>("/auth/session", {
      method: "POST",
      body: JSON.stringify({ session_id, device_id }),
    });
  },
  me: () => request<AuthUser>("/auth/me"),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),

  ocr: (image_base64: string) =>
    request<OcrResult>("/ocr", { method: "POST", body: JSON.stringify({ image_base64 }) }),

  listQuotes: () => request<SavedQuote[]>("/quotes"),

  createQuote: async (body: {
    raw_text: string;
    book_title?: string | null;
    author?: string | null;
    template_used: TemplateId;
    aspect_ratio: AspectRatio;
  }) => {
    const device_id = await getDeviceId();
    return request<SavedQuote>("/quotes", { method: "POST", body: JSON.stringify({ ...body, device_id }) });
  },

  updateQuote: (id: string, body: Partial<Omit<SavedQuote, "id" | "device_id" | "created_at">>) =>
    request<SavedQuote>(`/quotes/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  deleteQuote: (id: string) => request<{ ok: boolean }>(`/quotes/${id}`, { method: "DELETE" }),
};

// ---- Offline queue of cropped images awaiting OCR ----
export type QueuedCapture = { id: string; uri: string; base64: string; created_at: string };
const QUEUE_KEY = "qc.unprocessed";

export async function getQueue(): Promise<QueuedCapture[]> {
  const raw = await storage.getItem(QUEUE_KEY, "[]");
  try {
    return JSON.parse(raw ?? "[]") as QueuedCapture[];
  } catch {
    return [];
  }
}

export async function enqueueCapture(item: QueuedCapture) {
  const q = await getQueue();
  q.unshift(item);
  await storage.setItem(QUEUE_KEY, JSON.stringify(q.slice(0, 10)));
}

export async function dequeueCapture(id: string) {
  const q = await getQueue();
  await storage.setItem(QUEUE_KEY, JSON.stringify(q.filter((i) => i.id !== id)));
}
