import { Redirect } from "expo-router";

import { useAuth } from "@/src/auth";

export default function Index() {
  const { user } = useAuth();
  return <Redirect href={user ? "/(tabs)" : "/login"} />;
}
