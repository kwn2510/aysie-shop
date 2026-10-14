create table if not exists public.customer_game_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  hit_count smallint not null default 0 check (hit_count between 0 and 5),
  last_hit_at timestamptz,
  completed_at timestamptz,
  voucher_id uuid references public.customer_vouchers(id) on delete set null
);

create unique index if not exists customer_game_one_open_attempt_idx
  on public.customer_game_attempts (user_id)
  where completed_at is null;
create index if not exists customer_game_attempt_user_started_idx
  on public.customer_game_attempts (user_id, started_at desc);

alter table public.customer_game_attempts enable row level security;
revoke all on public.customer_game_attempts from public, anon, authenticated;

create or replace function public.start_customer_game()
returns table (attempt_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_attempt_id uuid;
  v_expires_at timestamptz;
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
    pg_catalog.hashtextextended(v_user_id::text, 1)
  );

  update public.customer_vouchers as v
  set status = 'expired'
  where v.user_id = v_user_id
    and v.status = 'active'
    and v.expires_at <= pg_catalog.now();

  if exists (
    select 1
    from public.customer_vouchers as v
    where v.user_id = v_user_id and v.status = 'active'
  ) then
    raise exception 'You already have an unused voucher. Use it or wait until it expires.';
  end if;

  update public.customer_game_attempts as a
  set completed_at = pg_catalog.now()
  where a.user_id = v_user_id
    and a.completed_at is null
    and a.expires_at <= pg_catalog.now();

  insert into public.customer_game_attempts as created_attempt (user_id, expires_at)
  values (v_user_id, pg_catalog.now() + interval '20 seconds')
  returning created_attempt.id, created_attempt.expires_at
  into v_attempt_id, v_expires_at;

  return query select v_attempt_id, v_expires_at;
end;
$$;

create or replace function public.record_customer_game_hit(p_attempt_id uuid)
returns table (hit_count smallint, voucher_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_attempt public.customer_game_attempts%rowtype;
  v_voucher_id uuid;
  v_code text;
  v_voucher_expires_at timestamptz;
  v_next_hit smallint;
begin
  if v_user_id is null or not exists (
    select 1
    from auth.users as u
    where u.id = v_user_id
      and u.email_confirmed_at is not null
  ) then
    raise exception 'Sign in with a verified My AYS account to play.';
  end if;

  select * into v_attempt
  from public.customer_game_attempts as a
  where a.id = p_attempt_id
    and a.user_id = v_user_id
  for update;

  if not found or v_attempt.completed_at is not null
    or v_attempt.expires_at <= pg_catalog.now() then
    raise exception 'This game attempt has expired. Start a new game.';
  end if;

  if v_attempt.hit_count = 0 then
    if pg_catalog.now() - v_attempt.started_at < interval '300 milliseconds' then
      raise exception 'Please wait for the game to start before collecting a sprout.';
    end if;
  elsif pg_catalog.now() - v_attempt.last_hit_at < interval '500 milliseconds' then
    raise exception 'Please wait for the next sprout.';
  end if;

  v_next_hit := v_attempt.hit_count + 1;
  if v_next_hit < 5 then
    update public.customer_game_attempts
    set hit_count = v_next_hit,
      last_hit_at = pg_catalog.now()
    where id = v_attempt.id;
    return query select v_next_hit, null::text, null::timestamptz;
    return;
  end if;

  v_voucher_expires_at := pg_catalog.now() + interval '7 days';
  loop
    v_code := 'AYS-' || pg_catalog.upper(
      pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 10)
    );
    insert into public.customer_vouchers (
      user_id, code, discount_percent, status, expires_at
    )
    values (v_user_id, v_code, 10, 'active', v_voucher_expires_at)
    on conflict (code) do nothing
    returning id into v_voucher_id;
    exit when v_voucher_id is not null;
  end loop;

  update public.customer_game_attempts
  set hit_count = 5,
    last_hit_at = pg_catalog.now(),
    completed_at = pg_catalog.now(),
    voucher_id = v_voucher_id
  where id = v_attempt.id;

  return query select 5::smallint, v_code, v_voucher_expires_at;
end;
$$;

