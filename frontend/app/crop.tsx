import NetInfo from "@react-native-community/netinfo";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { LayoutChangeEvent, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, enqueueCapture } from "@/src/api";
import { Button, IconButton, SkeletonParagraph } from "@/src/components/ui";
import { toast, useDraft } from "@/src/store";
import { makeStyles, useTheme } from "@/src/theme";

const HANDLE = 44;
const MIN_BOX = 60;

export default function CropScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ uri: string; width: string; height: string }>();
  const imgW = Number(params.width) || 1000;
  const imgH = Number(params.height) || 1400;
  const setDraft = useDraft((s) => s.setDraft);

  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [processing, setProcessing] = useState(false);

  // display rect of the image inside the frame (contain)
  const scale = frame.w && frame.h ? Math.min(frame.w / imgW, frame.h / imgH) : 1;
  const dispW = imgW * scale;
  const dispH = imgH * scale;
  const offX = (frame.w - dispW) / 2;
  const offY = (frame.h - dispH) / 2;

  // crop box in display coords relative to image rect
  const bx = useSharedValue(0);
  const by = useSharedValue(0);
  const bw = useSharedValue(0);
  const bh = useSharedValue(0);
  const start = useSharedValue({ x: 0, y: 0, w: 0, h: 0 });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setFrame({ w: width, h: height });
    const s = Math.min(width / imgW, height / imgH);
    const dw = imgW * s;
    const dh = imgH * s;
    bx.value = dw * 0.08;
    by.value = dh * 0.12;
    bw.value = dw * 0.84;
    bh.value = dh * 0.5;
  };

  const clamp = (v: number, min: number, max: number) => {
    "worklet";
    return Math.min(Math.max(v, min), max);
  };

  const begin = () => {
    "worklet";
    start.value = { x: bx.value, y: by.value, w: bw.value, h: bh.value };
  };

  const movePan = Gesture.Pan()
    .onBegin(begin)
    .onUpdate((e) => {
      bx.value = clamp(start.value.x + e.translationX, 0, dispW - bw.value);
      by.value = clamp(start.value.y + e.translationY, 0, dispH - bh.value);
    });

  const cornerPan = (cx: "l" | "r", cy: "t" | "b") =>
    Gesture.Pan()
      .onBegin(begin)
      .onUpdate((e) => {
        const s = start.value;
        if (cx === "l") {
          const nx = clamp(s.x + e.translationX, 0, s.x + s.w - MIN_BOX);
          bx.value = nx;
          bw.value = s.w + (s.x - nx);
        } else {
          bw.value = clamp(s.w + e.translationX, MIN_BOX, dispW - s.x);
        }
        if (cy === "t") {
          const ny = clamp(s.y + e.translationY, 0, s.y + s.h - MIN_BOX);
          by.value = ny;
          bh.value = s.h + (s.y - ny);
        } else {
          bh.value = clamp(s.h + e.translationY, MIN_BOX, dispH - s.y);
        }
      });

  const tl = cornerPan("l", "t");
  const tr = cornerPan("r", "t");
  const bl = cornerPan("l", "b");
  const br = cornerPan("r", "b");

  const boxStyle = useAnimatedStyle(() => ({
    left: bx.value,
    top: by.value,
    width: bw.value,
    height: bh.value,
  }));
  const maskTop = useAnimatedStyle(() => ({ height: by.value }));
  const maskBottom = useAnimatedStyle(() => ({ top: by.value + bh.value }));
  const maskLeft = useAnimatedStyle(() => ({ top: by.value, height: bh.value, width: bx.value }));
  const maskRight = useAnimatedStyle(() => ({ top: by.value, height: bh.value, left: bx.value + bw.value }));

  const extract = async () => {
    if (processing || !scale) return;
    setProcessing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      const originX = Math.max(0, Math.round(bx.value / scale));
      const originY = Math.max(0, Math.round(by.value / scale));
      const width = Math.min(imgW - originX, Math.round(bw.value / scale));
      const height = Math.min(imgH - originY, Math.round(bh.value / scale));

      const ctx = ImageManipulator.manipulate(params.uri);
      ctx.crop({ originX, originY, width, height });
      if (width > 1600) ctx.resize({ width: 1600 });
      const rendered = await ctx.renderAsync();
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
      const base64 = saved.base64 ?? "";

      const net = await NetInfo.fetch();
      if (net.isConnected === false || net.isInternetReachable === false) {
        await enqueueCapture({ id: `q-${Date.now()}`, uri: saved.uri, base64, created_at: new Date().toISOString() });
        toast("You're offline. Saved to your unprocessed queue.", "info");
        router.replace("/(tabs)/history");
        return;
      }

      const result = await api.ocr(base64);
      if (!result.ok) {
        toast(result.message ?? "Text unclear. Please try capturing again in better light.", "error");
        return;
      }
      setDraft({ id: null, ocrText: result.text.slice(0, 500) });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace("/editor");
    } catch (e: any) {
      toast(e?.message?.includes("Network") ? "No connection. Try again when online." : "Couldn't extract text. Please retry.", "error");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <View testID="crop-screen" style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <IconButton testID="crop-retake-button" icon="arrow-left" color={colors.onSurfaceInverse} onPress={() => router.back()} />
        <Text style={styles.headerTitle}>Crop the quote</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={styles.frame} onLayout={onLayout}>
        {frame.w > 0 ? (
          <View style={{ position: "absolute", left: offX, top: offY, width: dispW, height: dispH }}>
            <Image source={{ uri: params.uri }} style={{ width: dispW, height: dispH }} contentFit="fill" />
            <Animated.View style={[styles.mask, { pointerEvents: "none" }, { top: 0, left: 0, right: 0 }, maskTop]} />
            <Animated.View style={[styles.mask, { pointerEvents: "none" }, { left: 0, right: 0, bottom: 0 }, maskBottom]} />
            <Animated.View style={[styles.mask, { pointerEvents: "none" }, { left: 0 }, maskLeft]} />
            <Animated.View style={[styles.mask, { pointerEvents: "none" }, { right: 0 }, maskRight]} />

            <GestureDetector gesture={movePan}>
              <Animated.View testID="crop-box" style={[styles.box, boxStyle]}>
                <View style={styles.gridV} />
                <View style={[styles.gridV, { left: "66.6%" }]} />
                <View style={styles.gridH} />
                <View style={[styles.gridH, { top: "66.6%" }]} />
                <GestureDetector gesture={tl}>
                  <Animated.View testID="crop-handle-tl" style={[styles.handle, { top: -HANDLE / 2, left: -HANDLE / 2 }]}>
                    <View style={[styles.handleMark, styles.hTL]} />
                  </Animated.View>
                </GestureDetector>
                <GestureDetector gesture={tr}>
                  <Animated.View testID="crop-handle-tr" style={[styles.handle, { top: -HANDLE / 2, right: -HANDLE / 2 }]}>
                    <View style={[styles.handleMark, styles.hTR]} />
                  </Animated.View>
                </GestureDetector>
                <GestureDetector gesture={bl}>
                  <Animated.View testID="crop-handle-bl" style={[styles.handle, { bottom: -HANDLE / 2, left: -HANDLE / 2 }]}>
                    <View style={[styles.handleMark, styles.hBL]} />
                  </Animated.View>
                </GestureDetector>
                <GestureDetector gesture={br}>
                  <Animated.View testID="crop-handle-br" style={[styles.handle, { bottom: -HANDLE / 2, right: -HANDLE / 2 }]}>
                    <View style={[styles.handleMark, styles.hBR]} />
                  </Animated.View>
                </GestureDetector>
              </Animated.View>
            </GestureDetector>
          </View>
        ) : null}

        {processing ? (
          <View testID="ocr-processing-overlay" style={styles.processing}>
            <View style={styles.processingCard}>
              <Text style={styles.processingTitle}>Reading the page…</Text>
              <SkeletonParagraph lines={6} light />
            </View>
          </View>
        ) : null}
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Text style={styles.footerHint}>Drag the corners to isolate just the passage.</Text>
        <Button testID="crop-extract-button" label="Extract Text" icon="type" onPress={extract} loading={processing} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.cameraBackdrop },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  headerTitle: { fontFamily: "Cormorant", fontSize: 22, color: colors.onSurfaceInverse },
  frame: { flex: 1, overflow: "hidden" },
  mask: { position: "absolute", backgroundColor: colors.cropMask },
  box: { position: "absolute", borderWidth: 1.5, borderColor: colors.cropHandle },
  gridV: { position: "absolute", top: 0, bottom: 0, left: "33.3%", width: 1, backgroundColor: colors.cropHandle, opacity: 0.35 },
  gridH: { position: "absolute", left: 0, right: 0, top: "33.3%", height: 1, backgroundColor: colors.cropHandle, opacity: 0.35 },
  handle: { position: "absolute", width: HANDLE, height: HANDLE, alignItems: "center", justifyContent: "center" },
  handleMark: { width: 22, height: 22, borderColor: colors.cropHandle },
  hTL: { borderTopWidth: 4, borderLeftWidth: 4, marginTop: 20, marginLeft: 20 },
  hTR: { borderTopWidth: 4, borderRightWidth: 4, marginTop: 20, marginRight: 20 },
  hBL: { borderBottomWidth: 4, borderLeftWidth: 4, marginBottom: 20, marginLeft: 20 },
  hBR: { borderBottomWidth: 4, borderRightWidth: 4, marginBottom: 20, marginRight: 20 },
  processing: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.cropMask,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  processingCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: colors.surfaceInverse,
    padding: 24,
    gap: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  processingTitle: { fontFamily: "Cormorant", fontSize: 24, color: colors.onSurfaceInverse },
  footer: { backgroundColor: colors.surfaceInverse, paddingHorizontal: 24, paddingTop: 16, gap: 12 },
  footerHint: { fontFamily: "DMSans", fontSize: 13, color: colors.onSurfaceInverse, opacity: 0.7, textAlign: "center" },
}));
