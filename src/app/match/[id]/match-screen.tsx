"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AnimatePresence, animate, motion } from "motion/react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/button";
import { MoveIcon, MOVE_COLOR } from "@/components/move-icon";
import { TierBadge } from "@/components/tier-badge";
import {
  MOVES, MOVE_KEYS, MOVE_LABEL, REMATCH_WINDOW_MS, THROW_MS,
  friendlyError, type MatchState, type Move, type RoundRow,
} from "@/lib/game";

const REVEAL_HOLD_MS = 2200; // how long the final throw is shown before the result card

/** Keyed by match id so a rematch gets completely fresh state. */
export function MatchScreen() {
  const { id } = useParams<{ id: string }>();
  return <Match key={id} id={id} />;
}

/** Monotonic "freshness" so an out-of-order response never rolls state back. */
function version(s: MatchState) {
  const m = s.match;
  return (
    s.rounds.length * 1000 +
    (m.status === "finished" ? 500 : 0) +
    (m.rematch_id ? 100 : 0) +
    (m.rematch_vote_a !== null ? 10 : 0) + (m.rematch_vote_b !== null ? 10 : 0) +
    (m.moved_a ? 1 : 0) + (m.moved_b ? 1 : 0)
  );
}

function Match({ id }: { id: string }) {
  const router = useRouter();
  const [state, setState] = useState<MatchState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0); // set on first tick / response
  const [pending, setPending] = useState<{ round: number; move: Move } | null>(null);
  const [offset, setOffset] = useState(0); // server clock − client clock (ms)
  const lastTick = useRef(0);

  const apply = useCallback((s: MatchState, sentAt: number) => {
    const receivedAt = Date.now();
    setOffset(Date.parse(s.server_now) - (sentAt + receivedAt) / 2);
    setNow(receivedAt);
    setState((prev) => (prev && version(s) < version(prev) ? prev : s));
  }, []);

  const fetchState = useCallback(async () => {
    const sentAt = Date.now();
    const { data, error } = await createClient().rpc("get_match_state", { p_match: id });
    if (error) return setError(friendlyError(error));
    apply(data as unknown as MatchState, sentAt);
  }, [id, apply]);

  // Live updates, three layers (fastest first):
  //  1. Broadcast "nudge" from the opponent's browser right after they act (~50ms).
  //  2. Postgres change events on our match row (covers server-side changes like the sweeper).
  //  3. Polling: 1s until realtime is connected, then a 3s safety net for dropped messages.
  // Nudges carry no data — every layer just refetches the authoritative server state.
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    // Initial load. State is set asynchronously once the RPC resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchState();
    const channel = supabase
      .channel(`match:${id}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "nudge" }, () => fetchState())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "matches", filter: `id=eq.${id}` }, () => fetchState())
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    channelRef.current = channel;
    const onVisible = () => document.visibilityState === "visible" && fetchState();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [id, fetchState]);

  useEffect(() => {
    const poll = setInterval(fetchState, live ? 3000 : 1000);
    return () => clearInterval(poll);
  }, [live, fetchState]);

  const nudge = useCallback(() => {
    channelRef.current?.send({ type: "broadcast", event: "nudge", payload: {} });
  }, []);

  // 10 Hz clock drives the countdown ring.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  const serverNow = now + offset;
  const m = state?.match;
  const me = state?.me ?? "a";
  const opp = me === "a" ? "b" : "a";

  // Past the deadline? Ask the server to resolve (auto-random for whoever didn't move).
  useEffect(() => {
    if (!m || m.status !== "active" || !m.round_deadline) return;
    if (serverNow < Date.parse(m.round_deadline) + 900) return;
    if (Date.now() - lastTick.current < 1500) return;
    lastTick.current = Date.now();
    const sentAt = Date.now();
    createClient()
      .rpc("tick_match", { p_match: id })
      .then(({ data }) => {
        if (!data) return;
        nudge();
        apply(data as unknown as MatchState, sentAt);
      });
  }, [m, serverNow, id, apply, nudge]);

  // Both voted yes → jump into the rematch.
  useEffect(() => {
    if (m?.rematch_id) router.replace(`/match/${m.rematch_id}`);
  }, [m?.rematch_id, router]);

  const myMove: Move | null =
    state?.my_move ?? (pending && m && pending.round === m.round_no ? pending.move : null);

  // Phase machine, all derived from server timestamps.
  const lastRound: RoundRow | undefined = state?.rounds[state.rounds.length - 1];
  let phase: "loading" | "intro" | "throw" | "reveal" | "result" = "loading";
  if (m) {
    if (m.status === "finished") {
      phase = lastRound && serverNow < Date.parse(lastRound.resolved_at) + REVEAL_HOLD_MS ? "reveal" : "result";
    } else if (m.round_starts_at && serverNow < Date.parse(m.round_starts_at)) {
      phase = state!.rounds.length === 0 ? "intro" : "reveal";
    } else {
      phase = "throw";
    }
  }

  const throwOpen = phase === "throw" && !myMove;

  const play = useCallback(
    async (move: Move) => {
      if (!m || !throwOpen) return;
      setPending({ round: m.round_no, move });
      navigator.vibrate?.(10);
      const sentAt = Date.now();
      const { data, error } = await createClient().rpc("submit_move", { p_match: m.id, p_move: move });
      if (error) return setError(friendlyError(error));
      nudge();
      apply(data as unknown as MatchState, sentAt);
    },
    [m, throwOpen, apply, nudge],
  );

  // Keyboard: 1/2/3 or R/P/S.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const move = MOVE_KEYS[e.key.toLowerCase()];
      if (move) play(move);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [play]);

  if (error && !state) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="font-display text-3xl font-extrabold">{error}</p>
        <Link href="/play" className="font-semibold underline">Back to lobby</Link>
      </main>
    );
  }
  if (!state || !m) return <main className="min-h-dvh" />;

  const players = state.players;
  const myScore = me === "a" ? m.score_a : m.score_b;
  const oppScore = me === "a" ? m.score_b : m.score_a;
  const oppMoved = me === "a" ? m.moved_b : m.moved_a;
  const myId = players[me].id;
  const lostLastRound = lastRound && lastRound.winner && lastRound.winner !== myId;

  return (
    <motion.main
      animate={phase === "reveal" && lostLastRound ? { x: [0, -10, 10, -6, 6, 0] } : {}}
      transition={{ duration: 0.4, delay: 0.35 }}
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-safe pb-safe"
    >
      {/* Opponent */}
      <PlayerBar name={players[opp].username} elo={players[opp].elo} score={oppScore} mode={m.mode}
        right={m.stake > 0 ? <span className="num text-sm font-bold">{m.stake * 2} pot</span> : null} />

      <section className="relative flex flex-1 flex-col items-center justify-center py-6">
        <AnimatePresence mode="wait">
          {phase === "intro" && (
            <Intro key="intro" seconds={Math.ceil((Date.parse(m.round_starts_at!) - serverNow) / 1000)} />
          )}
          {phase === "throw" && (
            <ThrowStage
              key={`throw-${m.round_no}`}
              remaining={Math.max(0, Date.parse(m.round_deadline!) - serverNow)}
              myMove={myMove}
              oppMoved={oppMoved}
              roundNo={state.rounds.length + 1}
            />
          )}
          {phase === "reveal" && lastRound && (
            <Reveal key={`reveal-${lastRound.round_no}`} round={lastRound} me={me} myId={myId} />
          )}
          {phase === "result" && (
            <Result key="result" state={state} serverNow={serverNow} onVoted={apply} onError={setError} nudge={nudge} />
          )}
        </AnimatePresence>
      </section>

      {phase !== "result" && (
        <>
          <div className="grid grid-cols-3 gap-3 pb-4">
            {MOVES.map((mv) => {
              const chosen = myMove === mv;
              return (
                <motion.button
                  key={mv}
                  onClick={() => play(mv)}
                  disabled={!throwOpen}
                  whileTap={{ scale: 0.9 }}
                  animate={{ scale: chosen ? 1.06 : 1, opacity: myMove && !chosen ? 0.25 : throwOpen || chosen ? 1 : 0.45 }}
                  transition={{ type: "spring", stiffness: 600, damping: 28 }}
                  aria-label={MOVE_LABEL[mv]}
                  className="flex aspect-square flex-col items-center justify-center gap-1 rounded-3xl border-2 bg-surface"
                  style={{ color: MOVE_COLOR[mv], borderColor: chosen ? MOVE_COLOR[mv] : "var(--border)" }}
                >
                  <MoveIcon move={mv} className="size-14" />
                  <span className="text-xs font-semibold text-muted">{MOVE_LABEL[mv]}</span>
                </motion.button>
              );
            })}
          </div>
          <PlayerBar name={`${players[me].username} (you)`} elo={players[me].elo} score={myScore} mode={m.mode} />
        </>
      )}
    </motion.main>
  );
}

function PlayerBar({ name, elo, score, mode, right }: {
  name: string; elo: number; score: number; mode: string; right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-4">
      <div className="min-w-0">
        <p className="truncate font-semibold">{name}</p>
        <div className="flex items-center gap-2">
          {mode === "ranked" && <TierBadge elo={elo} />}
          <span className="num text-xs text-muted">{elo}</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {right}
        <div className="flex gap-1.5" aria-label={`${score} of 2 rounds won`}>
          {[0, 1].map((i) => (
            <motion.span
              key={i}
              animate={{ scale: i < score ? [1, 1.4, 1] : 1 }}
              className={`size-3.5 rounded-full ${i < score ? "bg-win" : "bg-surface-2 border border-border"}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Intro({ seconds }: { seconds: number }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, transition: { duration: 0.08 } }} className="text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-muted">Match found</p>
      <motion.p key={seconds} initial={{ scale: 1.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="num font-display text-8xl font-extrabold">
        {Math.max(1, seconds)}
      </motion.p>
      <p className="text-muted">Best of 3 · 5s per throw</p>
    </motion.div>
  );
}

