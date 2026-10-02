// Quote canvas templates. These are artwork palettes that stay identical in
// light and dark mode, so the literals live here instead of theme.ts.
export type TemplateId = "minimalist-dark" | "typewriter-cream" | "modern-gradient" | "olive-botanical" | "terracotta-warmth";

export type QuoteTemplate = {
  id: TemplateId;
  name: string;
  background: string;
  gradient?: [string, string];
  text: string;
  accent: string;
  fontFamily: string;
  italic?: boolean;
  quoteMark: boolean;
};

export const TEMPLATES: QuoteTemplate[] = [
  {
    id: "minimalist-dark",
    name: "Minimalist Dark",
    background: "#1C1917",
    text: "#F5F5F5",
    accent: "#A8A29E",
    fontFamily: "Cormorant",
    quoteMark: true,
  },
  {
    id: "typewriter-cream",
    name: "Typewriter Cream",
    background: "#F5F0E6",
    text: "#292524",
    accent: "#78716C",
    fontFamily: "CourierPrime",
    quoteMark: false,
  },
  {
    id: "modern-gradient",
    name: "Modern Gradient",
    background: "#FFEDD5",
    gradient: ["#FFEDD5", "#FEF08A"],
    text: "#78350F",
    accent: "#B45309",
    fontFamily: "DMSans",
    quoteMark: false,
  },
  {
    id: "olive-botanical",
    name: "Olive Botanical",
    background: "#4D533C",
    text: "#F3F4F6",
    accent: "#C9CDB8",
    fontFamily: "CormorantItalic",
    italic: true,
    quoteMark: true,
  },
  {
    id: "terracotta-warmth",
    name: "Terracotta Warmth",
    background: "#9A3412",
    text: "#FFEDD5",
    accent: "#FDBA74",
    fontFamily: "Cormorant",
    quoteMark: true,
  },
];

export const getTemplate = (id: string): QuoteTemplate =>
  TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];

export type AspectRatio = "9:16" | "4:5" | "1:1";
export const ASPECT_RATIOS: AspectRatio[] = ["9:16", "4:5", "1:1"];

export const ratioValue = (r: AspectRatio): number => {
  switch (r) {
    case "9:16":
      return 9 / 16;
    case "4:5":
      return 4 / 5;
    default:
      return 1;
  }
};

export const MAX_QUOTE_CHARS = 500;
