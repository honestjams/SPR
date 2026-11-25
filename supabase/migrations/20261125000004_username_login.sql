-- =============================================================
-- Sign in with username OR email.
--
-- Emails are private (never in public.profiles), so turning a username
-- into an email must not be possible from the browser. The lookup below
-- only works when called with a server-side token (LOGIN_LOOKUP_TOKEN,
-- held by the Next.js server). Only the token's SHA-256 hash lives in the
-- database, in a schema the API does not expose.
--
-- Least privilege: a leaked token allows username->email lookups only,
-- unlike Supabase's service-role key which bypasses all RLS.
-- =============================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.server_tokens (
  name       text primary key,
  token_hash bytea not null,
  created_at timestamptz not null default now()
);
revoke all on private.server_tokens from public, anon, authenticated;

create or replace function public.resolve_login_email(p_identifier text, p_token text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hash bytea;
  v_email text;
begin
  select token_hash into v_hash from private.server_tokens where name = 'login_lookup';
  if v_hash is null
     or p_token is null
     or extensions.digest(p_token, 'sha256') <> v_hash then
    raise exception 'forbidden';
  end if;

  if position('@' in p_identifier) > 0 then
    return lower(trim(p_identifier));
  end if;

  select u.email into v_email
    from public.profiles p
    join auth.users u on u.id = p.id
   where lower(p.username) = lower(trim(p_identifier));
  return v_email; -- null when unknown; caller shows a generic error
end;
$$;

revoke execute on function public.resolve_login_email(text, text) from public, anon, authenticated;
-- The Next.js server calls this with the publishable key (anon role) + the token.
grant execute on function public.resolve_login_email(text, text) to anon, authenticated;

-- The token hash itself is inserted out-of-band (never committed):
--   insert into private.server_tokens (name, token_hash)
--   values ('login_lookup', extensions.digest('<token>', 'sha256'))
--   on conflict (name) do update set token_hash = excluded.token_hash, created_at = now();
