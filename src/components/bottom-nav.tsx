"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/play", label: "Play" },
  { href: "/leaderboard", label: "Ranks" },
  { href: "/settings", label: "You" },
];

/** Pure markup, so it can render in the static shell as the Suspense fallback. */
export function NavBar({ path }: { path: string | null }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-bg/85 backdrop-blur-lg pb-safe">
      <ul className="mx-auto grid max-w-md grid-cols-3">
        {TABS.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              className={`flex min-h-14 items-center justify-center text-sm font-semibold transition-colors ${
                path?.startsWith(t.href) ? "text-text" : "text-muted"
              }`}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function BottomNav() {
  return <NavBar path={usePathname()} />;
}
