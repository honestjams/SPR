import type { Move } from "@/lib/game";

/**
 * Minimal geometric glyphs: Rock = solid circle, Paper = sheet,
 * Scissors = crossed blades. Inline SVG = zero network cost.
 */
export function MoveIcon({ move, className = "" }: { move: Move; className?: string }) {
  const common = { viewBox: "0 0 48 48", className, "aria-hidden": true } as const;
  if (move === "rock") {
    return (
      <svg {...common}>
        <circle cx="24" cy="24" r="15" fill="currentColor" />
      </svg>
    );
  }
  if (move === "paper") {
    return (
      <svg {...common}>
        <rect x="11" y="8" width="26" height="32" rx="4" fill="currentColor" />
        <path d="M17 18h14M17 24h14M17 30h9" stroke="var(--surface)" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M12 10 L36 38 M36 10 L12 38" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <circle cx="12" cy="10" r="4.5" fill="currentColor" />
      <circle cx="36" cy="10" r="4.5" fill="currentColor" />
    </svg>
  );
}

export const MOVE_COLOR: Record<Move, string> = {
  rock: "var(--rock)",
  paper: "var(--paper)",
  scissors: "var(--scissors)",
};
