-- Backstop sweeper: every 2 seconds, auto-play overdue throws so a match
-- always finishes even if both players close their tabs. Clients normally
-- trigger resolution themselves via tick_match() right at the deadline.
create extension if not exists pg_cron;

select cron.schedule('spr-sweep-matches', '2 seconds', $$select public.sweep_matches()$$);
