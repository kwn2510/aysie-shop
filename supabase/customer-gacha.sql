alter table public.customer_vouchers
  add column if not exists issued_email text,
  add column if not exists issuance_month date;

create unique index if not exists customer_vouchers_user_month_uidx
  on public.customer_vouchers (user_id, issuance_month)
  where issuance_month is not null;
create unique index if not exists customer_vouchers_email_month_uidx
  on public.customer_vouchers (pg_catalog.lower(issued_email), issuance_month)
  where issuance_month is not null and issued_email is not null;

create table if not exists public.customer_gacha_monthly_claims (
  user_id uuid not null references auth.users(id) on delete cascade,
  issued_email text not null,
  issuance_month date not null,
  voucher_id uuid references public.customer_vouchers(id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (user_id, issuance_month)
);

create unique index if not exists customer_gacha_monthly_claims_email_uidx
  on public.customer_gacha_monthly_claims (pg_catalog.lower(issued_email), issuance_month);

insert into public.customer_gacha_monthly_claims (user_id, issued_email, issuance_month, voucher_id, created_at)
select distinct on (
  v.user_id,
  pg_catalog.lower(pg_catalog.btrim(u.email)),
  pg_catalog.date_trunc(
    'month',
    pg_catalog.timezone('Asia/Ho_Chi_Minh', v.created_at)
  )::date
)
  v.user_id,
  pg_catalog.lower(pg_catalog.btrim(u.email)),
  pg_catalog.date_trunc(
    'month',
    pg_catalog.timezone('Asia/Ho_Chi_Minh', v.created_at)
  )::date,
  v.id,
  v.created_at
from public.customer_vouchers as v
join auth.users as u on u.id = v.user_id
where u.email is not null
order by
  v.user_id,
  pg_catalog.lower(pg_catalog.btrim(u.email)),
  pg_catalog.date_trunc(
    'month',
    pg_catalog.timezone('Asia/Ho_Chi_Minh', v.created_at)
  )::date,
  v.created_at desc
on conflict do nothing;

create table if not exists public.customer_gacha_events (
  id integer primary key check (id = 1),
  is_active boolean not null default true,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  daily_attempt_limit integer not null default 3 check (daily_attempt_limit between 1 and 100),
  updated_at timestamptz not null default pg_catalog.now(),
  check (starts_at < ends_at)
);

insert into public.customer_gacha_events (id, starts_at, ends_at)
values (1, pg_catalog.now(), pg_catalog.now() + interval '365 days')
on conflict (id) do nothing;

create table if not exists public.customer_gacha_rewards (
  id uuid primary key default gen_random_uuid(),
  reward_key text not null unique,
  title text not null,
  description text not null default '',
  reward_type text not null check (reward_type in ('none', 'voucher')),
  probability_weight integer not null check (probability_weight > 0),
  inventory_limit integer check (inventory_limit is null or inventory_limit >= 0),
  awarded_count integer not null default 0 check (awarded_count >= 0),
  discount_percent integer check (discount_percent is null or discount_percent between 1 and 100),
  is_active boolean not null default true,
  updated_at timestamptz not null default pg_catalog.now(),
  check (
    (reward_type = 'none' and discount_percent is null)
    or (reward_type = 'voucher' and discount_percent is not null)
  )
);

insert into public.customer_gacha_rewards
  (reward_key, title, description, reward_type, probability_weight, inventory_limit, discount_percent)
values
  ('garden-seed', 'Hạt mầm may mắn', 'Hôm nay chưa trúng voucher, hẹn bạn ở lượt sau nhé!', 'none', 90, null, null),
  ('voucher-10', 'Voucher giảm 10%', 'Voucher dùng một lần cho sản phẩm giá thường, giấy phép cá nhân.', 'voucher', 10, 100, 10)
on conflict (reward_key) do nothing;

create table if not exists public.customer_gacha_plays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id integer not null references public.customer_gacha_events(id),
  request_id uuid not null default gen_random_uuid(),
  reward_id uuid references public.customer_gacha_rewards(id) on delete set null,
  reward_type text not null check (reward_type in ('none', 'voucher')),
  reward_title text not null,
  result_message text not null,
  voucher_id uuid references public.customer_vouchers(id) on delete set null,
  bonus_credit_id uuid,
  created_at timestamptz not null default pg_catalog.now()
);

