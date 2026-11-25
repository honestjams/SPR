"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/types/database";

export type Profile = Tables<"profiles">;

async function loadProfile(): Promise<Profile | null> {
  const supabase = createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims?.sub;
  if (!uid) return null;
  const { data } = await supabase.from("profiles").select("*").eq("id", uid).single();
  return data;
}

/** Current user's profile, fetched in the browser (keeps pages statically prerenderable). */
export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState(0); // client time of last load (for cooldown maths)

  const refresh = useCallback(() => {
    return loadProfile().then((p) => {
      setProfile(p);
      setLoadedAt(Date.now());
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    let alive = true;
    loadProfile().then((p) => {
      if (!alive) return;
      setProfile(p);
      setLoadedAt(Date.now());
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  return { profile, loading, loadedAt, refresh, setProfile };
}
