import { Suspense } from "react";
import { MatchScreen } from "./match-screen";

export const metadata = { title: "Match" };

export default function MatchPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <MatchScreen />
    </Suspense>
  );
}
