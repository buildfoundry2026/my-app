import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";

import { api, AuthUser, setSessionToken, setUnauthorizedHandler } from "@/src/api";
import { storage } from "@/src/utils/storage";

WebBrowser.maybeCompleteAuthSession();

const TOKEN_KEY = "qc.session_token";
const AUTH_URL = "https://auth.emergentagent.com/";

type AuthState = {
  loading: boolean;
  user: AuthUser | null;
  signingIn: boolean;
  lastMerged: number;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

const extractSessionId = (url: string | null | undefined): string | null => {
  if (!url) return null;
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};

const stripSessionIdFromWebUrl = () => {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("session_id");
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  hashParams.delete("session_id");
  const hash = hashParams.toString();
  url.hash = hash ? `#${hash}` : "";
  window.history.replaceState(window.history.state, "", url.toString());
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [lastMerged, setLastMerged] = useState(0);
  const usedSessionIds = useRef<Set<string>>(new Set());

  const clearAuth = useCallback(async () => {
    setSessionToken(null);
    await storage.secureRemove(TOKEN_KEY);
    setUser(null);
  }, []);

  const exchange = useCallback(async (sessionId: string): Promise<boolean> => {
    if (usedSessionIds.current.has(sessionId)) return false;
    usedSessionIds.current.add(sessionId);
    try {
      const res = await api.exchangeSession(sessionId);
      setSessionToken(res.session_token);
      await storage.secureSet(TOKEN_KEY, res.session_token);
      setLastMerged(res.merged_quotes);
      setUser(res.user);
      if (Platform.OS === "web") stripSessionIdFromWebUrl();
      return true;
    } catch {
      return false;
    }
  }, []);

  // Boot: process session_id in URL first, then restore stored token.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearAuth();
    });
    let cancelled = false;
    (async () => {
      try {
        let sid: string | null = null;
        if (Platform.OS === "web" && typeof window !== "undefined") {
          sid = extractSessionId(window.location.hash) ?? extractSessionId(window.location.search);
        } else {
          sid = extractSessionId(await Linking.getInitialURL());
        }
        if (sid && (await exchange(sid))) return;

        const stored = await storage.secureGet(TOKEN_KEY, "");
        if (stored) {
          setSessionToken(stored);
          try {
            const me = await api.me();
            if (!cancelled) setUser(me);
          } catch {
            await clearAuth();
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    // Hot deep links (mobile): Android may deliver the callback here instead of result.url
    const sub = Linking.addEventListener("url", ({ url }) => {
      const sid = extractSessionId(url);
      if (sid) exchange(sid);
    });
    return () => {
      cancelled = true;
      sub.remove();
      setUnauthorizedHandler(null);
    };
  }, [clearAuth, exchange]);

  const signIn = useCallback(async () => {
    if (signingIn) return;
    setSigningIn(true);
    try {
      if (Platform.OS === "web") {
        const redirectUrl = `${window.location.origin}/`;
        window.location.href = `${AUTH_URL}?redirect=${encodeURIComponent(redirectUrl)}`;
        return;
      }
      const redirectUrl = Linking.createURL("");
      const authUrl = `${AUTH_URL}?redirect=${encodeURIComponent(redirectUrl)}`;
      let captured: string | null = null;
      const sub = Linking.addEventListener("url", ({ url }) => {
        if (extractSessionId(url)) captured = url;
      });
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      sub.remove();
      const url = (result.type === "success" ? result.url : null) ?? captured ?? (await Linking.getInitialURL());
      const sid = extractSessionId(url);
      if (sid) await exchange(sid);
    } finally {
      setSigningIn(false);
    }
  }, [exchange, signingIn]);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {}
    await clearAuth();
  }, [clearAuth]);

  const value = useMemo(
    () => ({ loading, user, signingIn, lastMerged, signIn, signOut }),
    [loading, user, signingIn, lastMerged, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
