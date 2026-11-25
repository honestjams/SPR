"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/button";
import { signInWithUsername } from "@/app/(auth)/login/actions";

const input =
  "min-h-13 w-full rounded-2xl border border-border bg-surface px-4 text-base outline-none focus:border-text transition-colors";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [error, setError] = useState<string | null>(params.get("error"));
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    const supabase = createClient();

    if (mode === "signup") {
      const email = String(form.get("email"));
      const username = String(form.get("username"));
      if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
        setError("Username: 3–20 letters, numbers or underscores.");
        setBusy(false);
        return;
      }
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { username },
          emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      setBusy(false);
      if (error) return setError(error.message);
      setSent(true);
      return;
    }

    // Sign in with either. Emails go straight to Supabase from the browser;
    // usernames go through a server action so emails are never exposed.
    const identifier = String(form.get("identifier")).trim();
    const result = identifier.includes("@")
      ? await supabase.auth
          .signInWithPassword({ email: identifier, password })
          .then(({ error }) => (error ? { ok: false as const, error: error.message } : { ok: true as const }))
      : await signInWithUsername(identifier, password);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    router.replace(next);
    router.refresh();
  }

  if (sent) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
        <h1 className="font-display text-4xl font-extrabold tracking-tight">Check your email</h1>
        <p className="text-muted">
          We sent you a confirmation link. Tap it and you&apos;ll land straight in the lobby with
          1,000 chips.
        </p>
      </motion.div>
    );
  }

  return (
    <motion.form
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      onSubmit={onSubmit}
      className="flex flex-col gap-3"
    >
      <h1 className="mb-4 font-display text-4xl font-extrabold tracking-tight">
        {mode === "signup" ? "Create account" : "Welcome back"}
      </h1>

      {mode === "signup" && (
        <input name="username" required placeholder="Username" autoComplete="username"
          minLength={3} maxLength={20} className={input} />
      )}
      {mode === "signup" ? (
        <input name="email" type="email" required placeholder="Email" autoComplete="email" className={input} />
      ) : (
        <input name="identifier" type="text" required placeholder="Email or username" autoComplete="username"
          autoCapitalize="none" autoCorrect="off" spellCheck={false} className={input} />
      )}
      <input name="password" type="password" required minLength={8} placeholder="Password"
        autoComplete={mode === "signup" ? "new-password" : "current-password"} className={input} />

      {error && (
        <motion.p
          role="alert"
          initial={{ x: 0 }}
          animate={{ x: [0, -8, 8, -4, 4, 0] }}
          transition={{ duration: 0.35 }}
          className="text-sm text-loss"
        >
          {error}
        </motion.p>
      )}

      <Button type="submit" disabled={busy} className="mt-2 min-h-14 text-lg">
        {busy ? "…" : mode === "signup" ? "Sign up" : "Sign in"}
      </Button>

      <p className="mt-2 text-center text-sm text-muted">
        {mode === "signup" ? (
          <>Have an account? <Link className="font-semibold text-text" href={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link></>
        ) : (
          <>New here? <Link className="font-semibold text-text" href={`/signup?next=${encodeURIComponent(next)}`}>Create an account</Link></>
        )}
      </p>
    </motion.form>
  );
}

/** Only allow same-site relative redirects (prevents open-redirects via ?next=). */
export function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/play";
}
