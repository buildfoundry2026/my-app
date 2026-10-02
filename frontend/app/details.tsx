import Feather from "@react-native-vector-icons/feather";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import React, { useEffect, useRef, useState } from "react";
import { Keyboard, LayoutAnimation, Platform, Pressable, Text, TextInput, useWindowDimensions, View } from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ViewShot, { captureRef } from "react-native-view-shot";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { CanvasRenderer } from "@/src/components/CanvasRenderer";
import { Button, IconButton } from "@/src/components/ui";
import { toast, useDraft } from "@/src/store";
import { getTemplate, MAX_QUOTE_CHARS, ratioValue } from "@/src/templates";
import { makeStyles, useTheme } from "@/src/theme";

const EXPORT_WIDTH = 1080;
const CTA_HEIGHT = 136;
const CTA_HEIGHT_KEYBOARD = 76;
// expo-media-library has no web implementation; load it lazily on native only.
const MediaLibrary: typeof import("expo-media-library") | null =
  Platform.OS === "web" ? null : require("expo-media-library");

export default function DetailsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const draft = useDraft();
  const setDraft = useDraft((s) => s.setDraft);
  const resetDraft = useDraft((s) => s.resetDraft);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const shotRef = useRef<React.ComponentRef<typeof ViewShot>>(null);
  const [exporting, setExporting] = useState(false);
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    // Android only emits the "did" events; iOS "will" events keep the preview in step with the keyboard.
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const update = (visible: boolean) => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setKeyboardVisible(visible);
    };
    const showSub = Keyboard.addListener(showEvent, () => update(true));
    const hideSub = Keyboard.addListener(hideEvent, () => update(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const template = getTemplate(draft.selectedTemplate);
  const previewH = screenH * 0.24;
  const previewW = Math.min(screenW - 48, previewH * ratioValue(draft.aspectRatio));
  const ctaHeight = isKeyboardVisible ? CTA_HEIGHT_KEYBOARD : CTA_HEIGHT;

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
    if (!user) return true;
    try {
      await saveMutation.mutateAsync();
      return true;
    } catch {
      toast("Saved locally only — couldn't reach the server.", "error");
      return true;
    }
  };

  const onSaveQuote = async () => {
    if (saveMutation.isPending) return;
    if (!draft.ocrText.trim()) {
      toast("Add some text to your quote first.", "error");
      return;
    }
    if (!user) {
      toast("Sign in to save this quote to your history.", "info");
      return;
    }
    Keyboard.dismiss();
    try {
      await saveMutation.mutateAsync();
    } catch {
      toast("Couldn't save. Check your connection and try again.", "error");
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    toast("Saved to your history.", "success");
    if (router.canDismiss()) router.dismissTo("/(tabs)/history");
    else router.replace("/(tabs)/history");
    resetDraft();
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
      if (!(await ensureSaved())) return;
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
    <View testID="details-screen" style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <IconButton
          testID="details-back-button"
          icon="arrow-left"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/style"))}
        />
        <Text style={styles.headerTitle}>Add details</Text>
        <View style={{ width: 44 }} />
      </View>

      {!isKeyboardVisible ? (
        <View testID="details-preview" style={[styles.preview, { height: previewH + 24 }]}>
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
      ) : null}

      <KeyboardAwareScrollView
        style={styles.controls}
        contentContainerStyle={{ paddingBottom: ctaHeight + insets.bottom + 24 }}
        bottomOffset={ctaHeight + 24}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.labelRow}>
          <Text style={styles.sectionLabel}>QUOTE</Text>
          <Text testID="details-char-count" style={[styles.counter, remaining < 40 && { color: colors.error }]}>
            {draft.ocrText.length}/{MAX_QUOTE_CHARS}
          </Text>
        </View>
        <TextInput
          testID="details-quote-input"
          value={draft.ocrText}
          onChangeText={(v) => setDraft({ ocrText: v.slice(0, MAX_QUOTE_CHARS) })}
          multiline
          maxLength={MAX_QUOTE_CHARS}
          placeholder="Fix any typos from the scan…"
          placeholderTextColor={colors.muted}
          style={[styles.input, styles.multiline]}
          textAlignVertical="top"
        />
        {remaining <= 0 ? (
          <Text testID="details-limit-warning" style={styles.warning}>
            Quotes are limited to {MAX_QUOTE_CHARS} characters so they stay legible. Try shortening it.
          </Text>
        ) : null}

        <Text style={styles.sectionLabel}>AUTHOR</Text>
        <TextInput
          testID="details-author-input"
          value={draft.author}
          onChangeText={(v) => setDraft({ author: v })}
          placeholder="e.g. John Steinbeck"
          placeholderTextColor={colors.muted}
          style={styles.input}
          returnKeyType="next"
        />
        <Text style={styles.sectionLabel}>DESCRIPTION / BOOK TITLE</Text>
        <TextInput
          testID="details-book-title-input"
          value={draft.bookTitle}
          onChangeText={(v) => setDraft({ bookTitle: v })}
          placeholder="e.g. East of Eden"
          placeholderTextColor={colors.muted}
          style={styles.input}
          returnKeyType="done"
        />
      </KeyboardAwareScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
        <View style={[styles.cta, { paddingBottom: insets.bottom + 8 }]}>
          <Button testID="details-save-button" label="Save Quote" icon="bookmark" onPress={onSaveQuote} loading={saveMutation.isPending} />
          {!isKeyboardVisible ? (
            <View style={styles.linkRow}>
              <Pressable testID="details-share-button" onPress={onShare} disabled={exporting} style={styles.link}>
                <Feather name="share" size={16} color={colors.brandPrimary} />
                <Text style={styles.linkText}>{exporting ? "Preparing…" : "Share image"}</Text>
              </Pressable>
              <Pressable testID="details-save-photos-button" onPress={onSaveToPhotos} style={styles.link}>
                <Feather name="download" size={16} color={colors.brandPrimary} />
                <Text style={styles.linkText}>Save PNG to Photos</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </KeyboardStickyView>
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
  linkRow: { flexDirection: "row", justifyContent: "space-around" },
  link: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: 8 },
  linkText: { fontFamily: "DMSans", fontSize: 14, fontWeight: "600", color: colors.brandPrimary },
  cta: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    paddingTop: 12,
    gap: 4,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
}));
