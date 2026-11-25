import Link from "next/link";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-safe pb-safe">
      <header className="py-5">
        <Link href="/" className="font-display text-xl font-extrabold tracking-tight">
          SPR
        </Link>
      </header>
      <div className="flex flex-1 flex-col justify-center pb-16">{children}</div>
    </main>
  );
}