create table if not exists public.customer_gacha_bonus_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id integer not null references public.customer_gacha_events(id),
  source text not null check (source in ('task', 'promotion', 'admin')),
  description text not null,
  amount integer not null check (amount between 1 and 100),
  remaining integer not null check (remaining between 0 and amount),
  expires_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  check (expires_at is null or expires_at > created_at)
);

create index if not exists customer_gacha_plays_user_created_idx
  on public.customer_gacha_plays (user_id, created_at desc);
create index if not exists customer_gacha_plays_daily_idx
  on public.customer_gacha_plays (user_id, event_id, created_at desc);
create unique index if not exists customer_gacha_plays_request_uidx
  on public.customer_gacha_plays (user_id, request_id);
create index if not exists customer_gacha_bonus_user_event_idx
  on public.customer_gacha_bonus_credits (user_id, event_id, expires_at);

alter table public.customer_gacha_events enable row level security;
alter table public.customer_gacha_rewards enable row level security;
alter table public.customer_gacha_plays enable row level security;
alter table public.customer_gacha_bonus_credits enable row level security;

alter table public.customer_gacha_monthly_claims enable row level security;
revoke all on public.customer_gacha_events from public, anon, authenticated;
revoke all on public.customer_gacha_rewards from public, anon, authenticated;
revoke all on public.customer_gacha_plays from public, anon, authenticated;
revoke all on public.customer_gacha_bonus_credits from public, anon, authenticated;
revoke all on public.customer_gacha_monthly_claims from public, anon, authenticated;
grant select, insert, update, delete on public.customer_gacha_events to authenticated;
grant select, insert, update, delete on public.customer_gacha_rewards to authenticated;
grant select on public.customer_gacha_plays to authenticated;
grant select, insert, update, delete on public.customer_gacha_bonus_credits to authenticated;

drop policy if exists "Admins manage gacha events" on public.customer_gacha_events;
create policy "Admins manage gacha events"
on public.customer_gacha_events for all
to authenticated
using (private.is_admin())
with check (private.is_admin());

drop policy if exists "Admins manage gacha rewards" on public.customer_gacha_rewards;
create policy "Admins manage gacha rewards"
on public.customer_gacha_rewards for all
to authenticated
using (private.is_admin())
with check (private.is_admin());

drop policy if exists "Admins manage gacha bonus credits" on public.customer_gacha_bonus_credits;
create policy "Admins manage gacha bonus credits"
on public.customer_gacha_bonus_credits for all
to authenticated
using (private.is_admin())
with check (private.is_admin());

drop policy if exists "Customers and admins read gacha history" on public.customer_gacha_plays;
create policy "Customers and admins read gacha history"
on public.customer_gacha_plays for select
to authenticated
using (user_id = (select auth.uid()) or private.is_admin());

revoke all on function public.start_customer_game() from public, anon, authenticated;
revoke all on function public.record_customer_game_hit(uuid) from public, anon, authenticated;
revoke all on function public.cancel_customer_game_attempt(uuid) from public, anon, authenticated;

