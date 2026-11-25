-- =============================================================
-- SPR core schema: profiles, chips ledger, matchmaking, matches
-- All game state changes go through SECURITY DEFINER functions
-- (see 20261125000002_game_functions.sql). Clients get read-only
-- access via RLS and can never write game tables directly.
-- =============================================================

create type public.game_mode as enum ('casual', 'ranked', 'friend');
create type public.move as enum ('rock', 'paper', 'scissors');
create type public.match_status as enum ('active', 'finished');
create type public.ledger_reason as enum ('signup_bonus', 'daily_bonus', 'stake', 'payout');

-- -------------------------------------------------------------
-- profiles: public player card. Email deliberately NOT stored here
-- because profiles are publicly readable (leaderboard, profile pages).
-- -------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  username         text not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  avatar_url       text,
  elo              integer not null default 1000,
  chips            bigint  not null default 0 check (chips >= 0),
  games_played     integer not null default 0,
  wins             integer not null default 0,
  losses           integer not null default 0,
  ranked_games     integer not null default 0,
  last_daily_claim timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index profiles_username_lower_idx on public.profiles (lower(username));
create index profiles_leaderboard_idx on public.profiles (elo desc) where ranked_games > 0;

-- -------------------------------------------------------------
-- chip_ledger: append-only record of every chip movement.
-- profiles.chips is a cached balance updated in the same transaction.
-- This is the seam where a crypto wallet will plug in later.
-- -------------------------------------------------------------
create table public.chip_ledger (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  delta         bigint not null,
  reason        public.ledger_reason not null,
  match_id      uuid,
  balance_after bigint not null,
  created_at    timestamptz not null default now()
);
create index chip_ledger_user_idx on public.chip_ledger (user_id, created_at desc);