create or replace function public.cancel_customer_game_attempt(p_attempt_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Sign in to close this game attempt.';
  end if;

  update public.customer_game_attempts
  set completed_at = pg_catalog.now()
  where id = p_attempt_id
    and user_id = v_user_id
    and completed_at is null;
end;
$$;

create or replace function public.preview_my_voucher(
  p_code text,
  p_items jsonb
)
returns table (
  voucher_code text,
  discount_percent integer,
  subtotal numeric,
  eligible_subtotal numeric,
  discount numeric,
  total numeric,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_code text := nullif(pg_catalog.upper(pg_catalog.btrim(coalesce(p_code, ''))), '');
  v_voucher public.customer_vouchers%rowtype;
  v_item jsonb;
  v_item_index bigint;
  v_product record;
  v_product_id bigint;
  v_license text;
  v_unit_price numeric(12, 0);
  v_subtotal numeric(12, 0) := 0;
  v_eligible_subtotal numeric(12, 0) := 0;
  v_discount numeric(12, 0);
begin
  if v_user_id is null or not exists (
    select 1
    from auth.users as u
    where u.id = v_user_id
      and u.email_confirmed_at is not null
  ) then
    raise exception 'Sign in with a verified My AYS account to use a voucher.';
  end if;
  if v_code is null then
    raise exception 'Enter a voucher code.';
  end if;
  if p_items is null or pg_catalog.jsonb_typeof(p_items) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_items) not between 1 and 30 then
    raise exception 'Cart must contain between 1 and 30 items.';
  end if;

  select * into v_voucher
  from public.customer_vouchers as v
  where v.code = v_code
    and v.user_id = v_user_id
    and v.status = 'active'
    and v.expires_at > pg_catalog.now();
  if not found then
    raise exception 'Voucher is invalid, expired, or already used.';
  end if;

  for v_item, v_item_index in
    select value, ordinality
    from pg_catalog.jsonb_array_elements(p_items) with ordinality
  loop
    if coalesce(v_item->>'id', '') !~ '^[0-9]+$' then
      raise exception 'Cart contains an invalid product.';
    end if;
    v_product_id := (v_item->>'id')::bigint;
    v_license := v_item->>'license';
    if v_license is null or v_license not in ('personal', 'commercial') then
      raise exception 'Cart contains an invalid license.';
    end if;
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_items) with ordinality as item(value, ordinality)
      where item.value->>'id' = v_product_id::text
        and item.value->>'license' = v_license
        and item.ordinality < v_item_index
    ) then
      raise exception 'Cart contains a duplicate item.';
    end if;

    select p.id, p.price, p.sale_price, p.commercial_price, p.status
    into v_product
    from public.products as p
    where p.id = v_product_id
      and p.publication_status = 'published';
    if not found or v_product.status = 'sold' then
      raise exception 'A product in this cart is no longer available.';
    end if;

    if v_license = 'commercial' then
      if v_product.commercial_price is null then
        raise exception 'A product in this cart has no commercial license.';
      end if;
      v_unit_price := v_product.commercial_price;
    elsif v_product.sale_price is not null and v_product.sale_price < v_product.price then
      v_unit_price := v_product.sale_price;
    else
      v_unit_price := v_product.price;
      v_eligible_subtotal := v_eligible_subtotal + v_unit_price;
    end if;
    v_subtotal := v_subtotal + v_unit_price;
  end loop;

  if v_eligible_subtotal <= 0 then
    raise exception 'Voucher applies only to full-price personal licenses.';
  end if;

  v_discount := pg_catalog.floor(
    v_eligible_subtotal * v_voucher.discount_percent / 100
  );
  if v_discount <= 0 then
    raise exception 'Voucher discount is below the minimum currency unit.';
  end if;

  return query select
    v_voucher.code,
    v_voucher.discount_percent,
    v_subtotal,
    v_eligible_subtotal,
    v_discount,
    v_subtotal - v_discount,
    v_voucher.expires_at;
end;
$$;

revoke all on function public.start_customer_game() from public, anon;
revoke all on function public.record_customer_game_hit(uuid) from public, anon;
revoke all on function public.cancel_customer_game_attempt(uuid) from public, anon;
revoke all on function public.preview_my_voucher(text, jsonb) from public, anon;
grant execute on function public.start_customer_game() to authenticated;
grant execute on function public.record_customer_game_hit(uuid) to authenticated;
grant execute on function public.cancel_customer_game_attempt(uuid) to authenticated;
grant execute on function public.preview_my_voucher(text, jsonb) to authenticated;