/** Signature element: a ring that drains over the 5-second throw window. */
function ThrowStage({ remaining, myMove, oppMoved, roundNo }: {
  remaining: number; myMove: Move | null; oppMoved: boolean; roundNo: number;
}) {
  const R = 88;
  const C = 2 * Math.PI * R;
  const frac = Math.min(1, remaining / THROW_MS);
  const urgent = remaining < 2000 && !myMove;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.08 } }} className="flex flex-col items-center gap-5">
      <p className="text-sm font-semibold uppercase tracking-widest text-muted">Throw {roundNo}</p>
      <div className="relative grid size-52 place-items-center">
        <svg viewBox="0 0 200 200" className="absolute inset-0 -rotate-90">
          <circle cx="100" cy="100" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="10" />
          <motion.circle
            cx="100" cy="100" r={R} fill="none" strokeWidth="10" strokeLinecap="round"
            stroke={myMove ? MOVE_COLOR[myMove] : urgent ? "var(--loss)" : "var(--text)"}
            strokeDasharray={C}
            animate={{ strokeDashoffset: C * (1 - frac) }}
            transition={{ duration: 0.1, ease: "linear" }}
          />
        </svg>
        <AnimatePresence mode="wait">
          {myMove ? (
            <motion.div key="locked" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 20 }} style={{ color: MOVE_COLOR[myMove] }}>
              <MoveIcon move={myMove} className="size-24" />
            </motion.div>
          ) : (
            <motion.p key="time" className={`num text-6xl font-bold ${urgent ? "text-loss" : ""}`}>
              {Math.ceil(remaining / 1000)}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
      <div className="flex h-8 items-center gap-2">
        <span className="text-sm font-semibold">{myMove ? "Locked in" : "Pick your move"}</span>
        {oppMoved && (
          <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-muted">
            Opponent locked in
          </motion.span>
        )}
      </div>
    </motion.div>
  );
}

