import { Suspense } from "react";
import { BottomNav, NavBar } from "@/components/bottom-nav";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <main className="mx-auto w-full max-w-md flex-1 px-5 pt-safe pb-28">{children}</main>
      <Suspense fallback={<NavBar path={null} />}>
        <BottomNav />
      </Suspense>
    </>
  );
}
