"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/use-profile";
import { Button } from "@/components/button";
import { TierBadge } from "@/components/tier-badge";
import { ChallengeCard } from "./challenge-card";
import { RANKED_STAKES, formatChips, friendlyError, type GameMode } from "@/lib/game";

type QueueResult = { status: "queued" | "matched" | "idle"; match_id?: string; window?: number };

const DAILY_COOLDOWN_MS = 20 * 60 * 60 * 1000;

export function Lobby() {
  const router = useRouter();
  const { profile, loadedAt, refresh } = useProfile();
  const [mode, setMode] = useState<Extract<GameMode, "casual" | "ranked">>("ranked");
  const [stake, setStake] = useState<number>(50);
  const [queuing, setQueuing] = useState(false);
  const [queuedAt, setQueuedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [eloWindow, setEloWindow] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const matched = useRef(false);

  const goToMatch = (id: string) => {
    if (matched.current) return;
    matched.current = true;
    router.push(`/match/${id}`);
  };

  // While queued: heartbeat/poll every 1.5s (this is also what pairs us) +
  // realtime insert listener for an instant hand-off when the other side pairs us.
  useEffect(() => {
    if (!queuing || !profile) return;
    const supabase = createClient();
    let cancelled = false;

    const channel = supabase
      .channel(`queue:${profile.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "matches", filter: `player_a=eq.${profile.id}` },
        (p) => goToMatch((p.new as { id: string }).id),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "matches", filter: `player_b=eq.${profile.id}` },
        (p) => goToMatch((p.new as { id: string }).id),
      )
      .subscribe();

    const poll = setInterval(async () => {
      const { data, error } = await supabase.rpc("poll_queue");
      if (cancelled) return;
      if (error) return setError(friendlyError(error));
      const r = data as QueueResult;
      if (r.status === "matched" && r.match_id) goToMatch(r.match_id);
      if (r.window) setEloWindow(r.window);
    }, 1500);

    const clock = setInterval(() => setElapsed(Date.now() - queuedAt), 250);

    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(clock);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queuing, profile?.id, queuedAt]);

  // Leave the queue if the tab closes mid-search.
  useEffect(() => {
    if (!queuing) return;
    const leave = () => void createClient().rpc("leave_queue");
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, [queuing]);

  async function findMatch() {
    setError(null);
    matched.current = false;
    const supabase = createClient();
    const { data, error } = await supabase.rpc("join_queue", {
      p_mode: mode,
      p_stake: mode === "ranked" ? stake : 0,
    });
    if (error) return setError(friendlyError(error));
    const r = data as QueueResult;
    if (r.status === "matched" && r.match_id) return goToMatch(r.match_id);
    setQueuedAt(Date.now());
    setElapsed(0);
    setEloWindow(r.window ?? 50);
    setQueuing(true);
  }

  async function cancel() {
    setQueuing(false);
    await createClient().rpc("leave_queue");
  }

  async function claimDaily() {
    const { error } = await createClient().rpc("claim_daily");
    if (error) return setError(friendlyError(error));
    refresh();
  }

  const canClaim =
    profile &&
    (!profile.last_daily_claim ||
      loadedAt - new Date(profile.last_daily_claim).getTime() > DAILY_COOLDOWN_MS);

  return (
    <div className="flex flex-col gap-6 pt-5">
      {/* Player header: one dominant number (Elo) */}
      <section className="flex items-end justify-between">
        <div>
          <p className="text-sm font-medium text-muted">{profile?.username ?? " "}</p>
          <p className="num text-6xl font-bold leading-none tracking-tight">
            {profile ? profile.elo : "––––"}
          </p>
          <div className="mt-2">{profile && <TierBadge elo={profile.elo} />}</div>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium text-muted">Chips</p>
          <p className="num text-2xl font-bold">{profile ? formatChips(profile.chips) : "–"}</p>
          {canClaim && (
            <motion.button
              whileTap={{ scale: 0.94 }}
              onClick={claimDaily}
              className="mt-1 min-h-9 rounded-full bg-win/15 px-3 text-xs font-bold text-win"
            >
              +250 daily
            </motion.button>
          )}
        </div>
      </section>

      {/* Mode switch */}
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-surface-2 p-1" role="tablist">
        {(["ranked", "casual"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`relative min-h-12 rounded-xl text-sm font-semibold capitalize transition-colors ${
              mode === m ? "text-bg" : "text-muted"
            }`}
          >
            {mode === m && (
              <motion.span
                layoutId="mode-pill"
                className="absolute inset-0 rounded-xl bg-text"
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
              />
            )}
            <span className="relative">{m}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {mode === "ranked" ? (
          <motion.section
            key="ranked"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="space-y-3"
          >
            <p className="text-sm text-muted">Stake — winner takes both. Elo on the line.</p>
            <div className="grid grid-cols-5 gap-2">
              {RANKED_STAKES.map((s) => (
                <motion.button
                  key={s}
                  whileTap={{ scale: 0.92 }}
                  onClick={() => setStake(s)}
                  disabled={!!profile && profile.chips < s}
                  className={`num min-h-12 rounded-xl border text-sm font-bold transition-colors disabled:opacity-30 ${
                    stake === s ? "border-text bg-text text-bg" : "border-border bg-surface"
                  }`}
                >
                  {s}
                </motion.button>
              ))}
            </div>
          </motion.section>
        ) : (
          <motion.p
            key="casual"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="text-sm text-muted"
          >
            No chips, no Elo. Just vibes and practice.
          </motion.p>
        )}
      </AnimatePresence>

      {error && <p role="alert" className="text-sm text-loss">{error}</p>}

      <Button onClick={findMatch} disabled={!profile} className="min-h-16 text-xl">
        Find match
      </Button>

      <ChallengeCard chips={profile?.chips ?? null} onError={setError} />

      {/* Searching overlay */}
      <AnimatePresence>
        {queuing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-30 flex flex-col items-center justify-center gap-8 bg-bg/95 backdrop-blur-md px-6"
          >
            <motion.div
              className="size-28 rounded-full border-4 border-border border-t-text"
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 0.9, ease: "linear" }}
            />
            <div className="text-center">
              <p className="font-display text-3xl font-extrabold">Finding opponent</p>
              <p className="num mt-2 text-muted">
                {Math.floor(elapsed / 1000)}s · {mode === "ranked" ? `±${eloWindow} Elo · ${stake} chips` : "casual"}
              </p>
            </div>
            <Button variant="secondary" onClick={cancel} className="min-w-40">
              Cancel
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