create or replace function public.get_customer_gacha_state()
returns table (
  event_active boolean,
  starts_at timestamptz,
  ends_at timestamptz,
  daily_attempt_limit integer,
  plays_today integer,
  bonus_plays integer,
  monthly_reward_available boolean,
  has_active_voucher boolean,
  reward_preview jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_event public.customer_gacha_events%rowtype;
  v_day_start timestamptz;
  v_plays_today integer;
  v_bonus_plays integer;
  v_email text;
  v_month date := pg_catalog.date_trunc(
    'month',
    pg_catalog.timezone('Asia/Ho_Chi_Minh', pg_catalog.now())
  )::date;
begin
  if v_user_id is null or not exists (
    select 1
    from auth.users as u
    where u.id = v_user_id
      and u.email_confirmed_at is not null
  ) then
    raise exception 'Sign in with a verified My AYS account to play.';
  end if;

  select * into v_event
  from public.customer_gacha_events
  where id = 1;
  if not found then
    raise exception 'The garden event is not configured.';
  end if;

  select pg_catalog.lower(pg_catalog.btrim(u.email))
  into v_email
  from auth.users as u
  where u.id = v_user_id;
  v_day_start := (pg_catalog.timezone('Asia/Ho_Chi_Minh', pg_catalog.now())::date::timestamp)
    at time zone 'Asia/Ho_Chi_Minh';

  select pg_catalog.count(*)::integer into v_plays_today
  from public.customer_gacha_plays as p
  where p.user_id = v_user_id
    and p.event_id = v_event.id
    and p.created_at >= v_day_start;
  select coalesce(pg_catalog.sum(c.remaining), 0)::integer into v_bonus_plays
  from public.customer_gacha_bonus_credits as c
  where c.user_id = v_user_id
    and c.event_id = v_event.id
    and c.remaining > 0
    and (c.expires_at is null or c.expires_at > pg_catalog.now());

  return query
  select
    v_event.is_active and pg_catalog.now() >= v_event.starts_at and pg_catalog.now() < v_event.ends_at,
    v_event.starts_at,
    v_event.ends_at,
    v_event.daily_attempt_limit,
    v_plays_today,
    v_bonus_plays,
    not exists (
      select 1 from public.customer_gacha_monthly_claims as c
      where (c.user_id = v_user_id or pg_catalog.lower(c.issued_email) = v_email)
        and c.issuance_month = v_month
    ),
    exists (
      select 1 from public.customer_vouchers as v
      where v.user_id = v_user_id
        and v.status = 'active'
        and v.expires_at > pg_catalog.now()
    ),
    coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('title', r.title, 'description', r.description)
        order by r.id
      )
      from public.customer_gacha_rewards as r
      where r.is_active
        and (r.inventory_limit is null or r.awarded_count < r.inventory_limit)
    ), '[]'::jsonb);
end;
$$;

