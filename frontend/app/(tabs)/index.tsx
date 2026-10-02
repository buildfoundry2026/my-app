import Feather from "@react-native-vector-icons/feather";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import React, { useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PermissionFallback } from "@/src/components/PermissionFallback";
import { IconButton } from "@/src/components/ui";
import { usesNativeTabs } from "@/src/navigation";
import { toast, useDraft } from "@/src/store";
import { makeStyles, useTheme } from "@/src/theme";

export default function CameraScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [torch, setTorch] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const resetDraft = useDraft((s) => s.resetDraft);

  const goToCrop = (uri: string, width: number, height: number) => {
    resetDraft();
    router.push({ pathname: "/crop", params: { uri, width: String(width), height: String(height) } });
  };

  const pickFromGallery = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      goToCrop(a.uri, a.width, a.height);
    } catch {
      toast("Could not open the gallery.", "error");
    }
  };

  const capture = async () => {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85, skipProcessing: false });
      if (photo?.uri) goToCrop(photo.uri, photo.width, photo.height);
    } catch {
      toast("Capture failed. Please try again.", "error");
    } finally {
      setBusy(false);
    }
  };

  if (!permission) {
    return <View style={styles.root} />;
  }

  if (!permission.granted) {
    return (
      <PermissionFallback
        canAskAgain={permission.canAskAgain}
        onRequest={() => requestPermission()}
        onPickFromGallery={pickFromGallery}
        bottomChrome={bottomChrome}
      />
    );
  }

  return (
    <View testID="camera-screen" style={styles.root}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        enableTorch={torch}
        onCameraReady={() => setReady(true)}
      />
      {!ready ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.onSurfaceInverse} />
        </View>
      ) : null}

      {/* framing guide */}
      <View style={[styles.guideWrap, { pointerEvents: "none" }]}>
        <View style={styles.guide}>
          <View style={[styles.corner, styles.tl]} />
          <View style={[styles.corner, styles.tr]} />
          <View style={[styles.corner, styles.bl]} />
          <View style={[styles.corner, styles.br]} />
        </View>
        <Text style={styles.hint}>Frame the passage. You can crop next.</Text>
      </View>

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.brand}>QuoteCanvas</Text>
        {Platform.OS !== "web" ? (
          <IconButton
            testID="camera-torch-button"
            icon={torch ? "zap" : "zap-off"}
            color={colors.onSurfaceInverse}
            onPress={() => setTorch((t) => !t)}
          />
        ) : null}
      </View>

      <View style={[styles.controls, { paddingBottom: bottomChrome + 20 }]}>
        <IconButton
          testID="camera-gallery-button"
          icon="image"
          size={26}
          color={colors.onSurfaceInverse}
          onPress={pickFromGallery}
        />
        <Pressable
          testID="camera-capture-button"
          onPress={capture}
          disabled={busy}
          style={({ pressed }) => [styles.shutterOuter, pressed && { transform: [{ scale: 0.94 }] }]}
        >
          <View style={styles.shutterInner}>
            {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : null}
          </View>
        </Pressable>
        <View style={{ width: 44, alignItems: "center" }}>
          <Feather name="book-open" size={22} color={colors.onSurfaceInverse} style={{ opacity: 0.35 }} />
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.cameraBackdrop },
  camera: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  loading: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  guideWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  guide: { width: "78%", aspectRatio: 0.85 },
  corner: { position: "absolute", width: 28, height: 28, borderColor: colors.cropHandle },
  tl: { top: 0, left: 0, borderTopWidth: 2, borderLeftWidth: 2 },
  tr: { top: 0, right: 0, borderTopWidth: 2, borderRightWidth: 2 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 2, borderLeftWidth: 2 },
  br: { bottom: 0, right: 0, borderBottomWidth: 2, borderRightWidth: 2 },
  hint: { fontFamily: "DMSans", fontSize: 13, color: colors.onSurfaceInverse, opacity: 0.85 },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  brand: { fontFamily: "Cormorant", fontSize: 26, color: colors.onSurfaceInverse },
  controls: {
    backgroundColor: colors.surfaceInverse,
    paddingTop: 20,
    paddingHorizontal: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  shutterOuter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 3,
    borderColor: colors.onSurfaceInverse,
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
}));
