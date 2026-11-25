-- =============================================================
-- SPR game engine. Postgres is the authoritative game server:
-- every action is a SECURITY DEFINER function that locks the rows it
-- touches, so concurrent requests can never double-pay or desync.
--
-- Internal helpers are prefixed with `_` and are NOT callable by clients.
-- =============================================================

-- Timing constants (kept in one place)
create or replace function public._throw_seconds() returns interval
language sql immutable set search_path = '' as $$ select interval '5 seconds' $$;
create or replace function public._reveal_seconds() returns interval
language sql immutable set search_path = '' as $$ select interval '2.5 seconds' $$;
create or replace function public._grace() returns interval   -- network latency allowance
language sql immutable set search_path = '' as $$ select interval '750 milliseconds' $$;

create or replace function public._random_move() returns public.move
language sql volatile set search_path = '' as $$
  select (array['rock', 'paper', 'scissors']::public.move[])[1 + floor(random() * 3)::int]
$$;

create or replace function public._beats(x public.move, y public.move) returns boolean
language sql immutable set search_path = '' as $$
  select (x = 'rock' and y = 'scissors')
      or (x = 'paper' and y = 'rock')
      or (x = 'scissors' and y = 'paper')
$$;

-- Move chips + write the ledger row atomically. Raises on insufficient chips
-- (via the chips >= 0 check constraint).
create or replace function public._adjust_chips(
  p_user uuid, p_delta bigint, p_reason public.ledger_reason, p_match uuid default null
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_balance bigint;
begin
  update public.profiles set chips = chips + p_delta where id = p_user
    returning chips into v_balance;
  if not found then raise exception 'profile_not_found'; end if;
  insert into public.chip_ledger (user_id, delta, reason, match_id, balance_after)
    values (p_user, p_delta, p_reason, p_match, v_balance);
  return v_balance;
exception when check_violation then
  raise exception 'insufficient_chips';
end;
$$;

create or replace function public._active_match_for(p_user uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.matches
  where status = 'active' and p_user in (player_a, player_b)
  limit 1
$$;

-- Create a match, escrow stakes, clear both players from the queue.
create or replace function public._create_match(
  p_a uuid, p_b uuid, p_mode public.game_mode, p_stake bigint, p_rematch_of uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_start timestamptz := now() + interval '3 seconds'; -- "match found" splash
begin
  if public._active_match_for(p_a) is not null or public._active_match_for(p_b) is not null then
    raise exception 'player_already_in_match';
  end if;

  insert into public.matches (mode, player_a, player_b, stake, round_starts_at, round_deadline, rematch_of)
    values (p_mode, p_a, p_b, p_stake, v_start, v_start + public._throw_seconds(), p_rematch_of)
    returning id into v_id;

  if p_stake > 0 then
    -- lock in a stable order to avoid deadlocks
    if p_a < p_b then
      perform public._adjust_chips(p_a, -p_stake, 'stake', v_id);
      perform public._adjust_chips(p_b, -p_stake, 'stake', v_id);
    else
      perform public._adjust_chips(p_b, -p_stake, 'stake', v_id);
      perform public._adjust_chips(p_a, -p_stake, 'stake', v_id);
    end if;
  end if;

  delete from public.matchmaking_queue where user_id in (p_a, p_b);
  return v_id;
end;
$$;

-- Settle a finished match: stats, Elo (ranked only), payout.
create or replace function public._finish_match(p_match uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.matches;
  v_winner uuid;
  ra int; rb int; ga int; gb int;
  ka int; kb int;
  ea numeric; sa int;
  da int := null; db int := null;
begin
  select * into m from public.matches where id = p_match for update;
  if m.status <> 'active' then return; end if;

  v_winner := case when m.score_a > m.score_b then m.player_a else m.player_b end;

  if m.mode = 'ranked' then
    select elo, ranked_games into ra, ga from public.profiles where id = m.player_a for update;
    select elo, ranked_games into rb, gb from public.profiles where id = m.player_b for update;
    -- Provisional K-factor for a player's first 10 ranked games so they place fast.
    ka := case when ga < 10 then 40 else 32 end;
    kb := case when gb < 10 then 40 else 32 end;
    ea := 1.0 / (1.0 + power(10.0, (rb - ra) / 400.0));
    sa := case when v_winner = m.player_a then 1 else 0 end;
    da := round(ka * (sa - ea));
    db := round(kb * ((1 - sa) - (1 - ea)));
    update public.profiles set elo = elo + da, ranked_games = ranked_games + 1 where id = m.player_a;
    update public.profiles set elo = elo + db, ranked_games = ranked_games + 1 where id = m.player_b;
  end if;

  update public.profiles
     set games_played = games_played + 1,
         wins   = wins   + (id = v_winner)::int,
         losses = losses + (id <> v_winner)::int
   where id in (m.player_a, m.player_b);

  if m.stake > 0 then
    perform public._adjust_chips(v_winner, m.stake * 2, 'payout', p_match);
  end if;

  update public.matches
     set status = 'finished', winner = v_winner, finished_at = now(),
         round_deadline = null, round_starts_at = null,
         elo_delta_a = da, elo_delta_b = db
   where id = p_match;
end;
$$;

-- Resolve the current throw if both moved, or if the deadline (+grace) passed.
-- Idempotent: safe to call from both clients and the sweeper at once.
create or replace function public._resolve_round(p_match uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.matches;
  ma public.move; mb public.move;
  auto_a boolean := false; auto_b boolean := false;
  w uuid;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'active' then return; end if;

  select move into ma from public.round_moves
    where match_id = p_match and round_no = m.round_no and player_id = m.player_a;
  select move into mb from public.round_moves
    where match_id = p_match and round_no = m.round_no and player_id = m.player_b;

  if ma is null or mb is null then
    if now() < m.round_deadline + public._grace() then return; end if;  -- not time yet
    if ma is null then ma := public._random_move(); auto_a := true; end if;
    if mb is null then mb := public._random_move(); auto_b := true; end if;
  end if;

  w := case when ma = mb then null
            when public._beats(ma, mb) then m.player_a
            else m.player_b end;

  insert into public.rounds (match_id, round_no, move_a, move_b, auto_a, auto_b, winner)
    values (p_match, m.round_no, ma, mb, auto_a, auto_b, w);

  if w = m.player_a then m.score_a := m.score_a + 1;
  elsif w = m.player_b then m.score_b := m.score_b + 1;
  end if;

  if m.score_a >= 2 or m.score_b >= 2 then
    update public.matches
       set score_a = m.score_a, score_b = m.score_b, moved_a = false, moved_b = false
     where id = p_match;
    perform public._finish_match(p_match);
  else
    update public.matches
       set score_a = m.score_a, score_b = m.score_b,
           round_no = m.round_no + 1,
           round_starts_at = now() + public._reveal_seconds(),
           round_deadline  = now() + public._reveal_seconds() + public._throw_seconds(),
           moved_a = false, moved_b = false
     where id = p_match;
  end if;
end;
$$;

-- Try to pair a queued player. Window starts at +/-50 Elo and widens
-- by 50 every 3 seconds of waiting (either player's window counts).
create or replace function public._try_pair(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  q public.matchmaking_queue;
  c public.matchmaking_queue;
  v_window int;
  v_match uuid;
begin
  v_match := public._active_match_for(p_user);
  if v_match is not null then
    return jsonb_build_object('status', 'matched', 'match_id', v_match);
  end if;

  select * into q from public.matchmaking_queue where user_id = p_user for update skip locked;
  if not found then
    -- Either not queued, or another request is pairing us right now.
    return jsonb_build_object('status',
      case when exists (select 1 from public.matchmaking_queue where user_id = p_user)
           then 'queued' else 'idle' end);
  end if;

  update public.matchmaking_queue set last_seen = now() where user_id = p_user;
  v_window := 50 + 50 * floor(extract(epoch from now() - q.joined_at) / 3)::int;

  select * into c from public.matchmaking_queue
   where user_id <> p_user
     and mode = q.mode
     and stake = q.stake
     and last_seen > now() - interval '6 seconds'
     and abs(elo - q.elo) <= greatest(
           v_window,
           50 + 50 * floor(extract(epoch from now() - joined_at) / 3)::int)
   order by abs(elo - q.elo), joined_at
   limit 1
   for update skip locked;

  if not found then
    return jsonb_build_object('status', 'queued', 'window', v_window);
  end if;

  v_match := public._create_match(c.user_id, q.user_id, q.mode, q.stake);
  return jsonb_build_object('status', 'matched', 'match_id', v_match);
end;
$$;

-- =============================================================
-- Public RPCs (callable by signed-in players)
-- =============================================================

create or replace function public.join_queue(p_mode public.game_mode, p_stake bigint default 0)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_match uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_mode not in ('casual', 'ranked') then raise exception 'invalid_mode'; end if;
  if p_mode = 'casual' then p_stake := 0; end if;
  if p_mode = 'ranked' and p_stake not in (10, 50, 100, 250, 500) then
    raise exception 'invalid_stake';
  end if;

  v_match := public._active_match_for(v_uid);
  if v_match is not null then
    return jsonb_build_object('status', 'matched', 'match_id', v_match);
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.chips < p_stake then raise exception 'insufficient_chips'; end if;

  insert into public.matchmaking_queue (user_id, mode, stake, elo)
    values (v_uid, p_mode, p_stake, v_profile.elo)
  on conflict (user_id) do update
    set mode = excluded.mode, stake = excluded.stake, elo = excluded.elo,
        joined_at = now(), last_seen = now();

  return public._try_pair(v_uid);
end;
$$;

create or replace function public.poll_queue() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return public._try_pair(auth.uid());
end;
$$;

create or replace function public.leave_queue() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.matchmaking_queue where user_id = auth.uid();
end;
$$;

-- Authoritative match snapshot. server_now lets the client sync its clock.
create or replace function public.get_match_state(p_match uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  m public.matches;
begin
  select * into m from public.matches where id = p_match;
  if not found then raise exception 'match_not_found'; end if;
  if v_uid is null or v_uid not in (m.player_a, m.player_b) then
    raise exception 'not_a_participant';
  end if;

  return jsonb_build_object(
    'match', to_jsonb(m),
    'me', case when v_uid = m.player_a then 'a' else 'b' end,
    'server_now', now(),
    'players', (
      select jsonb_object_agg(case when p.id = m.player_a then 'a' else 'b' end,
               jsonb_build_object('id', p.id, 'username', p.username, 'elo', p.elo,
                                  'avatar_url', p.avatar_url, 'chips', p.chips))
      from public.profiles p where p.id in (m.player_a, m.player_b)),
    'rounds', (
      select coalesce(jsonb_agg(to_jsonb(r) order by r.round_no), '[]'::jsonb)
      from public.rounds r where r.match_id = p_match),
    'my_move', (
      select rm.move from public.round_moves rm
      where rm.match_id = p_match and rm.round_no = m.round_no and rm.player_id = v_uid)
  );
end;
$$;

create or replace function public.submit_move(p_match uuid, p_move public.move) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  m public.matches;
  v_count int;
begin
  select * into m from public.matches where id = p_match for update;
  if not found then raise exception 'match_not_found'; end if;
  if v_uid is null or v_uid not in (m.player_a, m.player_b) then
    raise exception 'not_a_participant';
  end if;
  if m.status <> 'active' then return public.get_match_state(p_match); end if;

  if now() > m.round_deadline + public._grace() then
    perform public._resolve_round(p_match);          -- too late: you get a random move
    return public.get_match_state(p_match);
  end if;

  insert into public.round_moves (match_id, round_no, player_id, move)
    values (p_match, m.round_no, v_uid, p_move)
  on conflict do nothing;                              -- first move is final

  update public.matches
     set moved_a = moved_a or v_uid = player_a,
         moved_b = moved_b or v_uid = player_b
   where id = p_match;

  select count(*) into v_count from public.round_moves
   where match_id = p_match and round_no = m.round_no;
  if v_count = 2 then perform public._resolve_round(p_match); end if;

  return public.get_match_state(p_match);
end;
$$;

-- Called by clients once the deadline passes (sweeper is the backstop).
create or replace function public.tick_match(p_match uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.matches
                 where id = p_match and v_uid in (player_a, player_b)) then
    raise exception 'not_a_participant';
  end if;
  perform public._resolve_round(p_match);
  return public.get_match_state(p_match);
end;
$$;

-- Double-or-nothing rematch: both players must vote yes within 30s.
create or replace function public.vote_rematch(p_match uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  m public.matches;
  v_stake bigint;
  v_new uuid;
begin
  select * into m from public.matches where id = p_match for update;
  if not found then raise exception 'match_not_found'; end if;
  if v_uid is null or v_uid not in (m.player_a, m.player_b) then
    raise exception 'not_a_participant';
  end if;
  if m.status <> 'finished' then raise exception 'match_not_finished'; end if;
  if m.rematch_id is not null then
    return jsonb_build_object('status', 'matched', 'match_id', m.rematch_id);
  end if;
  if m.finished_at < now() - interval '30 seconds' then
    return jsonb_build_object('status', 'expired');
  end if;

  if v_uid = m.player_a then m.rematch_vote_a := p_accept; else m.rematch_vote_b := p_accept; end if;
  update public.matches
     set rematch_vote_a = m.rematch_vote_a, rematch_vote_b = m.rematch_vote_b
   where id = p_match;

  if m.rematch_vote_a is false or m.rematch_vote_b is false then
    return jsonb_build_object('status', 'declined');
  end if;
  if not (coalesce(m.rematch_vote_a, false) and coalesce(m.rematch_vote_b, false)) then
    return jsonb_build_object('status', 'waiting');
  end if;

  v_stake := m.stake * 2;  -- double or nothing (0 stays 0 for casual)
  if exists (select 1 from public.profiles
             where id in (m.player_a, m.player_b) and chips < v_stake) then
    update public.matches set rematch_vote_a = false, rematch_vote_b = false where id = p_match;
    return jsonb_build_object('status', 'insufficient_chips');
  end if;

  v_new := public._create_match(m.player_a, m.player_b, m.mode, v_stake, p_match);
  update public.matches set rematch_id = v_new where id = p_match;
  return jsonb_build_object('status', 'matched', 'match_id', v_new);
end;
$$;

-- Friend challenges -------------------------------------------------
create or replace function public.create_challenge(p_stake bigint default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I/L
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_stake not in (0, 10, 50, 100, 250, 500) then raise exception 'invalid_stake'; end if;
  if (select chips from public.profiles where id = v_uid) < p_stake then
    raise exception 'insufficient_chips';
  end if;

  -- one open challenge per player
  delete from public.challenges where creator = v_uid and match_id is null;

  loop
    select string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1), '')
      into v_code from generate_series(1, 6);
    exit when not exists (select 1 from public.challenges where code = v_code);
  end loop;

  insert into public.challenges (code, creator, stake) values (v_code, v_uid, p_stake);
  return jsonb_build_object('code', v_code, 'stake', p_stake);
end;
$$;

create or replace function public.get_challenge(p_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'code', c.code, 'stake', c.stake, 'expires_at', c.expires_at,
    'match_id', c.match_id, 'expired', c.expires_at < now(),
    'creator', jsonb_build_object('id', p.id, 'username', p.username, 'elo', p.elo))
  from public.challenges c join public.profiles p on p.id = c.creator
  where c.code = upper(p_code)
$$;

create or replace function public.accept_challenge(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  c public.challenges;
  v_match uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into c from public.challenges where code = upper(p_code) for update;
  if not found then raise exception 'challenge_not_found'; end if;
  if c.match_id is not null then
    if v_uid = c.creator or exists (select 1 from public.matches where id = c.match_id and v_uid in (player_a, player_b)) then
      return jsonb_build_object('status', 'matched', 'match_id', c.match_id);
    end if;
    raise exception 'challenge_taken';
  end if;
  if c.expires_at < now() then raise exception 'challenge_expired'; end if;
  if c.creator = v_uid then raise exception 'cannot_accept_own_challenge'; end if;

  v_match := public._create_match(c.creator, v_uid, 'friend', c.stake);
  update public.challenges set match_id = v_match where id = c.id;
  return jsonb_build_object('status', 'matched', 'match_id', v_match);
end;
$$;

create or replace function public.cancel_challenge() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.challenges where creator = auth.uid() and match_id is null;
end;
$$;

-- Daily free chips: +250 once every 20 hours.
create or replace function public.claim_daily() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_last timestamptz;
  v_balance bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select last_daily_claim into v_last from public.profiles where id = v_uid for update;
  if v_last is not null and v_last > now() - interval '20 hours' then
    return jsonb_build_object('status', 'too_soon', 'next_at', v_last + interval '20 hours');
  end if;
  v_balance := public._adjust_chips(v_uid, 250, 'daily_bonus');
  update public.profiles set last_daily_claim = now() where id = v_uid;
  return jsonb_build_object('status', 'claimed', 'amount', 250, 'balance', v_balance,
                            'next_at', now() + interval '20 hours');
end;
$$;

-- Backstop for abandoned tabs: resolve any overdue throws.
create or replace function public.sweep_matches() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select id from public.matches
     where status = 'active' and round_deadline < now() - interval '1 second'
     for update skip locked
  loop
    begin
      perform public._resolve_round(r.id);
      n := n + 1;
    exception when others then
      raise warning 'sweep_matches failed for %: %', r.id, sqlerrm;
    end;
  end loop;
  -- drop stale queue entries (closed tabs)
  delete from public.matchmaking_queue where last_seen < now() - interval '30 seconds';
  return n;
end;
$$;

-- =============================================================
-- Function privileges: deny by default, allow only the public RPCs.
-- =============================================================
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.join_queue(public.game_mode, bigint),
  public.poll_queue(),
  public.leave_queue(),
  public.get_match_state(uuid),
  public.submit_move(uuid, public.move),
  public.tick_match(uuid),
  public.vote_rematch(uuid, boolean),
  public.create_challenge(bigint),
  public.get_challenge(text),
  public.accept_challenge(text),
  public.cancel_challenge(),
  public.claim_daily()
to authenticated;

-- Future functions in this schema also start locked down.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
