import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CanvasRenderer } from "@/src/components/CanvasRenderer";
import { Button, IconButton } from "@/src/components/ui";
import { toast, useDraft } from "@/src/store";
import { ASPECT_RATIOS, AspectRatio, getTemplate, ratioValue, TEMPLATES } from "@/src/templates";
import { makeStyles, useTheme } from "@/src/theme";

const CTA_HEIGHT = 92;

export default function StyleScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const draft = useDraft();
  const setDraft = useDraft((s) => s.setDraft);

  const template = getTemplate(draft.selectedTemplate);
  const previewH = screenH * 0.46;
  const previewW = Math.min(screenW - 48, previewH * ratioValue(draft.aspectRatio));

  const onNext = () => {
    if (!draft.ocrText.trim()) {
      toast("No text was extracted. You can type it in on the next step.", "info");
    }
    router.push("/details");
  };

  return (
    <View testID="style-screen" style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <IconButton
          testID="style-back-button"
          icon="arrow-left"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))}
        />
        <Text style={styles.headerTitle}>Style your quote</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={[styles.preview, { height: previewH + 32 }]}>
        <CanvasRenderer
          text={draft.ocrText}
          bookTitle={draft.bookTitle}
          author={draft.author}
          template={template}
          aspectRatio={draft.aspectRatio}
          width={previewW}
        />
      </View>

      <ScrollView
        style={styles.controls}
        contentContainerStyle={{ paddingBottom: CTA_HEIGHT + insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionLabel}>BACKGROUND & TYPE</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.swatchRow}
          style={{ height: 96 }}
        >
          {TEMPLATES.map((t) => {
            const selected = t.id === draft.selectedTemplate;
            return (
              <Pressable
                key={t.id}
                testID={`template-swatch-${t.id}`}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setDraft({ selectedTemplate: t.id });
                }}
                style={styles.swatchWrap}
              >
                <View style={[styles.swatch, { backgroundColor: t.gradient ? t.gradient[1] : t.background }, selected && styles.swatchSelected]}>
                  <Text style={{ color: t.text, fontFamily: t.fontFamily, fontSize: 22 }}>Aa</Text>
                </View>
                <Text numberOfLines={1} style={[styles.swatchName, selected && { color: colors.brandPrimary }]}>
                  {t.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Text style={styles.sectionLabel}>FORMAT</Text>
        <View style={styles.segment}>
          {ASPECT_RATIOS.map((r: AspectRatio) => {
            const selected = r === draft.aspectRatio;
            const label = r === "9:16" ? "Story" : r === "4:5" ? "Portrait" : "Square";
            return (
              <Pressable
                key={r}
                testID={`ratio-${r.replace(":", "-")}`}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setDraft({ aspectRatio: r });
                }}
                style={[styles.segmentItem, selected && styles.segmentItemSelected]}
              >
                <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{r}</Text>
                <Text style={[styles.segmentSub, selected && styles.segmentTextSelected]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.cta, { paddingBottom: insets.bottom + 12 }]}>
        <Button testID="style-next-button" label="Next: Add Details" icon="arrow-right" onPress={onNext} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 4,
    backgroundColor: colors.surface,
  },
  headerTitle: { fontFamily: "Cormorant", fontSize: 24, color: colors.onSurface },
  preview: {
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  controls: { flex: 1, paddingHorizontal: 24 },
  sectionLabel: { fontFamily: "DMSans", fontSize: 11, letterSpacing: 1.6, color: colors.muted, marginTop: 24, marginBottom: 8 },
  swatchRow: { gap: 16, paddingRight: 24, alignItems: "flex-start" },
  swatchWrap: { alignItems: "center", gap: 6, width: 64, flexShrink: 0 },
  swatch: {
    width: 56,
    height: 56,
    borderRadius: 2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  swatchSelected: { borderColor: colors.brandPrimary },
  swatchName: { fontFamily: "DMSans", fontSize: 10, color: colors.muted, textAlign: "center" },
  segment: { flexDirection: "row", borderWidth: 1, borderColor: colors.border, borderRadius: 4, overflow: "hidden" },
  segmentItem: { flex: 1, paddingVertical: 10, alignItems: "center", backgroundColor: colors.surface },
  segmentItemSelected: { backgroundColor: colors.surfaceInverse },
  segmentText: { fontFamily: "DMSans", fontSize: 14, fontWeight: "600", color: colors.onSurface },
  segmentSub: { fontFamily: "DMSans", fontSize: 11, color: colors.muted },
  segmentTextSelected: { color: colors.onSurfaceInverse },
  cta: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    paddingTop: 12,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
}));