create or replace function public.play_customer_gacha(p_request_id uuid)
returns table (
  play_id uuid,
  reward_type text,
  reward_title text,
  result_message text,
  voucher_code text,
  expires_at timestamptz,
  plays_remaining integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_email text;
  v_event public.customer_gacha_events%rowtype;
  v_reward public.customer_gacha_rewards%rowtype;
  v_existing public.customer_gacha_plays%rowtype;
  v_play_id uuid;
  v_voucher_id uuid;
  v_voucher_code text;
  v_voucher_expires_at timestamptz;
  v_month date := pg_catalog.date_trunc(
    'month',
    pg_catalog.timezone('Asia/Ho_Chi_Minh', pg_catalog.now())
  )::date;
  v_day_start timestamptz;
  v_plays_today integer;
  v_bonus_credit_id uuid;
  v_bonus_plays integer;
  v_total_weight numeric;
  v_roll numeric;
  v_cumulative numeric := 0;
  v_reward_type text;
  v_reward_title text;
  v_result_message text;
begin
  if v_user_id is null or not exists (
    select 1
    from auth.users as u
    where u.id = v_user_id
      and u.email_confirmed_at is not null
  ) then
    raise exception 'Sign in with a verified My AYS account to play.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 70421)
  );
  if p_request_id is null then
    raise exception 'A play request identifier is required.';
  end if;

  select pg_catalog.lower(pg_catalog.btrim(u.email))
  into v_email
  from auth.users as u
  where u.id = v_user_id;

  select * into v_existing
  from public.customer_gacha_plays as p
  where p.user_id = v_user_id
    and p.request_id = p_request_id;
  if found then
    select * into v_event
    from public.customer_gacha_events
    where id = v_existing.event_id;
    v_day_start := (pg_catalog.timezone('Asia/Ho_Chi_Minh', pg_catalog.now())::date::timestamp)
      at time zone 'Asia/Ho_Chi_Minh';
    select pg_catalog.count(*)::integer into v_plays_today
    from public.customer_gacha_plays as p
    where p.user_id = v_user_id
      and p.event_id = v_existing.event_id
      and p.created_at >= v_day_start;
    select coalesce(pg_catalog.sum(c.remaining), 0)::integer into v_bonus_plays
    from public.customer_gacha_bonus_credits as c
    where c.user_id = v_user_id
      and c.event_id = v_existing.event_id
      and c.remaining > 0
      and (c.expires_at is null or c.expires_at > pg_catalog.now());
    select v.code, v.expires_at into v_voucher_code, v_voucher_expires_at
    from public.customer_vouchers as v
    where v.id = v_existing.voucher_id;
    return query select
      v_existing.id,
      v_existing.reward_type,
      v_existing.reward_title,
      v_existing.result_message,
      v_voucher_code,
      v_voucher_expires_at,
      greatest(v_event.daily_attempt_limit - v_plays_today, 0) + v_bonus_plays;
    return;
  end if;

  if exists (
    select 1 from public.customer_gacha_monthly_claims as c
    where (c.user_id = v_user_id or pg_catalog.lower(c.issued_email) = v_email)
      and c.issuance_month = v_month
  ) then
    raise exception 'You have already received this month’s voucher. Come back next month.';
  end if;

  update public.customer_vouchers as v
  set status = 'expired'
  where v.user_id = v_user_id
    and v.status = 'active'
    and v.expires_at <= pg_catalog.now();

  if exists (
    select 1 from public.customer_vouchers as v
    where v.user_id = v_user_id and v.status = 'active'
  ) then
    raise exception 'Use or wait for your current voucher to expire before playing again.';
  end if;

  select * into v_event
  from public.customer_gacha_events
  where id = 1
  for update;
  if not found then
    raise exception 'The garden event is not configured.';
  end if;
  if not v_event.is_active
    or pg_catalog.now() < v_event.starts_at
    or pg_catalog.now() >= v_event.ends_at then
    raise exception 'The Gacha Garden event is not open right now.';
  end if;

  v_day_start := (pg_catalog.timezone('Asia/Ho_Chi_Minh', pg_catalog.now())::date::timestamp)
    at time zone 'Asia/Ho_Chi_Minh';
  select pg_catalog.count(*)::integer into v_plays_today
  from public.customer_gacha_plays as p
  where p.user_id = v_user_id
    and p.event_id = v_event.id
    and p.created_at >= v_day_start;
  if v_plays_today >= v_event.daily_attempt_limit then
    select c.id into v_bonus_credit_id
    from public.customer_gacha_bonus_credits as c
    where c.user_id = v_user_id
      and c.event_id = v_event.id
      and c.remaining > 0
      and (c.expires_at is null or c.expires_at > pg_catalog.now())
    order by c.expires_at nulls last, c.created_at, c.id
    limit 1
    for update;
    if not found then
      raise exception 'You have used all of today’s garden turns.';
    end if;
    update public.customer_gacha_bonus_credits
    set remaining = remaining - 1
    where id = v_bonus_credit_id;
  end if;

  select pg_catalog.sum(r.probability_weight)::numeric
  into v_total_weight
  from public.customer_gacha_rewards as r
  where r.is_active
    and (r.inventory_limit is null or r.awarded_count < r.inventory_limit);
  if coalesce(v_total_weight, 0) <= 0 then
    raise exception 'All garden rewards have run out.';
  end if;
  v_roll := pg_catalog.random() * v_total_weight;

  for v_reward in
    select r.*
    from public.customer_gacha_rewards as r
    where r.is_active
      and (r.inventory_limit is null or r.awarded_count < r.inventory_limit)
    order by r.id
  loop
    v_cumulative := v_cumulative + v_reward.probability_weight;
    if v_cumulative >= v_roll then
      exit;
    end if;
  end loop;
  if v_reward.id is null then
    raise exception 'Could not select an available garden reward.';
  end if;

  v_reward_type := v_reward.reward_type;
  v_reward_title := v_reward.title;
  v_result_message := v_reward.description;
  if v_reward.reward_type = 'voucher' then
    v_voucher_expires_at := pg_catalog.now() + interval '7 days';
    loop
      v_voucher_code := 'AYS-' || pg_catalog.upper(
        pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text, '-', ''), 1, 10)
      );
      insert into public.customer_vouchers (
        user_id, code, discount_percent, status, expires_at, issued_email, issuance_month
      )
      values (
        v_user_id, v_voucher_code, v_reward.discount_percent, 'active',
        v_voucher_expires_at, v_email, v_month
      )
      on conflict (code) do nothing
      returning id into v_voucher_id;
      exit when v_voucher_id is not null;
    end loop;

    insert into public.customer_gacha_monthly_claims (
      user_id, issued_email, issuance_month, voucher_id
    )
    values (v_user_id, v_email, v_month, v_voucher_id);

    v_result_message := v_reward.description || ' Mã đã được lưu vào Ví Voucher của bạn.';
  end if;
  if v_reward.reward_type = 'voucher' or v_reward.inventory_limit is not null then
    update public.customer_gacha_rewards
    set awarded_count = awarded_count + 1,
      updated_at = pg_catalog.now()
    where id = v_reward.id
      and (inventory_limit is null or awarded_count < inventory_limit);
    if not found then
      raise exception 'This reward has just run out. Please try again.';
    end if;
  end if;

  insert into public.customer_gacha_plays (
    user_id, event_id, request_id, reward_id, reward_type, reward_title, result_message, voucher_id, bonus_credit_id
  )
  values (
    v_user_id, v_event.id, p_request_id, v_reward.id, v_reward_type,
    v_reward_title, v_result_message, v_voucher_id, v_bonus_credit_id
  )
  returning id into v_play_id;

  select coalesce(pg_catalog.sum(c.remaining), 0)::integer into v_bonus_plays
  from public.customer_gacha_bonus_credits as c
  where c.user_id = v_user_id
    and c.event_id = v_event.id
    and c.remaining > 0
    and (c.expires_at is null or c.expires_at > pg_catalog.now());

  return query select
    v_play_id,
    v_reward_type,
    v_reward_title,
    v_result_message,
    v_voucher_code,
    v_voucher_expires_at,
    greatest(v_event.daily_attempt_limit - v_plays_today - 1, 0) + v_bonus_plays;
