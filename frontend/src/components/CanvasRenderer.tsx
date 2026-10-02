import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { AspectRatio, QuoteTemplate, ratioValue } from "@/src/templates";

type Props = {
  text: string;
  bookTitle?: string;
  author?: string;
  template: QuoteTemplate;
  aspectRatio: AspectRatio;
  width: number;
  compact?: boolean;
};

// Renders the final shareable graphic. Colors come from the template palette
// (artwork, identical in light/dark), not from the app theme.
export function CanvasRenderer({ text, bookTitle, author, template, aspectRatio, width, compact }: Props) {
  const height = width / ratioValue(aspectRatio);
  const pad = Math.round(width * (compact ? 0.08 : 0.1));
  const base = width / (compact ? 9 : 11);
  const len = text.length;
  const fontSize = Math.max(compact ? 8 : 14, Math.round(base * (len > 320 ? 0.6 : len > 200 ? 0.72 : len > 110 ? 0.86 : 1)));
  const attribution = [bookTitle?.trim(), author?.trim()].filter(Boolean);
  const maxLines = Math.max(3, Math.floor((height - pad * 2 - (attribution.length ? fontSize * 2.4 : 0)) / (fontSize * 1.35)));

  const content = (
    <View style={[styles.inner, { padding: pad }]}>
      {template.quoteMark && !compact ? (
        <Text style={[styles.mark, { color: template.accent, fontSize: fontSize * 3, fontFamily: template.fontFamily }]}>
          “
        </Text>
      ) : null}
      <Text
        testID="canvas-quote-text"
        adjustsFontSizeToFit
        numberOfLines={maxLines}
        minimumFontScale={0.5}
        style={[
          styles.quote,
          {
            color: template.text,
            fontSize,
            lineHeight: fontSize * 1.35,
            fontFamily: template.fontFamily,
            fontStyle: template.italic ? "italic" : "normal",
          },
        ]}
      >
        {text.trim() || "Your quote will appear here."}
      </Text>
      {attribution.length ? (
        <View style={styles.attribution}>
          <View style={[styles.rule, { backgroundColor: template.accent, width: Math.round(width * 0.12) }]} />
          {bookTitle?.trim() ? (
            <Text
              testID="canvas-book-title"
              numberOfLines={1}
              style={[styles.title, { color: template.text, fontSize: fontSize * 0.62, fontFamily: template.fontFamily }]}
            >
              {bookTitle.trim()}
            </Text>
          ) : null}
          {author?.trim() ? (
            <Text
              testID="canvas-author"
              numberOfLines={1}
              style={[styles.author, { color: template.accent, fontSize: fontSize * 0.52, fontFamily: "DMSans" }]}
            >
              {author.trim().toUpperCase()}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  return (
    <View testID="canvas-renderer" style={{ width, height, backgroundColor: template.background, overflow: "hidden" }}>
      {template.gradient ? (
        <LinearGradient colors={template.gradient} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
      ) : null}
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  inner: { flex: 1, justifyContent: "center" },
  mark: { lineHeight: undefined, marginBottom: -8, opacity: 0.8 },
  quote: { textAlign: "left" },
  attribution: { marginTop: 18, gap: 6 },
  rule: { height: 1.5, marginBottom: 6 },
  title: { fontWeight: "600" },
  author: { letterSpacing: 2 },
});
