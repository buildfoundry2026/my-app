import { create } from "zustand";

import { AspectRatio, TemplateId } from "./templates";

export type QuoteDraft = {
  id: string | null;
  ocrText: string;
  bookTitle: string;
  author: string;
  selectedTemplate: TemplateId;
  aspectRatio: AspectRatio;
};

type DraftState = QuoteDraft & {
  setDraft: (patch: Partial<QuoteDraft>) => void;
  resetDraft: () => void;
};

const initial: QuoteDraft = {
  id: null,
  ocrText: "",
  bookTitle: "",
  author: "",
  selectedTemplate: "minimalist-dark",
  aspectRatio: "4:5",
};

export const useDraft = create<DraftState>((set) => ({
  ...initial,
  setDraft: (patch) => set(patch),
  resetDraft: () => set(initial),
}));

// ---- Toasts ----
export type ToastKind = "info" | "success" | "error";
type ToastState = {
  message: string | null;
  kind: ToastKind;
  show: (message: string, kind?: ToastKind) => void;
  hide: () => void;
};

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useToast = create<ToastState>((set) => ({
  message: null,
  kind: "info",
  show: (message, kind = "info") => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ message, kind });
    toastTimer = setTimeout(() => set({ message: null }), 3200);
  },
  hide: () => set({ message: null }),
}));

export const toast = (message: string, kind: ToastKind = "info") =>
  useToast.getState().show(message, kind);