end;
$$;

create or replace function public.get_my_gacha_history()
returns table (
  reward_type text,
  reward_title text,
  result_message text,
  created_at timestamptz,
  voucher_code text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.reward_type, p.reward_title, p.result_message, p.created_at, v.code
  from public.customer_gacha_plays as p
  left join public.customer_vouchers as v on v.id = p.voucher_id
  where p.user_id = (select auth.uid())
  order by p.created_at desc
  limit 10;
$$;

create or replace function public.get_admin_gacha_history(p_limit integer default 100)
returns table (
  user_email text,
  display_name text,
  reward_type text,
  reward_title text,
  result_message text,
  created_at timestamptz,
  voucher_code text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(private.is_admin(), false) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  return query
  select
    u.email::text,
    p.display_name,
    g.reward_type,
    g.reward_title,
    g.result_message,
    g.created_at,
    v.code
  from public.customer_gacha_plays as g
  join auth.users as u on u.id = g.user_id
  left join public.profiles as p on p.id = g.user_id
  left join public.customer_vouchers as v on v.id = g.voucher_id
  order by g.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

create or replace function public.get_admin_customer_id_by_email(p_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if not coalesce(private.is_admin(), false) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  select u.id into v_user_id
  from auth.users as u
  where pg_catalog.lower(pg_catalog.btrim(u.email)) =
    pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')))
    and u.email_confirmed_at is not null;
  if v_user_id is null then
    raise exception 'No verified customer account was found for that email.';
  end if;
  return v_user_id;
end;
$$;

revoke all on function public.get_customer_gacha_state() from public, anon;
revoke all on function public.play_customer_gacha(uuid) from public, anon;
revoke all on function public.get_my_gacha_history() from public, anon;
revoke all on function public.get_admin_gacha_history(integer) from public, anon;
revoke all on function public.get_admin_customer_id_by_email(text) from public, anon;
grant execute on function public.get_customer_gacha_state() to authenticated;
grant execute on function public.play_customer_gacha(uuid) to authenticated;
grant execute on function public.get_my_gacha_history() to authenticated;
grant execute on function public.get_admin_gacha_history(integer) to authenticated;
grant execute on function public.get_admin_customer_id_by_email(text) to authenticated;
