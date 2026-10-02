import Feather from "@react-native-vector-icons/feather";
import React, { useEffect } from "react";
import { ActivityIndicator, Pressable, Text, View, ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useToast } from "@/src/store";
import { makeStyles, useTheme } from "@/src/theme";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

// ---------- Primary / secondary button ----------
export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  loading,
  disabled,
  testID,
  style,
  textColor,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost";
  icon?: FeatherName;
  loading?: boolean;
  disabled?: boolean;
  testID: string;
  style?: ViewStyle;
  textColor?: string;
}) {
  const styles = useButtonStyles();
  const { colors } = useTheme();
  const fg = textColor ?? (variant === "primary" ? colors.onBrandPrimary : colors.onSurface);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        variant === "primary" && styles.primary,
        variant === "secondary" && styles.secondary,
        variant === "ghost" && styles.ghost,
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Feather name={icon} size={18} color={fg} /> : null}
          <Text style={[styles.label, { color: fg }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const useButtonStyles = makeStyles((colors) => ({
  base: {
    minHeight: 52,
    borderRadius: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 24,
  },
  primary: { backgroundColor: colors.brandPrimary },
  secondary: { backgroundColor: colors.surfaceTertiary },
  ghost: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.borderStrong },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  label: { fontFamily: "DMSans", fontSize: 16, fontWeight: "600", letterSpacing: 0.2 },
}));

// ---------- Icon button ----------
export function IconButton({
  icon,
  onPress,
  testID,
  color,
  size = 22,
  style,
}: {
  icon: FeatherName;
  onPress: () => void;
  testID: string;
  color?: string;
  size?: number;
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [{ width: 44, height: 44, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 }, style]}
    >
      <Feather name={icon} size={size} color={color ?? colors.onSurface} />
    </Pressable>
  );
}

// ---------- Section header ----------
export function ScreenTitle({ title, subtitle, testID }: { title: string; subtitle?: string; testID?: string }) {
  const styles = useTitleStyles();
  return (
    <View style={styles.wrap} testID={testID}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const useTitleStyles = makeStyles((colors) => ({
  wrap: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 16, gap: 4 },
  title: { fontFamily: "Cormorant", fontSize: 34, color: colors.onSurface, letterSpacing: -0.5 },
  subtitle: { fontFamily: "DMSans", fontSize: 14, color: colors.muted },
}));

// ---------- Skeleton paragraph (OCR loader) ----------
export function SkeletonParagraph({ lines = 6, light }: { lines?: number; light?: boolean }) {
  const { colors } = useTheme();
  const pulse = useSharedValue(0.4);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [pulse]);
  const anim = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const widths = [100, 92, 97, 85, 95, 60, 90, 70];
  return (
    <View testID="ocr-skeleton" style={{ gap: 12, width: "100%" }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Animated.View
          key={i}
          style={[
            anim,
            {
              height: 14,
              borderRadius: 2,
              width: `${widths[i % widths.length]}%`,
              backgroundColor: light ? colors.onSurfaceInverse : colors.surfaceTertiary,
            },
          ]}
        />
      ))}
    </View>
  );
}

// ---------- Toast ----------
export function ToastHost() {
  const { message, kind } = useToast();
  const insets = useSafeAreaInsets();
  const styles = useToastStyles();
  const { colors } = useTheme();
  if (!message) return null;
  const bg = kind === "error" ? colors.error : kind === "success" ? colors.success : colors.surfaceInverse;
  const fg = kind === "error" ? colors.onError : kind === "success" ? colors.onSuccess : colors.onSurfaceInverse;
  const icon: FeatherName = kind === "error" ? "alert-circle" : kind === "success" ? "check-circle" : "info";
  return (
    <View style={[styles.wrap, { pointerEvents: "none" }, { top: insets.top + 12 }]}>
      <Animated.View testID="toast" style={[styles.toast, { backgroundColor: bg }]}>
        <Feather name={icon} size={18} color={fg} />
        <Text testID="toast-message" style={[styles.text, { color: fg }]}>
          {message}
        </Text>
      </Animated.View>
    </View>
  );
}

const useToastStyles = makeStyles((colors) => ({
  wrap: { position: "absolute", left: 16, right: 16, alignItems: "center", zIndex: 1000 },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 4,
    maxWidth: 480,
    width: "100%",
    borderWidth: 1,
    borderColor: colors.border,
  },
  text: { fontFamily: "DMSans", fontSize: 14, flex: 1 },
}));
