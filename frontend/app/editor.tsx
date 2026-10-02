import NetInfo from "@react-native-community/netinfo";
import Feather from "@react-native-vector-icons/feather";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import React, { useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ViewShot, { captureRef } from "react-native-view-shot";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { CanvasRenderer } from "@/src/components/CanvasRenderer";
import { Button, IconButton } from "@/src/components/ui";
import { toast, useDraft } from "@/src/store";
import { ASPECT_RATIOS, AspectRatio, getTemplate, MAX_QUOTE_CHARS, ratioValue, TEMPLATES } from "@/src/templates";
import { makeStyles, useTheme } from "@/src/theme";

const EXPORT_WIDTH = 1080;
const CTA_HEIGHT = 92;
// expo-media-library has no web implementation; load it lazily on native only.
const MediaLibrary: typeof import("expo-media-library") | null =
  Platform.OS === "web" ? null : require("expo-media-library");

export default function EditorScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const draft = useDraft();
  const setDraft = useDraft((s) => s.setDraft);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const shotRef = useRef<React.ComponentRef<typeof ViewShot>>(null);
  const [exporting, setExporting] = useState(false);
  const [improving, setImproving] = useState(false);
  const [compare, setCompare] = useState<{ onDevice: string; ai: string } | null>(null);

  const usageQuery = useQuery({ queryKey: ["ai-usage"], queryFn: api.aiUsage, enabled: !!user });
  const aiRemaining = usageQuery.data?.remaining;

  const promptSignIn = (message: string) => {
    toast(message, "info");
    router.push("/login");
  };

  const template = getTemplate(draft.selectedTemplate);
  const previewH = screenH * 0.42;
  const previewW = Math.min(screenW - 48, previewH * ratioValue(draft.aspectRatio));

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        raw_text: draft.ocrText.trim(),
        book_title: draft.bookTitle.trim() || null,
        author: draft.author.trim() || null,
        template_used: draft.selectedTemplate,
        aspect_ratio: draft.aspectRatio,
      };
      if (draft.id) return api.updateQuote(draft.id, body);
      return api.createQuote(body);
    },
    onSuccess: (saved) => {
      setDraft({ id: saved.id });
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
    },
  });

  const ensureSaved = async () => {
    if (!draft.ocrText.trim()) {
      toast("Add some text to your quote first.", "error");
      return false;
    }
    if (!user) return true; // anonymous: export locally, cloud save is gated below
    try {
      await saveMutation.mutateAsync();
      return true;
    } catch {
      toast("Saved locally only — couldn't reach the server.", "error");
      return true;
    }
  };

  const onSave = async () => {
    if (!draft.ocrText.trim()) {
      toast("Add some text to your quote first.", "error");
      return;
    }
    if (!user) {
      promptSignIn("Sign in to save this quote to your history.");
      return;
    }
    const ok = await ensureSaved();
    if (ok && !saveMutation.isError) toast("Saved to your history.", "success");
  };

  const onImprove = async () => {
    if (improving) return;
    if (!draft.imageUri) {
      toast("Scan a page first to use AI.", "error");
      return;
    }
    if (!user) {
      promptSignIn("Sign in to use Improve with AI.");
      return;
    }
    const net = await NetInfo.fetch();
    if (net.isConnected === false || net.isInternetReachable === false) {
      toast("Improve with AI needs a connection.", "error");
      return;
    }
    if (typeof aiRemaining === "number" && aiRemaining <= 0) {
      toast("Daily AI limit reached. Try again tomorrow.", "error");
      return;
    }
    setImproving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      // Downscale the crop client-side so we stay well under the server's ~2 MB cap.
      const ctx = ImageManipulator.manipulate(draft.imageUri);
      ctx.resize({ width: 1500 });
      const rendered = await ctx.renderAsync();
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.6, base64: true });
      const res = await api.ocr(saved.base64 ?? "");
      queryClient.invalidateQueries({ queryKey: ["ai-usage"] });
      if (!res.ok) {
        toast(res.message ?? "AI couldn't read this page clearly.", "error");
        return;
      }
      setCompare({ onDevice: draft.ocrText.trim(), ai: res.text.slice(0, MAX_QUOTE_CHARS) });
    } catch (e: any) {
      toast(e?.message || "Improve with AI failed. Please try again.", "error");
    } finally {
      setImproving(false);
    }
  };

  const acceptVersion = (text: string) => {
    setDraft({ ocrText: text.slice(0, MAX_QUOTE_CHARS) });
    setCompare(null);
    Haptics.selectionAsync().catch(() => {});
  };

  const exportImage = async (): Promise<string | null> => {
    if (!shotRef.current) return null;
    const outW = EXPORT_WIDTH;
    const outH = Math.round(EXPORT_WIDTH / ratioValue(draft.aspectRatio));
    return captureRef(shotRef, {
      format: "png",
      quality: 1,
      width: outW,
      height: outH,
      result: Platform.OS === "web" ? "data-uri" : "tmpfile",
    });
  };

  const onShare = async () => {
    if (exporting) return;
    setExporting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      await ensureSaved();
      const uri = await exportImage();
      if (!uri) throw new Error("capture failed");
      if (Platform.OS === "web") {
        toast("Sharing opens on your phone. Image rendered successfully.", "info");
        return;
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Share your quote" });
      } else {
        toast("Sharing isn't available on this device.", "error");
      }
    } catch {
      toast("Export failed. Please try again.", "error");
    } finally {
      setExporting(false);
    }
  };

  const onSaveToPhotos = async () => {
    if (Platform.OS === "web" || !MediaLibrary) {
      toast("Saving to Photos works on your phone.", "info");
      return;
    }
    try {
      const perm = await MediaLibrary.getPermissionsAsync(false, ["photo"]);
      let granted = perm.granted;
      if (!granted && perm.canAskAgain) {
        const req = await MediaLibrary.requestPermissionsAsync(false, ["photo"]);
        granted = req.granted;
      }
      if (!granted) {
        toast("Allow photo access in Settings to save images.", "error");
        return;
      }
      const uri = await exportImage();
      if (!uri) throw new Error();
      await MediaLibrary.saveToLibraryAsync(uri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast("Saved to your Photos.", "success");
    } catch {
      toast("Couldn't save the image.", "error");
    }
  };

  const remaining = MAX_QUOTE_CHARS - draft.ocrText.length;

  return (
    <View testID="editor-screen" style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <IconButton testID="editor-back-button" icon="arrow-left" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))} />
        <Text style={styles.headerTitle}>Style your quote</Text>
        <IconButton testID="editor-save-button" icon={draft.id ? "check-circle" : "bookmark"} onPress={onSave} color={draft.id ? colors.success : colors.onSurface} />
      </View>

      {/* Canvas preview */}
      <View style={[styles.preview, { height: previewH + 32 }]}>
        <ViewShot ref={shotRef} options={{ format: "png", quality: 1 }} style={styles.shot}>
          <CanvasRenderer
            text={draft.ocrText}
            bookTitle={draft.bookTitle}
            author={draft.author}
            template={template}
            aspectRatio={draft.aspectRatio}
            width={previewW}
          />
        </ViewShot>
      </View>

      {/* Controls */}
      <KeyboardAwareScrollView
        style={styles.controls}
        contentContainerStyle={{ paddingBottom: CTA_HEIGHT + insets.bottom + 24 }}
        bottomOffset={CTA_HEIGHT + 24}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Templates */}
        <Text style={styles.sectionLabel}>TEMPLATE</Text>
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

        {/* Aspect ratio */}
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

        {/* Text */}
        <View style={styles.labelRow}>
          <Text style={styles.sectionLabel}>QUOTE</Text>
          <Text testID="editor-char-count" style={[styles.counter, remaining < 40 && { color: colors.error }]}>
            {draft.ocrText.length}/{MAX_QUOTE_CHARS}
          </Text>
        </View>
        <TextInput
          testID="editor-quote-input"
          value={draft.ocrText}
          onChangeText={(v) => setDraft({ ocrText: v.slice(0, MAX_QUOTE_CHARS) })}
          multiline
          maxLength={MAX_QUOTE_CHARS}
          placeholder="Fix typos or add context…"
          placeholderTextColor={colors.muted}
          style={[styles.input, styles.multiline]}
          textAlignVertical="top"
        />
        {remaining <= 0 ? (
          <Text testID="editor-limit-warning" style={styles.warning}>
            Quotes are limited to {MAX_QUOTE_CHARS} characters so they stay legible. Try shortening it.
          </Text>
        ) : null}

        {draft.imageUri ? (
          <View style={styles.aiBlock}>
            <Button
              testID="editor-improve-ai-button"
              label="Improve with AI"
              icon="zap"
              variant="secondary"
              onPress={onImprove}
              loading={improving}
              disabled={typeof aiRemaining === "number" && aiRemaining <= 0}
            />
            <Text testID="editor-ai-hint" style={styles.aiHint}>
              {!user
                ? "Sign in to re-scan this page with AI for a cleaner transcription."
                : typeof aiRemaining === "number"
                  ? aiRemaining > 0
                    ? `Re-scan with AI · ${aiRemaining} left today`
                    : "Daily AI limit reached — try again tomorrow."
                  : "Re-scan this page with AI for a cleaner transcription."}
            </Text>
          </View>
        ) : null}

        <Text style={styles.sectionLabel}>BOOK TITLE</Text>
        <TextInput
          testID="editor-book-title-input"
          value={draft.bookTitle}
          onChangeText={(v) => setDraft({ bookTitle: v })}
          placeholder="e.g. East of Eden"
          placeholderTextColor={colors.muted}
          style={styles.input}
          returnKeyType="next"
        />
        <Text style={styles.sectionLabel}>AUTHOR</Text>
        <TextInput
          testID="editor-author-input"
          value={draft.author}
          onChangeText={(v) => setDraft({ author: v })}
          placeholder="e.g. John Steinbeck"
          placeholderTextColor={colors.muted}
          style={styles.input}
          returnKeyType="done"
        />

        <Pressable testID="editor-save-photos-button" onPress={onSaveToPhotos} style={styles.linkRow}>
          <Feather name="download" size={18} color={colors.brandPrimary} />
          <Text style={styles.linkText}>Save PNG to Photos</Text>
        </Pressable>
      </KeyboardAwareScrollView>

      {/* Sticky CTA */}
      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
        <View style={[styles.cta, { paddingBottom: insets.bottom + 12 }]}>
          <Button testID="editor-export-button" label="Export & Share" icon="share" onPress={onShare} loading={exporting} />
        </View>
      </KeyboardStickyView>

      {/* Improve-with-AI comparison */}
      <Modal visible={!!compare} transparent animationType="fade" onRequestClose={() => setCompare(null)}>
        <View style={styles.modalBackdrop}>
          <View testID="ai-compare-modal" style={[styles.modalCard, { paddingBottom: insets.bottom + 16, maxHeight: screenH * 0.8 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Pick the better version</Text>
              <IconButton testID="ai-compare-close" icon="x" onPress={() => setCompare(null)} />
            </View>
            <ScrollView contentContainerStyle={{ gap: 16 }} showsVerticalScrollIndicator={false}>
              <View style={styles.versionCard}>
                <Text style={styles.versionLabel}>ON DEVICE</Text>
                <Text testID="ai-ondevice-text" style={styles.versionText}>{compare?.onDevice || "— no text —"}</Text>
                <Button testID="ai-use-ondevice" label="Keep this" variant="ghost" onPress={() => acceptVersion(compare?.onDevice ?? "")} />
              </View>
              <View style={[styles.versionCard, styles.versionCardAi]}>
                <View style={styles.aiBadgeRow}>
                  <Feather name="zap" size={12} color={colors.brandPrimary} />
                  <Text style={[styles.versionLabel, { color: colors.brandPrimary }]}>AI TRANSCRIPTION</Text>
                </View>
                <Text testID="ai-ai-text" style={styles.versionText}>{compare?.ai || "— no text —"}</Text>
                <Button testID="ai-use-ai" label="Use AI version" icon="zap" onPress={() => acceptVersion(compare?.ai ?? "")} />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  shot: { backgroundColor: "transparent" },
  controls: { flex: 1, paddingHorizontal: 24 },
  sectionLabel: { fontFamily: "DMSans", fontSize: 11, letterSpacing: 1.6, color: colors.muted, marginTop: 24, marginBottom: 8 },
  labelRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  counter: { fontFamily: "DMSans", fontSize: 12, color: colors.muted, marginBottom: 8 },
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
  input: {
    fontFamily: "DMSans",
    fontSize: 15,
    color: colors.onSurface,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
  },
  multiline: { minHeight: 120, lineHeight: 22 },
  warning: { fontFamily: "DMSans", fontSize: 12, color: colors.error, marginTop: 8 },
  aiBlock: { marginTop: 20, gap: 8 },
  aiHint: { fontFamily: "DMSans", fontSize: 12, color: colors.muted, textAlign: "center" },
  modalBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 12,
  },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { fontFamily: "Cormorant", fontSize: 24, color: colors.onSurface },
  versionCard: {
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 16,
    gap: 12,
  },
  versionCardAi: { borderColor: colors.brandPrimary },
  aiBadgeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  versionLabel: { fontFamily: "DMSans", fontSize: 11, letterSpacing: 1.6, color: colors.muted },
  versionText: { fontFamily: "DMSans", fontSize: 14, lineHeight: 21, color: colors.onSurface },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 24, minHeight: 44 },
  linkText: { fontFamily: "DMSans", fontSize: 14, fontWeight: "600", color: colors.brandPrimary },
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
