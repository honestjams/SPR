"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/use-profile";
import { Button } from "@/components/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { TierBadge } from "@/components/tier-badge";
import { formatChips } from "@/lib/game";

export function SettingsPanel() {
  const router = useRouter();
  const { profile, refresh } = useProfile();
  const [username, setUsername] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function saveUsername(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      return setMsg({ ok: false, text: "3–20 letters, numbers or underscores." });
    }
    const { error } = await createClient().from("profiles").update({ username }).eq("id", profile.id);
    if (error) {
      return setMsg({ ok: false, text: error.code === "23505" ? "That username is taken." : "Couldn't save." });
    }
    setMsg({ ok: true, text: "Saved." });
    setUsername("");
    refresh();
  }

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="space-y-8 pt-5">
      <header className="space-y-2">
        <h1 className="font-display text-4xl font-extrabold tracking-tight">{profile?.username ?? " "}</h1>
        {profile && (
          <div className="flex items-center gap-3 text-sm">
            <TierBadge elo={profile.elo} />
            <span className="num text-muted">{profile.elo} Elo · {formatChips(profile.chips)} chips</span>
          </div>
        )}
        {profile && (
          <Link href={`/u/${profile.username}`} className="inline-block text-sm font-semibold underline">
            View public profile
          </Link>
        )}
      </header>

      <section className="space-y-3">
        <h2 className="font-semibold">Appearance</h2>
        <ThemeToggle />
      </section>

      <form onSubmit={saveUsername} className="space-y-3">
        <h2 className="font-semibold">Change username</h2>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={profile?.username ?? "username"}
          maxLength={20}
          className="min-h-13 w-full rounded-2xl border border-border bg-surface px-4 text-base outline-none focus:border-text"
        />
        {msg && <p className={`text-sm ${msg.ok ? "text-win" : "text-loss"}`}>{msg.text}</p>}
        <Button type="submit" variant="secondary" className="w-full" disabled={!username}>
          Save
        </Button>
      </form>

      <Button variant="ghost" onClick={signOut} className="w-full text-loss">
        Sign out
      </Button>
    </div>
  );
}
