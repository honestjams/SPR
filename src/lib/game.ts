import type { Enums, Tables } from "@/types/database";

export type Move = Enums<"move">;
export type GameMode = Enums<"game_mode">;
export type MatchRow = Tables<"matches">;
export type RoundRow = Tables<"rounds">;

export type PlayerLite = {
  id: string;
  username: string;
  elo: number;
  avatar_url: string | null;
  chips: number;
};

export type MatchState = {
  match: MatchRow;
  me: "a" | "b";
  server_now: string;
  players: { a: PlayerLite; b: PlayerLite };
  rounds: RoundRow[];
  my_move: Move | null;
};

export const MOVES: Move[] = ["rock", "paper", "scissors"];
export const RANKED_STAKES = [10, 50, 100, 250, 500] as const;
export const CHALLENGE_STAKES = [0, 10, 50, 100, 250, 500] as const;
export const THROW_MS = 5000;
export const REMATCH_WINDOW_MS = 30_000;

export const MOVE_LABEL: Record<Move, string> = {
  rock: "Rock",
  paper: "Paper",
  scissors: "Scissors",
};

export const MOVE_KEYS: Record<string, Move> = {
  "1": "rock", r: "rock",
  "2": "paper", p: "paper",
  "3": "scissors", s: "scissors",
};

export function beats(a: Move, b: Move) {
  return (
    (a === "rock" && b === "scissors") ||
    (a === "paper" && b === "rock") ||
    (a === "scissors" && b === "paper")
  );
}

export type Tier = { name: string; min: number; color: string };

export const TIERS: Tier[] = [
  { name: "Champion", min: 1800, color: "var(--tier-champion)" },
  { name: "Diamond", min: 1500, color: "var(--tier-diamond)" },
  { name: "Platinum", min: 1300, color: "var(--tier-platinum)" },
  { name: "Gold", min: 1100, color: "var(--tier-gold)" },
  { name: "Silver", min: 900, color: "var(--tier-silver)" },
  { name: "Bronze", min: -Infinity, color: "var(--tier-bronze)" },
];

export function tierFor(elo: number): Tier {
  return TIERS.find((t) => elo >= t.min)!;
}

/** Map Postgres exception codes from our RPCs to friendly copy. */
const ERRORS: Record<string, string> = {
  insufficient_chips: "Not enough chips for that stake.",
  invalid_stake: "That stake isn't available.",
  player_already_in_match: "Finish your current match first.",
  challenge_not_found: "That challenge link doesn't exist.",
  challenge_expired: "That challenge has expired.",
  challenge_taken: "Someone already accepted that challenge.",
  cannot_accept_own_challenge: "You can't accept your own challenge — send the link to a friend.",
  not_a_participant: "You're not in this match.",
  match_not_found: "Match not found.",
  not_authenticated: "Please sign in again.",
};

export function friendlyError(err: unknown): string {
  const msg =
    typeof err === "object" && err && "message" in err ? String(err.message) : String(err);
  return ERRORS[msg] ?? "Something went wrong. Try again.";
}

export function formatChips(n: number) {
  return new Intl.NumberFormat("en-AU").format(n);
}
