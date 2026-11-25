import { Suspense } from "react";
import { notFound } from "next/navigation";
import { cacheLife } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { TierBadge } from "@/components/tier-badge";
import { MoveIcon, MOVE_COLOR } from "@/components/move-icon";

export const metadata = { title: "Player" };

async function getProfile(username: string) {
  "use cache";
  cacheLife({ stale: 15, revalidate: 15, expire: 120 });
  const db = createPublicClient();
  const { data: profile, error } = await db
    .from("profiles")
    .select("id, username, elo, wins, losses, games_played, ranked_games, created_at")
    .ilike("username", username.replace(/[%_\\]/g, "\\$&"))
    .maybeSingle();
  if (error) throw new Error(`profile: ${error.message}`); // never cache a failure
  if (!profile) return null;
  const { data: matches, error: mErr } = await db
    .from("matches")
    .select("id, mode, stake, player_a, player_b, score_a, score_b, winner, elo_delta_a, elo_delta_b, finished_at")
    .eq("status", "finished")
    .or(`player_a.eq.${profile.id},player_b.eq.${profile.id}`)
    .order("finished_at", { ascending: false })
    .limit(20);
  if (mErr) throw new Error(`matches: ${mErr.message}`);
  return { profile, matches };
}

export default function ProfilePage({ params }: PageProps<"/u/[username]">) {
  return (
    <Suspense fallback={<div className="pt-5 text-muted">Loading…</div>}>
      <Profile params={params} />
    </Suspense>
  );
}

async function Profile({ params }: { params: PageProps<"/u/[username]">["params"] }) {
  const { username } = await params;
  const data = await getProfile(decodeURIComponent(username));
  if (!data) notFound();
  const { profile: p, matches } = data;
  const winRate = p.games_played ? Math.round((p.wins / p.games_played) * 100) : 0;

  return (
    <div className="space-y-6 pt-5">
      <header className="space-y-2">
        <h1 className="font-display text-4xl font-extrabold tracking-tight">{p.username}</h1>
        <div className="flex items-center gap-2">
          <TierBadge elo={p.elo} />
          <span className="num text-sm text-muted">{p.elo} Elo</span>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-2">
        {[
          ["Played", p.games_played],
          ["Won", p.wins],
          ["Win %", `${winRate}%`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-border bg-surface p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">{label}</p>
            <p className="num mt-1 text-2xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      <section className="space-y-3">
        <h2 className="font-display text-xl font-bold">Recent matches</h2>
        {matches.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <span style={{ color: MOVE_COLOR.rock }}><MoveIcon move="rock" className="size-4" /></span>
            No matches yet.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-surface">
            {matches.map((m) => {
              const isA = m.player_a === p.id;
              const won = m.winner === p.id;
              const delta = isA ? m.elo_delta_a : m.elo_delta_b;
              return (
                <li key={m.id} className="flex min-h-14 items-center gap-3 px-4">
                  <span className={`w-10 text-sm font-bold ${won ? "text-win" : "text-loss"}`}>{won ? "WIN" : "LOSS"}</span>
                  <span className="num flex-1 text-sm">{isA ? m.score_a : m.score_b}–{isA ? m.score_b : m.score_a}</span>
                  <span className="text-xs capitalize text-muted">{m.mode}{m.stake > 0 ? ` · ${m.stake}` : ""}</span>
                  {delta !== null && (
                    <span className={`num w-10 text-right text-sm font-semibold ${delta >= 0 ? "text-win" : "text-loss"}`}>
                      {delta >= 0 ? `+${delta}` : delta}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
