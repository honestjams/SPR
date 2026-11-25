import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { TierBadge } from "@/components/tier-badge";
import { TIERS } from "@/lib/game";

export const metadata = { title: "Leaderboard" };

/** Cached on the server for 30s: instant loads, and no DB hit per visitor. */
async function getTopPlayers() {
  "use cache";
  cacheLife({ stale: 30, revalidate: 30, expire: 300 });
  cacheTag("leaderboard");
  const { data, error } = await createPublicClient()
    .from("profiles")
    .select("id, username, elo, wins, losses, ranked_games")
    .gt("ranked_games", 0)
    .order("elo", { ascending: false })
    .limit(100);
  // Throw rather than return [] so a transient DB error is never cached as "empty".
  if (error) throw new Error(`leaderboard: ${error.message}`);
  return data;
}

export default function LeaderboardPage() {
  return (
    <div className="space-y-6 pt-5">
      <h1 className="font-display text-4xl font-extrabold tracking-tight">Leaderboard</h1>

      <div className="flex flex-wrap gap-2">
        {[...TIERS].reverse().map((t) => (
          <span key={t.name} className="text-xs text-muted">
            <span className="font-semibold" style={{ color: t.color }}>{t.name}</span>{" "}
            <span className="num">{Number.isFinite(t.min) ? `${t.min}+` : `<900`}</span>
          </span>
        ))}
      </div>

      <Suspense fallback={<div className="h-64 animate-pulse rounded-3xl bg-surface" />}>
        <PlayerList />
      </Suspense>
    </div>
  );
}

/** Rendered per request (not at build) so deploys never depend on the DB; data still comes from the 30s cache. */
async function PlayerList() {
  await connection();
  const players = await getTopPlayers();
  return (
    <>
      {players.length === 0 ? (
        <div className="rounded-3xl border border-border bg-surface p-6 text-center">
          <p className="font-display text-xl font-bold">No ranked players yet</p>
          <p className="mt-1 text-sm text-muted">Win a ranked match and claim the top spot.</p>
          <Link href="/play" className="mt-4 inline-block font-semibold underline">Play ranked</Link>
        </div>
      ) : (
        <ol className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-surface">
          {players.map((p, i) => (
            <li key={p.id}>
              <Link href={`/u/${p.username}`} className="flex min-h-16 items-center gap-4 px-4 active:bg-surface-2">
                <span className={`num w-7 text-right font-bold ${i < 3 ? "text-text" : "text-muted"}`}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.username}</p>
                  <p className="num text-xs text-muted">{p.wins}W · {p.losses}L</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="num font-bold">{p.elo}</span>
                  <TierBadge elo={p.elo} />
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
