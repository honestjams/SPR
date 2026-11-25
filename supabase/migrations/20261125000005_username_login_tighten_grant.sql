-- Only the Next.js server (anon role + LOGIN_LOOKUP_TOKEN) calls resolve_login_email.
-- Signed-in users never need it.
revoke execute on function public.resolve_login_email(text, text) from authenticated;
