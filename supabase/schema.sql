-- Spud Brawl accounts: run once in the Supabase SQL editor (safe to re-run).
-- Clients can only READ their own profile. Every write goes through server.js with the service-role key,
-- and money-touching writes are single-statement functions so two clicks can never double-spend or double-spin.

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade, -- the Supabase Auth user id
  coins      integer not null default 0 check (coins >= 0),
  last_spin  timestamptz,
  owned      text[] not null default '{}',
  progress   jsonb,
  created_at timestamptz not null default now()
);

-- One row per paid Stripe Checkout Session: the primary key makes crediting idempotent (webhooks can repeat).
create table if not exists public.purchases (
  id         text primary key, -- Stripe checkout session id (cs_...)
  user_id    uuid not null references public.profiles (id) on delete cascade,
  coins      integer not null check (coins > 0),
  amount     integer, -- what Stripe charged, in the smallest currency unit
  currency   text,
  created_at timestamptz not null default now()
);

-- A profile for every new user.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
-- users who signed up before this script ran
insert into public.profiles (id) select id from auth.users on conflict (id) do nothing;

-- Row level security: read your own profile, write nothing. purchases has no policies at all (server only).
alter table public.profiles enable row level security;
alter table public.purchases enable row level security;
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select to authenticated using ((select auth.uid()) = id);
revoke insert, update, delete, truncate on public.profiles from anon, authenticated;
revoke all on public.purchases from anon, authenticated;

-- Daily spin: pays out only if the cooldown has passed. The WHERE re-checks last_spin under the row lock,
-- so of two simultaneous spins one updates and the other gets no row back. The reward is picked by server.js.
create or replace function public.claim_spin(uid uuid, reward_coins integer, reward_item text, cooldown interval)
returns table (coins integer, last_spin timestamptz, owned text[])
language sql set search_path = '' as $$
  update public.profiles p
     set coins = p.coins + greatest(reward_coins, 0),
         last_spin = now(),
         owned = case when reward_item is null or reward_item = any(p.owned) then p.owned else array_append(p.owned, reward_item) end
   where p.id = uid and (p.last_spin is null or p.last_spin <= now() - cooldown)
  returning p.coins, p.last_spin, p.owned;
$$;

-- Shop: spend coins on one named item. No row back = not enough coins or already owned.
create or replace function public.buy_item(uid uuid, item text, price integer)
returns table (coins integer, owned text[])
language sql set search_path = '' as $$
  update public.profiles p
     set coins = p.coins - price, owned = array_append(p.owned, item)
   where p.id = uid and price > 0 and p.coins >= price and not (item = any(p.owned))
  returning p.coins, p.owned;
$$;

-- Stripe webhook: credit a paid session exactly once. Returns true if this call credited it.
create or replace function public.credit_purchase(session_id text, uid uuid, add_coins integer, paid integer, cur text)
returns boolean
language plpgsql set search_path = '' as $$
declare n integer;
begin
  insert into public.purchases (id, user_id, coins, amount, currency) values (session_id, uid, add_coins, paid, cur)
  on conflict (id) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return false; end if; -- already credited
  update public.profiles set coins = coins + add_coins where id = uid;
  return true;
end $$;

-- Only the service role (server.js) may call these. Supabase grants new functions to anon/authenticated by default.
revoke execute on function public.claim_spin(uuid, integer, text, interval) from public, anon, authenticated;
revoke execute on function public.buy_item(uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.credit_purchase(text, uuid, integer, integer, text) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.claim_spin(uuid, integer, text, interval) to service_role;
grant execute on function public.buy_item(uuid, text, integer) to service_role;
grant execute on function public.credit_purchase(text, uuid, integer, integer, text) to service_role;

-- ---------- leaderboards: Aim Trainer (hits in 60 s, then accuracy) and Zombies (wave reached, then kills) ----------
-- One row per player per board, holding their best. Only server.js writes (submit_score); everyone reads through it.
create table if not exists public.scores (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  board      text not null check (board in ('aim', 'zombies')),
  name       text not null check (char_length(name) between 1 and 16),
  score      integer not null check (score >= 0),
  extra      integer not null default 0 check (extra >= 0), -- the tie-breaker: accuracy % or kills
  updated_at timestamptz not null default now(),
  primary key (user_id, board)
);
create index if not exists scores_rank on public.scores (board, score desc, extra desc, updated_at);
alter table public.scores enable row level security;
revoke all on public.scores from anon, authenticated;

-- Keep the better of the stored and the new run (the name always updates), and say where it ranks.
create or replace function public.submit_score(uid uuid, b text, nm text, s integer, x integer)
returns table (best integer, best_extra integer, rank bigint)
language plpgsql set search_path = '' as $$
declare bs integer; bx integer;
begin
  insert into public.scores as t (user_id, board, name, score, extra) values (uid, b, nm, s, x)
  on conflict (user_id, board) do update
     set name = excluded.name,
         score = case when (excluded.score, excluded.extra) > (t.score, t.extra) then excluded.score else t.score end,
         extra = case when (excluded.score, excluded.extra) > (t.score, t.extra) then excluded.extra else t.extra end,
         updated_at = case when (excluded.score, excluded.extra) > (t.score, t.extra) then now() else t.updated_at end
  returning t.score, t.extra into bs, bx;
  return query select bs, bx, (select count(*) + 1 from public.scores o where o.board = b and (o.score, o.extra) > (bs, bx));
end $$;
revoke execute on function public.submit_score(uuid, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.submit_score(uuid, text, text, integer, integer) to service_role;