-- -------------------------------------------------------------
-- matchmaking_queue: one row per waiting player.
-- last_seen is a heartbeat so closed tabs don't get matched.
-- -------------------------------------------------------------
create table public.matchmaking_queue (
  user_id   uuid primary key references public.profiles (id) on delete cascade,
  mode      public.game_mode not null check (mode in ('casual', 'ranked')),
  stake     bigint not null default 0 check (stake >= 0),
  elo       integer not null,
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index matchmaking_queue_pool_idx on public.matchmaking_queue (mode, stake, elo);

-- -------------------------------------------------------------
-- matches: one best-of-3 match. round_no counts throws (draws replay).
-- moved_a/moved_b tell the opponent "locked in" without leaking the move.
-- -------------------------------------------------------------
create table public.matches (
  id              uuid primary key default gen_random_uuid(),
  mode            public.game_mode not null,
  player_a        uuid not null references public.profiles (id),
  player_b        uuid not null references public.profiles (id),
  stake           bigint not null default 0 check (stake >= 0),
  status          public.match_status not null default 'active',
  score_a         integer not null default 0,
  score_b         integer not null default 0,
  round_no        integer not null default 1,
  round_starts_at timestamptz,
  round_deadline  timestamptz,
  moved_a         boolean not null default false,
  moved_b         boolean not null default false,
  winner          uuid references public.profiles (id),
  elo_delta_a     integer,
  elo_delta_b     integer,
  rematch_vote_a  boolean,
  rematch_vote_b  boolean,
  rematch_of      uuid references public.matches (id),
  rematch_id      uuid references public.matches (id),
  created_at      timestamptz not null default now(),
  finished_at     timestamptz,
  check (player_a <> player_b)
);
create index matches_player_a_idx on public.matches (player_a, created_at desc);
create index matches_player_b_idx on public.matches (player_b, created_at desc);
create index matches_active_deadline_idx on public.matches (round_deadline) where status = 'active';
create index matches_winner_idx on public.matches (winner);
create index matches_rematch_of_idx on public.matches (rematch_of);
create index matches_rematch_id_idx on public.matches (rematch_id);

-- -------------------------------------------------------------
-- round_moves: HIDDEN. No RLS policies => no client can read it.
-- Moves only become visible once copied into `rounds` on resolve.
-- -------------------------------------------------------------
create table public.round_moves (
  match_id   uuid not null references public.matches (id) on delete cascade,
  round_no   integer not null,
  player_id  uuid not null references public.profiles (id),
  move       public.move not null,
  created_at timestamptz not null default now(),
  primary key (match_id, round_no, player_id)
);
create index round_moves_player_idx on public.round_moves (player_id);

-- rounds: revealed results of each throw.
create table public.rounds (
  match_id    uuid not null references public.matches (id) on delete cascade,
  round_no    integer not null,
  move_a      public.move not null,
  move_b      public.move not null,
  auto_a      boolean not null default false,  -- true when timed out and randomised
  auto_b      boolean not null default false,
  winner      uuid references public.profiles (id), -- null = draw
  resolved_at timestamptz not null default now(),
  primary key (match_id, round_no)
);
create index rounds_winner_idx on public.rounds (winner);

-- challenges: share-a-link friend matches.
create table public.challenges (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  creator    uuid not null references public.profiles (id) on delete cascade,
  stake      bigint not null default 0 check (stake >= 0),
  expires_at timestamptz not null default now() + interval '15 minutes',
  match_id   uuid references public.matches (id),
  created_at timestamptz not null default now()
);
create index challenges_creator_idx on public.challenges (creator);
create index challenges_match_idx on public.challenges (match_id);

-- =============================================================
-- Row Level Security
-- =============================================================
alter table public.profiles          enable row level security;
alter table public.chip_ledger       enable row level security;
alter table public.matchmaking_queue enable row level security;
alter table public.matches           enable row level security;
alter table public.round_moves       enable row level security;
alter table public.rounds            enable row level security;
alter table public.challenges        enable row level security;

-- Profiles are public (leaderboard / profile pages).
create policy "Profiles are publicly readable"
  on public.profiles for select to anon, authenticated using (true);

-- Players may only edit their own username / avatar (column grants below).
create policy "Players update own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "Players read own ledger"
  on public.chip_ledger for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Players read own queue entry"
  on public.matchmaking_queue for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Participants read their matches; finished matches are public"
  on public.matches for select to anon, authenticated
  using (status = 'finished' or (select auth.uid()) in (player_a, player_b));

create policy "Rounds visible with their match"
  on public.rounds for select to anon, authenticated
  using (exists (
    select 1 from public.matches m
    where m.id = rounds.match_id
      and (m.status = 'finished' or (select auth.uid()) in (m.player_a, m.player_b))
  ));

create policy "Signed-in players can view challenges"
  on public.challenges for select to authenticated using (true);

-- round_moves: intentionally no policies.

-- Lock down direct writes. Supabase grants table privileges broadly by
-- default; RLS already blocks writes without policies, but we revoke too
-- (defence in depth) and re-grant only the editable profile columns.
revoke insert, update, delete on all tables in schema public from anon, authenticated;
grant update (username, avatar_url) on public.profiles to authenticated;

-- =============================================================
-- New user -> profile + 1,000 signup chips
-- =============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := new.raw_user_meta_data ->> 'username';
begin
  if v_username is null
     or v_username !~ '^[A-Za-z0-9_]{3,20}$'
     or exists (select 1 from public.profiles where lower(username) = lower(v_username)) then
    loop
      v_username := 'player' || lpad(floor(random() * 1000000)::int::text, 6, '0');
      exit when not exists (select 1 from public.profiles where lower(username) = lower(v_username));
    end loop;
  end if;

  insert into public.profiles (id, username, chips) values (new.id, v_username, 1000);
  insert into public.chip_ledger (user_id, delta, reason, balance_after)
    values (new.id, 1000, 'signup_bonus', 1000);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute procedure public.touch_updated_at();

-- =============================================================
-- Realtime: clients subscribe to their match + challenge rows and
-- refetch authoritative state on every change.
-- =============================================================
alter publication supabase_realtime add table public.matches, public.challenges;
