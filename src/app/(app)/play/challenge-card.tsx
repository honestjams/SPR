"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/button";
import { CHALLENGE_STAKES, friendlyError } from "@/lib/game";

type Challenge = { code: string; stake: number };

export function ChallengeCard({ chips, onError }: { chips: number | null; onError: (e: string) => void }) {
  const router = useRouter();
  const [stake, setStake] = useState(0);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [copied, setCopied] = useState(false);

  const link = challenge ? `${location.origin}/c/${challenge.code}` : "";

  // Wait for a friend to accept: realtime on our challenge row + 2s poll fallback.
  useEffect(() => {
    if (!challenge) return;
    const supabase = createClient();
    let done = false;
    const go = (matchId: string | null | undefined) => {
      if (matchId && !done) {
        done = true;
        router.push(`/match/${matchId}`);
      }
    };
    const channel = supabase
      .channel(`challenge:${challenge.code}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "challenges", filter: `code=eq.${challenge.code}` },
        (p) => go((p.new as { match_id: string | null }).match_id),
      )
      .subscribe();
    const poll = setInterval(async () => {
      const { data } = await supabase.rpc("get_challenge", { p_code: challenge.code });
      go((data as { match_id?: string } | null)?.match_id);
    }, 2000);
    return () => {
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [challenge, router]);

  async function create() {
    const { data, error } = await createClient().rpc("create_challenge", { p_stake: stake });
    if (error) return onError(friendlyError(error));
    setChallenge(data as Challenge);
  }

  async function cancel() {
    setChallenge(null);
    await createClient().rpc("cancel_challenge");
  }

  async function share() {
    const text = `I challenge you to Scissors Paper Rock${challenge?.stake ? ` for ${challenge.stake} chips` : ""}.`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "SPR challenge", text, url: link });
        return;
      } catch {
        /* user dismissed — fall through to copy */
      }
    }
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="rounded-3xl border border-border bg-surface p-5">
      <AnimatePresence mode="wait" initial={false}>
        {!challenge ? (
          <motion.div key="new" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            <div>
              <h2 className="font-display text-xl font-bold">Challenge a friend</h2>
              <p className="text-sm text-muted">Send a link. No Elo — just bragging rights (and chips).</p>
            </div>
            <div className="grid grid-cols-6 gap-1.5">
              {CHALLENGE_STAKES.map((s) => (
                <motion.button
                  key={s}
                  whileTap={{ scale: 0.92 }}
                  onClick={() => setStake(s)}
                  disabled={chips !== null && chips < s}
                  className={`num min-h-11 rounded-full border text-sm font-semibold transition-colors disabled:opacity-30 ${
                    stake === s ? "border-text bg-text text-bg" : "border-border"
                  }`}
                >
                  {s === 0 ? "Free" : s}
                </motion.button>
              ))}
            </div>
            <Button variant="secondary" onClick={create} className="w-full">
              Create challenge link
            </Button>
          </motion.div>
        ) : (
          <motion.div key="wait" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-bold">Waiting for friend…</h2>
              <motion.span
                className="size-2.5 rounded-full bg-win"
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ repeat: Infinity, duration: 1.2 }}
              />
            </div>
            <p className="num text-center text-4xl font-bold tracking-[0.3em]">{challenge.code}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={cancel}>Cancel</Button>
              <Button onClick={share}>{copied ? "Copied!" : "Share link"}</Button>
            </div>
            <p className="text-center text-xs text-muted">Expires in 15 minutes</p>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
