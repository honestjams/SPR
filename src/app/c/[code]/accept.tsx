"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/button";
import { TierBadge } from "@/components/tier-badge";
import { friendlyError } from "@/lib/game";

type ChallengeInfo = {
  code: string;
  stake: number;
  expired: boolean;
  match_id: string | null;
  creator: { id: string; username: string; elo: number };
};

export function AcceptChallenge() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [info, setInfo] = useState<ChallengeInfo | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    createClient()
      .rpc("get_challenge", { p_code: code })
      .then(({ data }) => setInfo((data as ChallengeInfo | null) ?? null));
  }, [code]);

  async function accept() {
    setBusy(true);
    const { data, error } = await createClient().rpc("accept_challenge", { p_code: code });
    setBusy(false);
    if (error) return setError(friendlyError(error));
    router.replace(`/match/${(data as { match_id: string }).match_id}`);
  }

  if (info === undefined) return <p className="text-center text-muted">Loading challenge…</p>;

  if (!info || info.expired || info.match_id) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="font-display text-4xl font-extrabold">
          {!info ? "Challenge not found" : info.expired ? "Challenge expired" : "Already accepted"}
        </h1>
        <Link href="/play" className="font-semibold underline">Go to lobby</Link>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-8 text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-muted">You&apos;ve been challenged</p>
      <div className="space-y-2">
        <h1 className="font-display text-5xl font-extrabold">{info.creator.username}</h1>
        <div className="flex items-center justify-center gap-2">
          <TierBadge elo={info.creator.elo} />
          <span className="num text-sm text-muted">{info.creator.elo}</span>
        </div>
      </div>
      <p className="text-lg">
        Best of 3 · {info.stake > 0 ? <span className="num font-bold">{info.stake} chips</span> : "for fun"}
      </p>
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
      <Button onClick={accept} disabled={busy} className="w-full min-h-16 text-xl">
        Accept
      </Button>
    </motion.div>
  );
}
