import { tierFor } from "@/lib/game";

export function TierBadge({ elo, className = "" }: { elo: number; className?: string }) {
  const tier = tierFor(elo);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}
      style={{ color: tier.color, background: `color-mix(in srgb, ${tier.color} 14%, transparent)` }}
    >
      <span className="size-1.5 rounded-full" style={{ background: tier.color }} />
      {tier.name}
    </span>
  );
}
