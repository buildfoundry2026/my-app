import { storage } from "@/src/utils/storage";
import { supabase } from "@/src/utils/supabase";

import { AspectRatio, TemplateId } from "./templates";

export type AuthUser = { user_id: string; email: string; name: string | null; picture: string | null; created_at: string };

export type SavedQuote = {
  id: string;
  user_id: string;
  raw_text: string;
  book_title: string | null;
  author: string | null;
  template_used: TemplateId;
  aspect_ratio: AspectRatio;
  created_at: string;
};

type QuoteInput = {
  raw_text: string;
  book_title?: string | null;
  author?: string | null;
  template_used: TemplateId;
  aspect_ratio: AspectRatio;
};

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

export const api = {
  listQuotes: async (): Promise<SavedQuote[]> => {
    const { data, error } = await supabase.from("quotes").select("*").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data as SavedQuote[];
  },

  createQuote: async (body: QuoteInput): Promise<SavedQuote> => {
    const { data, error } = await supabase.from("quotes").insert(body).select().single();
    if (error) throw new Error(error.message);
    return data as SavedQuote;
  },

  updateQuote: async (id: string, body: Partial<QuoteInput>): Promise<SavedQuote> => {
    const { data, error } = await supabase.from("quotes").update(body).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    return data as SavedQuote;
  },

  deleteQuote: async (id: string): Promise<{ ok: boolean }> => {
    const { error } = await supabase.from("quotes").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  },
};
