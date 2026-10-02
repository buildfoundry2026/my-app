import Feather from "@react-native-vector-icons/feather";
import { useCameraPermissions } from "expo-camera";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getDeviceId } from "@/src/api";
import { useAuth } from "@/src/auth";
import { Button, ScreenTitle } from "@/src/components/ui";
import { usesNativeTabs } from "@/src/navigation";
import { TEMPLATES } from "@/src/templates";
import { makeStyles, useTheme } from "@/src/theme";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

function Row({ icon, label, value, onPress, testID }: { icon: FeatherName; label: string; value?: string; onPress?: () => void; testID: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      <Feather name={icon} size={20} color={colors.onSurface} />
      <Text style={styles.rowLabel}>{label}</Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {onPress ? <Feather name="chevron-right" size={18} color={colors.muted} /> : null}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const [permission, requestPermission] = useCameraPermissions();
  const { user, signOut } = useAuth();
  const { colors } = useTheme();
  const [deviceId, setDeviceId] = useState("");

  useFocusEffect(
    useCallback(() => {
      getDeviceId().then(setDeviceId);
    }, []),
  );

  const camStatus = !permission ? "…" : permission.granted ? "Allowed" : permission.canAskAgain ? "Not set" : "Denied";
  const onCameraRow = () => {
    if (permission?.granted || (permission && !permission.canAskAgain)) {
      Linking.openSettings();
    } else {
      requestPermission();
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: bottomChrome + 24 }}>
        <ScreenTitle title="Settings" subtitle="Preferences & permissions" testID="settings-title" />

        <Text style={styles.section}>Account</Text>
        {user ? (
          <>
            <View testID="settings-account-card" style={styles.account}>
              {user?.picture ? (
                <Image source={{ uri: user.picture }} style={styles.avatar} contentFit="cover" />
              ) : (
                <View style={[styles.avatar, { alignItems: "center", justifyContent: "center" }]}>
                  <Feather name="user" size={20} color={colors.onSurfaceTertiary} />
                </View>
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <Text testID="settings-account-name" style={styles.accountName} numberOfLines={1}>
                  {user?.name || "Signed in"}
                </Text>
                <Text testID="settings-account-email" style={styles.accountEmail} numberOfLines={1}>
                  {user?.email}
                </Text>
                <Text style={styles.accountSync}>
                  <Feather name="refresh-cw" size={10} color={colors.success} /> Quotes sync across your phones
                </Text>
              </View>
            </View>
            <View style={{ paddingHorizontal: 24, marginTop: 12 }}>
              <Button testID="settings-sign-out-button" label="Sign out" icon="log-out" variant="ghost" onPress={signOut} />
            </View>
          </>
        ) : (
          <View testID="settings-signed-out-card" style={{ paddingHorizontal: 24, gap: 12 }}>
            <View style={styles.account}>
              <View style={[styles.avatar, { alignItems: "center", justifyContent: "center" }]}>
                <Feather name="user" size={20} color={colors.onSurfaceTertiary} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.accountName}>Not signed in</Text>
                <Text style={styles.accountEmail}>Sign in to save & sync your quotes</Text>
              </View>
            </View>
            <Button testID="settings-sign-in-button" label="Sign in with Google" icon="log-in" onPress={() => router.push("/login")} />
          </View>
        )}

        <Text style={styles.section}>Permissions</Text>
        <Row testID="settings-camera-permission-row" icon="camera" label="Camera" value={camStatus} onPress={Platform.OS === "web" ? undefined : onCameraRow} />
        <Row testID="settings-photos-row" icon="image" label="Photos" value="Asked when saving" onPress={Platform.OS === "web" ? undefined : () => Linking.openSettings()} />

        <Text style={styles.section}>Library</Text>
        <Row testID="settings-templates-row" icon="layout" label="Templates" value={String(TEMPLATES.length)} />

        <Text style={styles.section}>About</Text>
        <Row testID="settings-version-row" icon="info" label="QuoteCanvas" value="1.0.0" />
        <Row testID="settings-ocr-row" icon="cpu" label="Scanning" value="On-device + AI" />
        <View style={styles.deviceWrap}>
          <Text style={styles.deviceLabel}>DEVICE ID</Text>
          <Text testID="settings-device-id" style={styles.deviceId} selectable>
            {deviceId}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  account: {
    marginHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
  },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surfaceTertiary },
  accountName: { fontFamily: "Cormorant", fontSize: 20, color: colors.onSurfaceSecondary },
  accountEmail: { fontFamily: "DMSans", fontSize: 13, color: colors.muted },
  accountSync: { fontFamily: "DMSans", fontSize: 11, color: colors.success, marginTop: 2 },
  section: { fontFamily: "Cormorant", fontSize: 22, color: colors.onSurface, paddingHorizontal: 24, marginTop: 24, marginBottom: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 56,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  rowLabel: { flex: 1, fontFamily: "DMSans", fontSize: 15, color: colors.onSurface },
  rowValue: { fontFamily: "DMSans", fontSize: 14, color: colors.muted },
  deviceWrap: { paddingHorizontal: 24, marginTop: 24, gap: 4 },
  deviceLabel: { fontFamily: "DMSans", fontSize: 11, letterSpacing: 1.6, color: colors.muted },
  deviceId: { fontFamily: "DMSans", fontSize: 12, color: colors.onSurfaceTertiary },
}));
