import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useMemo } from "react";
import { authClient } from "@/lib/native-auth-client";
import { currentUrl } from "@/lib/authReturnTo";

export const authQuery = queryOptions({
  queryKey: ["native-auth", "session"],
  queryFn: async () => {
    const result = await authClient.getSession();
    if (result.error) throw new Error(result.error.message || "Failed to load session");
    const raw = result.data?.user || null;
    if (!raw) return { user: null, error: null };
    const user = {
      ...raw,
      full_name: raw.name || "",
      display_name: raw.displayName || raw.name || "",
      preferred_market: raw.preferredMarket || "",
      profile_picture_uri: raw.profilePictureId ? `cf-file:${raw.profilePictureId}` : "",
    };
    return { user, error: null };
  },
  staleTime: 30_000,
  retry: false,
});

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const { data, error, isPending } = useQuery(authQuery);
  const value = useMemo(
    () => ({
      user: data?.user ?? null,
      isAuthenticated: !!data?.user,
      isLoadingAuth: isPending,
      authError: error ? { type: "unknown", message: error.message || "Failed to load session" } : null,
      refresh: () => queryClient.fetchQuery({ ...authQuery, staleTime: 0 }),
      logout: async () => {
        await authClient.signOut();
        queryClient.setQueryData(authQuery.queryKey, { user: null, error: null });
        window.location.assign("/login");
      },
      navigateToLogin: () => {
        const returnTo = encodeURIComponent(currentUrl());
        window.location.assign(`/login?returnTo=${returnTo}`);
      },
    }),
    [data, error, isPending, queryClient],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