/** The clash: opponent's hand drops from the top, yours rises from the bottom. */
function Reveal({ round, me, myId }: { round: RoundRow; me: "a" | "b"; myId: string }) {
  const mine = me === "a" ? round.move_a : round.move_b;
  const theirs = me === "a" ? round.move_b : round.move_a;
  const myAuto = me === "a" ? round.auto_a : round.auto_b;
  const theirAuto = me === "a" ? round.auto_b : round.auto_a;
  const outcome = !round.winner ? "draw" : round.winner === myId ? "win" : "loss";
  const spring = { type: "spring", stiffness: 420, damping: 18 } as const;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.08 } }} exit={{ opacity: 0, transition: { duration: 0.08 } }} className="flex flex-col items-center gap-4">
      <motion.div initial={{ y: -80, opacity: 0 }} animate={{ y: 0, opacity: outcome === "win" ? 0.35 : 1 }} transition={spring}
        style={{ color: MOVE_COLOR[theirs] }} className="flex flex-col items-center">
        <MoveIcon move={theirs} className="size-24" />
        {theirAuto && <span className="text-xs text-muted">timed out · random</span>}
      </motion.div>
      <motion.p initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...spring, delay: 0.25 }}
        className={`font-display text-4xl font-extrabold ${outcome === "win" ? "text-win" : outcome === "loss" ? "text-loss" : ""}`}>
        {outcome === "win" ? "You take it" : outcome === "loss" ? "Round lost" : "Draw — again!"}
      </motion.p>
      <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: outcome === "loss" ? 0.35 : 1 }} transition={spring}
        style={{ color: MOVE_COLOR[mine] }} className="flex flex-col items-center">
        {myAuto && <span className="text-xs text-muted">timed out · random</span>}
        <MoveIcon move={mine} className="size-24" />
      </motion.div>
    </motion.div>
  );
}

