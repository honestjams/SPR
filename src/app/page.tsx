import Link from "next/link";
import { MoveIcon, MOVE_COLOR } from "@/components/move-icon";
import { MOVES } from "@/lib/game";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-safe">
      <header className="flex items-center justify-between py-5">
        <span className="font-display text-xl font-extrabold tracking-tight">SPR</span>
        <Link href="/leaderboard" className="text-sm font-semibold text-muted">
          Leaderboard
        </Link>
      </header>

      <section className="flex flex-1 flex-col justify-center gap-10 py-10">
        <div className="flex gap-3">
          {MOVES.map((m) => (
            <div
              key={m}
              className="grid size-20 place-items-center rounded-3xl bg-surface border border-border"
              style={{ color: MOVE_COLOR[m] }}
            >
              <MoveIcon move={m} className="size-10" />
            </div>
          ))}
        </div>

        <h1 className="font-display text-6xl font-extrabold leading-[0.95] tracking-tight">
          Scissors.
          <br />
          Paper.
          <br />
          Rock.
        </h1>

        <p className="text-lg text-muted">
          Real opponents. Best of three. Climb the ranks with Elo matchmaking — and
          go double or nothing when it gets personal.
        </p>
      </section>

      <div className="flex flex-col gap-3 pb-8 pb-safe">
        <Link
          href="/play"
          className="flex min-h-14 items-center justify-center rounded-2xl bg-text text-lg font-semibold text-bg active:scale-[0.97] transition-transform"
        >
          Play now
        </Link>
        <Link
          href="/signup"
          className="flex min-h-14 items-center justify-center rounded-2xl border border-border bg-surface font-semibold active:scale-[0.97] transition-transform"
        >
          Create account — get 1,000 free chips
        </Link>
      </div>
    </main>
  );
}
