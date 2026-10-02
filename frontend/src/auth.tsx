import type { Session, User } from "@supabase/supabase-js";
import { makeRedirectUri } from "expo-auth-session";
import * as QueryParams from "expo-auth-session/build/QueryParams";
import * as WebBrowser from "expo-web-browser";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import type { AuthUser } from "@/src/api";
import { toast } from "@/src/store";
import { supabase } from "@/src/utils/supabase";

WebBrowser.maybeCompleteAuthSession(); // required for web only

type AuthState = {
  loading: boolean;
  user: AuthUser | null;
  session: Session | null;
  signingIn: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

const toAuthUser = (u: User): AuthUser => ({
  user_id: u.id,
  email: u.email ?? "",
  name: (u.user_metadata?.full_name as string | undefined) ?? (u.user_metadata?.name as string | undefined) ?? null,
  picture: (u.user_metadata?.avatar_url as string | undefined) ?? (u.user_metadata?.picture as string | undefined) ?? null,
  created_at: u.created_at,
});

const createSessionFromUrl = async (url: string) => {
  const { params, errorCode } = QueryParams.getQueryParams(url);
  if (errorCode) throw new Error(params.error_description || errorCode);
  const { access_token, refresh_token } = params;
  if (!access_token) return null;
  const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) throw error;
  return data.session;
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!cancelled) setSession(data.session);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async () => {
    if (signingIn) return;
    setSigningIn(true);
    try {
      // Expo Go: exp://<lan-ip>:<metro-port>. Builds: frontend:// (app.json scheme).
      // Supabase only honours redirectTo if it matches the dashboard's Redirect URLs
      // allow list; otherwise it silently falls back to the Site URL (localhost).
      const redirectTo = makeRedirectUri({ scheme: "frontend" });
      if (__DEV__) console.log(`[auth] OAuth redirectTo: ${redirectTo}`);
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) throw error;
      const res = await WebBrowser.openAuthSessionAsync(data?.url ?? "", redirectTo);
      if (res.type === "success") {
        const created = await createSessionFromUrl(res.url);
        if (!created) throw new Error("Sign-in didn't return a session.");
      } else if (__DEV__) {
        console.warn(
          `[auth] Sign-in browser closed without returning to the app. If it landed on localhost, add ${redirectTo} to Supabase > Authentication > URL Configuration > Redirect URLs.`,
        );
      }
    } catch (e: any) {
      toast(e?.message || "Google sign-in failed. Please try again.", "error");
    } finally {
      setSigningIn(false);
    }
  }, [signingIn]);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) toast("Couldn't sign out. Please try again.", "error");
  }, []);

  const user = useMemo(() => (session?.user ? toAuthUser(session.user) : null), [session]);

  const value = useMemo(
    () => ({ loading, user, session, signingIn, signIn, signOut }),
    [loading, user, session, signingIn, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