function CountUp({ to, prefix = "" }: { to: number; prefix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const c = animate(0, to, {
      duration: 0.9,
      ease: "easeOut",
      onUpdate: (v) => ref.current && (ref.current.textContent = `${prefix}${Math.round(v)}`),
    });
    return () => c.stop();
  }, [to, prefix]);
  return <span ref={ref} className="num">{prefix}0</span>;
}

function Result({ state, serverNow, onVoted, onError, nudge }: {
  state: MatchState;
  serverNow: number;
  onVoted: (s: MatchState, sentAt: number) => void;
  onError: (e: string) => void;
  nudge: () => void;
}) {
  const m = state.match;
  const me = state.me;
  const myId = state.players[me].id;
  const won = m.winner === myId;
  const eloDelta = me === "a" ? m.elo_delta_a : m.elo_delta_b;
  const myVote = me === "a" ? m.rematch_vote_a : m.rematch_vote_b;
  const oppVote = me === "a" ? m.rematch_vote_b : m.rematch_vote_a;
  const nextStake = m.stake * 2;
  const msLeft = Date.parse(m.finished_at!) + REMATCH_WINDOW_MS - serverNow;
  const declined = myVote === false || oppVote === false;
  const canAfford = state.players[me].chips >= nextStake;
  const [note, setNote] = useState<string | null>(null);

  async function vote(accept: boolean) {
    const sentAt = Date.now();
    const { data, error } = await createClient().rpc("vote_rematch", { p_match: m.id, p_accept: accept });
    if (error) return onError(friendlyError(error));
    nudge();
    const r = data as { status: string };
    if (r.status === "insufficient_chips") setNote("Someone can't cover the doubled stake.");
    if (r.status === "expired") setNote("Rematch window closed.");
    // Pull fresh state so both votes show immediately.
    const { data: s } = await createClient().rpc("get_match_state", { p_match: m.id });
    if (s) onVoted(s as unknown as MatchState, sentAt);
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex w-full flex-col items-center gap-8 text-center">
      <div>
        <motion.h1 initial={{ scale: 0.7 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 14 }}
          className={`font-display text-7xl font-extrabold tracking-tight ${won ? "text-win" : "text-loss"}`}>
          {won ? "Victory" : "Defeat"}
        </motion.h1>
        <p className="num mt-1 text-2xl font-bold text-muted">
          {me === "a" ? m.score_a : m.score_b} – {me === "a" ? m.score_b : m.score_a}
        </p>
      </div>

      <div className="flex gap-8">
        {eloDelta !== null && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">Elo</p>
            <p className={`text-3xl font-bold ${eloDelta >= 0 ? "text-win" : "text-loss"}`}>
              <CountUp to={Math.abs(eloDelta)} prefix={eloDelta >= 0 ? "+" : "−"} />
            </p>
          </div>
        )}
        {m.stake > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">Chips</p>
            <p className={`text-3xl font-bold ${won ? "text-win" : "text-loss"}`}>
              <CountUp to={m.stake} prefix={won ? "+" : "−"} />
            </p>
          </div>
        )}
      </div>

      {/* Rematch / double or nothing — both players must agree */}
      <div className="w-full rounded-3xl border border-border bg-surface p-5">
        {msLeft <= 0 || declined ? (
          <p className="text-muted">{declined ? "Rematch declined" : "Rematch window closed"}</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-baseline justify-between">
              <p className="font-display text-xl font-bold">
                {m.stake > 0 ? <>Double or nothing · <span className="num">{nextStake}</span></> : "Rematch?"}
              </p>
              <span className="num text-sm text-muted">{Math.ceil(msLeft / 1000)}s</span>
            </div>
            {myVote ? (
              <p className="text-sm text-muted">
                {oppVote ? "Starting…" : "You're in. Waiting for opponent…"}
              </p>
            ) : (
              <>
                {oppVote && <p className="text-sm font-semibold text-win">Opponent wants a rematch!</p>}
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={() => vote(false)}>No thanks</Button>
                  <Button onClick={() => vote(true)} disabled={!canAfford}>
                    {canAfford ? "I'm in" : "Not enough chips"}
                  </Button>
                </div>
              </>
            )}
            {note && <p className="text-sm text-loss">{note}</p>}
          </div>
        )}
      </div>

      <Link href="/play" className="min-h-12 font-semibold text-muted">Back to lobby</Link>
    </motion.div>
  );
}
