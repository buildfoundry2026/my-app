import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, LogBox, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { AuthProvider, useAuth } from "@/src/auth";
import { ErrorBoundary } from "@/src/components/error-boundary";
import { ToastHost } from "@/src/components/ui";
import { queryClient } from "@/src/query-client";
import { toast } from "@/src/store";
import { useTheme } from "@/src/theme";

// Disable logbox errors etc so that users can see the app
// and agent works as expected.
LogBox.ignoreAllLogs(true);

SplashScreen.preventAutoHideAsync().catch(() => {});

// Single auth gate: null -> /login, authenticated -> app.
function AuthGate() {
  const { loading, user, lastMerged } = useAuth();
  const { colors } = useTheme();

  useEffect(() => {
    if (user) {
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      if (lastMerged > 0) toast(`${lastMerged} quote${lastMerged === 1 ? "" : "s"} from this device merged into your account.`, "success");
    } else {
      queryClient.clear();
    }
  }, [user, lastMerged]);

  if (loading) {
    return (
      <View testID="auth-loading" style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }}>
      <Stack.Protected guard={!user}>
        <Stack.Screen name="login" options={{ animation: "fade" }} />
      </Stack.Protected>
      <Stack.Protected guard={!!user}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="crop" options={{ animation: "fade" }} />
        <Stack.Screen name="editor" options={{ animation: "slide_from_right" }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const { colors } = useTheme();
  const [loaded] = useFonts({
    Cormorant: require("../assets/fonts/CormorantGaramond-SemiBold.ttf"),
    CormorantItalic: require("../assets/fonts/CormorantGaramond-Italic.ttf"),
    DMSans: require("../assets/fonts/DMSans.ttf"),
    CourierPrime: require("../assets/fonts/CourierPrime.ttf"),
  });

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => {});
  }, [loaded]);

  if (!loaded) return null;

  // One app level ErrorBoundary; a render crash shows a reload screen
  // instead of a blank app.
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.surface }}>
            <KeyboardProvider>
              <StatusBar style="dark" />
              <AuthGate />
              <ToastHost />
            </KeyboardProvider>
          </GestureHandlerRootView>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
