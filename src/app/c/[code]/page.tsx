import { Suspense } from "react";
import { AcceptChallenge } from "./accept";

export const metadata = { title: "Challenge" };

export default function ChallengePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 pt-safe pb-safe">
      <Suspense>
        <AcceptChallenge />
      </Suspense>
    </main>
  );
}
