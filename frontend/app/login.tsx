import Feather from "@react-native-vector-icons/feather";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth";
import { makeStyles, useTheme } from "@/src/theme";

const IMAGE =
  "https://images.unsplash.com/photo-1529589941132-43606325dfb4?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTZ8MHwxfHNlYXJjaHwxfHx2aW50YWdlJTIwYm9vayUyMG9wZW4lMjB0ZXh0JTIwYWVzdGhldGljfGVufDB8fHx8MTc5MDg5OTI5NXww&ixlib=rb-4.1.0&q=85";

export default function LoginScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { signIn, signingIn } = useAuth();

  return (
    <View testID="login-screen" style={styles.root}>
      <Image source={{ uri: IMAGE }} style={styles.image} contentFit="cover" transition={300} />
      <LinearGradient colors={["transparent", colors.surfaceInverse]} locations={[0, 0.7]} style={styles.image} />
      <View style={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}>
        <Text style={styles.brand}>QuoteCanvas</Text>
        <View style={{ flex: 1 }} />
        <Text style={styles.eyebrow}>SNAP · CROP · STYLE · SHARE</Text>
        <Text style={styles.title}>Your favourite lines, beautifully kept.</Text>
        <Text style={styles.body}>
          Sign in so your quote history follows you across phones. Quotes already on this device will be merged into
          your account.
        </Text>
        <Pressable
          testID="login-google-button"
          onPress={signIn}
          disabled={signingIn}
          style={({ pressed }) => [styles.button, pressed && { opacity: 0.9 }, signingIn && { opacity: 0.7 }]}
        >
          {signingIn ? (
            <ActivityIndicator color={colors.onSurface} />
          ) : (
            <>
              <Feather name="log-in" size={18} color={colors.onSurface} />
              <Text style={styles.buttonText}>Continue with Google</Text>
            </>
          )}
        </Pressable>
        <Text style={styles.legal}>We only use your email to keep your quotes in sync.</Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surfaceInverse },
  image: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  content: { flex: 1, paddingHorizontal: 24, gap: 12 },
  brand: { fontFamily: "Cormorant", fontSize: 28, color: colors.onSurfaceInverse },
  eyebrow: { fontFamily: "DMSans", fontSize: 12, letterSpacing: 2, color: colors.brandTertiary },
  title: { fontFamily: "Cormorant", fontSize: 42, lineHeight: 46, color: colors.onSurfaceInverse },
  body: { fontFamily: "DMSans", fontSize: 15, lineHeight: 22, color: colors.onSurfaceInverse, opacity: 0.85, marginBottom: 12 },
  button: {
    minHeight: 54,
    borderRadius: 4,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  buttonText: { fontFamily: "DMSans", fontSize: 16, fontWeight: "600", color: colors.onSurface },
  legal: { fontFamily: "DMSans", fontSize: 12, color: colors.onSurfaceInverse, opacity: 0.6, textAlign: "center" },
}));
