create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  client_reference uuid not null unique,
  customer_name text not null check (char_length(btrim(customer_name)) between 2 and 160),
  customer_email text not null check (char_length(btrim(customer_email)) between 3 and 254),
  contact text not null default '',
  order_note text not null default '',
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  total numeric(12, 0) not null check (total >= 0),
  status text not null default 'awaiting_review'
    check (status in ('awaiting_review', 'paid', 'fulfilled', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orders add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.orders add column if not exists client_reference uuid;
alter table public.orders add column if not exists customer_name text;
alter table public.orders add column if not exists customer_email text;
alter table public.orders add column if not exists contact text not null default '';
alter table public.orders add column if not exists order_note text not null default '';
alter table public.orders add column if not exists items jsonb;
alter table public.orders add column if not exists total numeric(12, 0);
alter table public.orders add column if not exists status text not null default 'awaiting_review';
alter table public.orders add column if not exists created_at timestamptz not null default now();
alter table public.orders add column if not exists updated_at timestamptz not null default now();
alter table public.orders add column if not exists subtotal numeric(12, 0) not null default 0;
alter table public.orders add column if not exists discount numeric(12, 0) not null default 0;
alter table public.orders add column if not exists voucher_code text;

update public.orders
set subtotal = total
where subtotal = 0 and total > 0;

create table if not exists public.customer_vouchers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null unique,
  discount_percent integer not null default 10 check (discount_percent between 1 and 100),
  status text not null default 'active'
    check (status in ('active', 'redeemed', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_order_id uuid unique references public.orders(id),
  check (
    (status = 'redeemed' and redeemed_at is not null and redeemed_order_id is not null)
    or (status <> 'redeemed' and redeemed_at is null and redeemed_order_id is null)
  )
);

create index if not exists customer_vouchers_user_created_idx
  on public.customer_vouchers (user_id, created_at desc);
create unique index if not exists customer_vouchers_one_active_per_user_idx
  on public.customer_vouchers (user_id)
  where status = 'active';

create or replace function public.set_order_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.set_order_updated_at() from public, anon, authenticated;
drop trigger if exists set_order_updated_at on public.orders;
create trigger set_order_updated_at
before update on public.orders
for each row
execute function public.set_order_updated_at();

create unique index if not exists orders_client_reference_uidx
  on public.orders (client_reference);
create index if not exists orders_created_at_idx
  on public.orders (created_at desc);
create index if not exists orders_user_created_at_idx
  on public.orders (user_id, created_at desc);

alter table public.orders enable row level security;
revoke all on public.orders from public, anon, authenticated;
grant select on public.orders to authenticated;
grant update (status) on public.orders to authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;

drop policy if exists "Admins can read orders" on public.orders;
create policy "Admins can read orders"
on public.orders for select
to authenticated
using (private.is_admin());

drop policy if exists "Admins can update order status" on public.orders;
create policy "Admins can update order status"
on public.orders for update
to authenticated
using (private.is_admin())
with check (private.is_admin());

drop policy if exists "Customers can read their own orders" on public.orders;
create policy "Customers can read their own orders"
on public.orders for select
to authenticated
using (user_id = (select auth.uid()));

alter table public.customer_vouchers enable row level security;
revoke all on public.customer_vouchers from public, anon, authenticated;
grant select on public.customer_vouchers to authenticated;

drop policy if exists "Customers can read their own vouchers" on public.customer_vouchers;
create policy "Customers can read their own vouchers"
on public.customer_vouchers for select
to authenticated
using (user_id = (select auth.uid()));

drop function if exists public.get_my_orders();
create or replace function public.get_my_orders()
returns table (
  client_reference uuid,
  items jsonb,
  subtotal numeric,
  discount numeric,
  voucher_code text,
  total numeric,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.client_reference, o.items, o.subtotal, o.discount, o.voucher_code,
    o.total, o.status, o.created_at, o.updated_at
  from public.orders as o
  where o.user_id = (select auth.uid())
  order by o.created_at desc
  limit 100;
$$;

revoke all on function public.get_my_orders() from public;
grant execute on function public.get_my_orders() to authenticated;

create or replace function public.track_order(
  p_client_reference uuid,
  p_customer_email text
)
returns table (
  client_reference uuid,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.client_reference, o.status, o.created_at, o.updated_at
  from public.orders as o
  where o.client_reference = p_client_reference
    and pg_catalog.lower(o.customer_email) =
      pg_catalog.lower(pg_catalog.btrim(coalesce(p_customer_email, '')))
  limit 1;
$$;

revoke all on function public.track_order(uuid, text) from public;
grant execute on function public.track_order(uuid, text) to anon, authenticated;

drop function if exists public.submit_order(uuid, text, text, text, text, jsonb);
create or replace function public.submit_order(
  p_client_reference uuid,
  p_customer_name text,
  p_customer_email text,
  p_contact text,
  p_order_note text,
  p_items jsonb,
  p_voucher_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_saved_item jsonb;
  v_item_index bigint;
  v_product record;
  v_product_id bigint;
  v_license text;
  v_unit_price numeric(12, 0);
  v_total numeric(12, 0) := 0;
  v_subtotal numeric(12, 0) := 0;
  v_eligible_subtotal numeric(12, 0) := 0;
  v_discount numeric(12, 0) := 0;
  v_is_sale boolean;
  v_normalized_voucher text := nullif(pg_catalog.upper(pg_catalog.btrim(coalesce(p_voucher_code, ''))), '');
  v_voucher public.customer_vouchers%rowtype;
  v_snapshot jsonb := '[]'::jsonb;
  v_order_id uuid;
  v_user_id uuid;
  v_existing public.orders%rowtype;
begin
  if p_client_reference is null then
    raise exception 'Order reference is required.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_client_reference::text, 0)
  );
  if char_length(btrim(coalesce(p_customer_name, ''))) not between 2 and 160 then
    raise exception 'Customer name must be between 2 and 160 characters.';
  end if;
  if char_length(btrim(coalesce(p_customer_email, ''))) not between 3 and 254
    or position('@' in p_customer_email) < 2 then
    raise exception 'Customer email is invalid.';
  end if;
  if char_length(coalesce(p_contact, '')) > 500
    or char_length(coalesce(p_order_note, '')) > 2000 then
    raise exception 'Order contact or note is too long.';
  end if;
  if p_items is null or pg_catalog.jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Order items must be an array.';
  end if;
  if pg_catalog.jsonb_array_length(p_items) < 1
    or pg_catalog.jsonb_array_length(p_items) > 30 then
    raise exception 'Order must contain between 1 and 30 items.';
  end if;

  select u.id into v_user_id
  from auth.users as u
  where u.id = (select auth.uid())
    and pg_catalog.lower(u.email) = pg_catalog.lower(pg_catalog.btrim(p_customer_email));

  if v_user_id is null then
    raise exception 'Sign in with your My AYS account and use its email to place an order.';
  end if;

  select * into v_existing
  from public.orders
  where client_reference = p_client_reference;
  if found then
    if v_existing.customer_name is distinct from btrim(p_customer_name)
      or v_existing.customer_email is distinct from lower(btrim(p_customer_email))
      or v_existing.contact is distinct from btrim(coalesce(p_contact, ''))
      or v_existing.order_note is distinct from btrim(coalesce(p_order_note, ''))
      or v_existing.voucher_code is distinct from v_normalized_voucher
      or pg_catalog.jsonb_array_length(v_existing.items)
        is distinct from pg_catalog.jsonb_array_length(p_items) then
      raise exception 'This order reference is already associated with different details.';
    end if;

    for v_item, v_item_index in
      select value, ordinality
      from pg_catalog.jsonb_array_elements(p_items) with ordinality
    loop
      if coalesce(v_item->>'id', '') !~ '^[0-9]+$' then
        raise exception 'Order contains an invalid product.';
      end if;
      v_product_id := (v_item->>'id')::bigint;
      v_license := v_item->>'license';
      if v_license is null or v_license not in ('personal', 'commercial') then
        raise exception 'Order contains an invalid license.';
      end if;

      v_saved_item := v_existing.items -> (v_item_index - 1)::integer;
      if (v_saved_item->>'id')::bigint is distinct from v_product_id
        or v_saved_item->>'license' is distinct from v_license then
        raise exception 'This order reference is already associated with different details.';
      end if;
    end loop;
    if v_user_id is not null and v_existing.user_id is null then
      update public.orders
      set user_id = v_user_id
      where id = v_existing.id;
    end if;
    return pg_catalog.jsonb_build_object(
      'order_id', v_existing.id,
      'subtotal', v_existing.subtotal,
      'discount', v_existing.discount,
      'voucher_code', v_existing.voucher_code,
      'total', v_existing.total
    );
  end if;

  for v_item in select value from pg_catalog.jsonb_array_elements(p_items)
  loop
    if coalesce(v_item->>'id', '') !~ '^[0-9]+$' then
      raise exception 'Order contains an invalid product.';
    end if;
    v_product_id := (v_item->>'id')::bigint;
    v_license := v_item->>'license';
    if v_license is null or v_license not in ('personal', 'commercial') then
      raise exception 'Order contains an invalid license.';
    end if;
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_snapshot) as saved(value)
      where saved.value->>'id' = v_product_id::text
        and saved.value->>'license' = v_license
    ) then
      raise exception 'Order contains a duplicate item.';
    end if;

    select id, name, image_url, price, sale_price, commercial_price,
      category, status, publication_status
      into v_product
    from public.products
    where id = v_product_id
      and publication_status = 'published';
    if not found then
      raise exception 'A product in this order is no longer available.';
    end if;
    if v_product.status = 'sold' then
      raise exception 'A product in this order is sold out.';
    end if;

    if v_license = 'commercial' then
      if v_product.commercial_price is null then
        raise exception 'A product in this order has no commercial license.';
      end if;
      v_unit_price := v_product.commercial_price;
    else
      v_is_sale := v_product.sale_price is not null
        and v_product.sale_price < v_product.price;
      v_unit_price := case when v_is_sale then v_product.sale_price else v_product.price end;
      if not v_is_sale then
        v_eligible_subtotal := v_eligible_subtotal + v_unit_price;
      end if;
    end if;

    v_total := v_total + v_unit_price;
    v_snapshot := v_snapshot || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'id', v_product.id,
        'name', v_product.name,
        'image_url', v_product.image_url,
        'license', v_license,
        'unit_price', v_unit_price
      )
    );
  end loop;

  v_subtotal := v_total;
  if v_normalized_voucher is not null then
    if v_user_id is null then
      raise exception 'Sign in with your verified My AYS account to use a voucher.';
    end if;
    if not exists (
      select 1
      from auth.users as u
      where u.id = v_user_id
        and u.email_confirmed_at is not null
    ) then
      raise exception 'Verify your My AYS email before using a voucher.';
    end if;

    select * into v_voucher
    from public.customer_vouchers
    where code = v_normalized_voucher
      and user_id = v_user_id
      and status = 'active'
      and expires_at > pg_catalog.now()
    for update;
    if not found then
      raise exception 'Voucher is invalid, expired, or already used.';
    end if;
    if v_eligible_subtotal <= 0 then
      raise exception 'Voucher applies only to full-price personal licenses.';
    end if;

    v_discount := pg_catalog.floor(
      v_eligible_subtotal * v_voucher.discount_percent / 100
    );
    if v_discount <= 0 then
      raise exception 'Voucher discount is below the minimum currency unit.';
    end if;
    v_total := v_subtotal - v_discount;
  end if;

  insert into public.orders (
    user_id, client_reference, customer_name, customer_email, contact, order_note,
    items, subtotal, discount, voucher_code, total
  )
  values (
    v_user_id,
    p_client_reference,
    btrim(p_customer_name),
    lower(btrim(p_customer_email)),
    btrim(coalesce(p_contact, '')),
    btrim(coalesce(p_order_note, '')),
    v_snapshot,
    v_subtotal,
    v_discount,
    v_normalized_voucher,
    v_total
  )
  on conflict (client_reference) do nothing
  returning id into v_order_id;

  if v_order_id is null then
    select * into v_existing
    from public.orders
    where client_reference = p_client_reference;
    if v_existing.customer_name is distinct from btrim(p_customer_name)
      or v_existing.customer_email is distinct from lower(btrim(p_customer_email))
      or v_existing.contact is distinct from btrim(coalesce(p_contact, ''))
      or v_existing.order_note is distinct from btrim(coalesce(p_order_note, ''))
      or v_existing.voucher_code is distinct from v_normalized_voucher
      or v_existing.items is distinct from v_snapshot
      or v_existing.subtotal is distinct from v_subtotal
      or v_existing.discount is distinct from v_discount
      or v_existing.total is distinct from v_total then
      raise exception 'This order reference is already associated with different details.';
    end if;
    v_order_id := v_existing.id;
    if v_user_id is not null and v_existing.user_id is null then
      update public.orders
      set user_id = v_user_id
      where id = v_existing.id;
    end if;
  end if;

  if v_normalized_voucher is not null then
    update public.customer_vouchers
    set status = 'redeemed',
      redeemed_at = pg_catalog.now(),
      redeemed_order_id = v_order_id
    where id = v_voucher.id
      and status = 'active';
    if not found then
      raise exception 'Voucher could not be redeemed.';
    end if;
  end if;
  return pg_catalog.jsonb_build_object(
    'order_id', v_order_id,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'voucher_code', v_normalized_voucher,
    'total', v_total
  );
end;
$$;

revoke all on function public.submit_order(uuid, text, text, text, text, jsonb, text) from public, anon;
grant execute on function public.submit_order(uuid, text, text, text, text, jsonb, text) to authenticated;
