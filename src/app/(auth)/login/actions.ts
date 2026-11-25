"use server";

import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";

export type SignInResult = { ok: true } | { ok: false; error: string };

const GENERIC = "Invalid login credentials";
const USERNAME = /^[A-Za-z0-9_]{3,20}$/;

/**
 * Username sign-in. Runs on the server so a username -> email lookup is never
 * possible from the browser (emails stay private). The lookup function only
 * answers when given LOGIN_LOOKUP_TOKEN, which never leaves the server.
 *
 * Unknown usernames return the same message as a wrong password, so this can't
 * be used to probe which usernames exist.
 */
export async function signInWithUsername(username: string, password: string): Promise<SignInResult> {
  if (!USERNAME.test(username) || !password || password.length > 128) {
    return { ok: false, error: GENERIC };
  }

  const token = process.env.LOGIN_LOOKUP_TOKEN;
  if (!token) {
    console.error("LOGIN_LOOKUP_TOKEN is not set");
    return { ok: false, error: "Username sign-in is unavailable right now — use your email." };
  }

  const { data: email, error: lookupError } = await createPublicClient().rpc("resolve_login_email", {
    p_identifier: username,
    p_token: token,
  });
  if (lookupError) {
    console.error("resolve_login_email failed:", lookupError.message);
    return { ok: false, error: "Something went wrong. Try again." };
  }
  if (!email) return { ok: false, error: GENERIC };

  // Server client writes the session cookies, so the browser is signed in on return.
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
