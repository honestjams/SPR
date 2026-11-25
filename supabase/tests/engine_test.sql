-- Game-engine smoke test. Runs entirely inside one transaction and ends by raising
-- an exception, so NOTHING is persisted. Expected output:
--   ERROR: ALL_TESTS_PASSED (rolled back): ...
-- Run in the Supabase SQL editor (or psql) against any environment.
do $$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  r jsonb; mid uuid; mid2 uuid; m public.matches; log text := '';
  pa public.profiles; pb public.profiles; n int;
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (ua, 'a@test.local', '{"username":"alice"}', 'authenticated', 'authenticated'),
         (ub, 'b@test.local', '{"username":"Alice"}', 'authenticated', 'authenticated');
  select * into pa from public.profiles where id = ua;
  select * into pb from public.profiles where id = ub;
  assert pa.username = 'alice' and pa.chips = 1000, 'signup A';
  assert pb.username like 'player%', 'case-insensitive duplicate username falls back';
  log := log || 'signup; ';

  perform set_config('request.jwt.claims', json_build_object('sub', ua)::text, true);
  r := public.join_queue('ranked', 100);
  assert r->>'status' = 'queued', 'A queued';
  perform set_config('request.jwt.claims', json_build_object('sub', ub)::text, true);
  r := public.join_queue('ranked', 100);
  assert r->>'status' = 'matched', 'B matched';
  mid := (r->>'match_id')::uuid;
  assert (select chips from public.profiles where id = ua) = 900, 'escrow';
  log := log || 'matchmaking+escrow; ';

  select * into m from public.matches where id = mid;
  perform set_config('request.jwt.claims', json_build_object('sub', m.player_a)::text, true);
  r := public.submit_move(mid, 'rock');
  assert r->'rounds' = '[]'::jsonb, 'no reveal before both moved';
  perform set_config('request.jwt.claims', json_build_object('sub', m.player_b)::text, true);
  r := public.submit_move(mid, 'scissors');
  assert (r->'match'->>'score_a')::int = 1, 'round 1';
  perform set_config('request.jwt.claims', json_build_object('sub', m.player_a)::text, true);
  perform public.submit_move(mid, 'paper');
  perform set_config('request.jwt.claims', json_build_object('sub', m.player_b)::text, true);
  r := public.submit_move(mid, 'paper');
  assert (r->'match'->>'round_no')::int = 3, 'draw replays';
  perform set_config('request.jwt.claims', json_build_object('sub', m.player_a)::text, true);
  perform public.submit_move(mid, 'scissors');
  perform set_config('request.jwt.claims', json_build_object('sub', m.player_b)::text, true);
  perform public.submit_move(mid, 'paper');
  select * into m from public.matches where id = mid;
  assert m.status = 'finished' and m.winner = m.player_a, 'A wins';
  assert m.elo_delta_a = 20 and m.elo_delta_b = -20, 'elo +20/-20 (provisional K=40)';
  assert (select chips from public.profiles where id = m.player_a) = 1100, 'payout';
  log := log || 'best-of-3+elo+payout; ';

  perform set_config('request.jwt.claims', json_build_object('sub', m.player_a)::text, true);
  assert public.vote_rematch(mid, true)->>'status' = 'waiting', 'rematch waiting';
  perform set_config('request.jwt.claims', json_build_object('sub', m.player_b)::text, true);
  r := public.vote_rematch(mid, true);
  mid2 := (r->>'match_id')::uuid;
  assert (select stake from public.matches where id = mid2) = 200, 'stake doubled';
  log := log || 'double-or-nothing; ';

  perform set_config('request.jwt.claims', json_build_object('sub', m.player_a)::text, true);
  perform public.submit_move(mid2, 'rock');
  update public.matches set round_deadline = now() - interval '2 seconds' where id = mid2;
  r := public.tick_match(mid2);
  assert (r->'rounds'->0->>'auto_b')::boolean, 'timeout auto-move';
  update public.matches set round_deadline = now() - interval '5 seconds' where id = mid2;
  assert public.sweep_matches() = 1, 'sweeper';
  log := log || 'timeouts+sweeper; ';

  assert (select sum(delta) from public.chip_ledger where user_id = ua) = (select chips from public.profiles where id = ua), 'ledger A';
  assert (select sum(delta) from public.chip_ledger where user_id = ub) = (select chips from public.profiles where id = ub), 'ledger B';
  log := log || 'ledger integrity';

  raise exception 'ALL_TESTS_PASSED (rolled back): %', log;
end $$;
