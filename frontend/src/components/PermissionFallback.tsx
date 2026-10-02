import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Linking, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/src/components/ui";
import { makeStyles, useTheme } from "@/src/theme";

const IMAGE =
  "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1Mjh8MHwxfHNlYXJjaHwxfHxjbG9zZWQlMjBjYW1lcmElMjBsZW5zJTIwbWluaW1hbCUyMGFlc3RoZXRpY3xlbnwwfHx8fDE3OTA4OTkyOTl8MA&ixlib=rb-4.1.0&q=85";

export function PermissionFallback({
  canAskAgain,
  onRequest,
  onPickFromGallery,
  bottomChrome,
}: {
  canAskAgain: boolean;
  onRequest: () => void;
  onPickFromGallery: () => void;
  bottomChrome: number;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View testID="camera-permission-fallback" style={styles.root}>
      <Image source={{ uri: IMAGE }} style={styles.image} contentFit="cover" transition={300} />
      <LinearGradient colors={["transparent", colors.surfaceInverse]} locations={[0, 0.75]} style={styles.scrim} />
      <View style={[styles.content, { paddingBottom: bottomChrome + 24, paddingTop: insets.top }]}>
        <Text style={styles.eyebrow}>CAMERA ACCESS</Text>
        <Text style={styles.title}>Point your lens at the page.</Text>
        <Text style={styles.body}>
          QuoteCanvas needs the camera to capture quotes from physical books. You can also pick a photo from your
          gallery instead.
        </Text>
        <View style={styles.actions}>
          {canAskAgain ? (
            <Button testID="permission-request-button" label="Allow camera" icon="camera" onPress={onRequest} />
          ) : (
            <Button
              testID="permission-open-settings-button"
              label="Open Settings"
              icon="settings"
              onPress={() => Linking.openSettings()}
            />
          )}
          <Button
            testID="permission-gallery-button"
            label="Choose from gallery"
            icon="image"
            variant="ghost"
            onPress={onPickFromGallery}
            style={styles.ghost}
            textColor={colors.onSurfaceInverse}
          />
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surfaceInverse },
  image: { ...({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const) },
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  content: { flex: 1, justifyContent: "flex-end", paddingHorizontal: 24, gap: 12 },
  eyebrow: { fontFamily: "DMSans", fontSize: 12, letterSpacing: 2, color: colors.brandTertiary },
  title: { fontFamily: "Cormorant", fontSize: 40, lineHeight: 44, color: colors.onSurfaceInverse },
  body: { fontFamily: "DMSans", fontSize: 15, lineHeight: 22, color: colors.onSurfaceInverse, opacity: 0.85 },
  actions: { marginTop: 16, gap: 12 },
  ghost: { borderColor: colors.onSurfaceInverse },
}));
