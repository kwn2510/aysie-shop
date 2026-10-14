create table if not exists public.customer_order_cancellations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_reference uuid not null unique,
  customer_name text not null check (char_length(btrim(customer_name)) between 2 and 160),
  customer_email text not null check (char_length(btrim(customer_email)) between 3 and 254),
  social_contact_url text not null check (char_length(btrim(social_contact_url)) between 5 and 500),
  order_items jsonb not null check (jsonb_typeof(order_items) = 'array'),
  reason text not null check (char_length(btrim(reason)) between 10 and 2000),
  bank_name text not null check (char_length(btrim(bank_name)) between 2 and 120),
  account_holder text not null check (char_length(btrim(account_holder)) between 2 and 160),
  account_number text not null check (char_length(btrim(account_number)) between 4 and 80),
  receipt_path text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default pg_catalog.now(),
  reviewed_at timestamptz,
  admin_note text not null default ''
);

create index if not exists customer_order_cancellations_user_created_idx
  on public.customer_order_cancellations (user_id, created_at desc);

alter table public.customer_order_cancellations enable row level security;
revoke all on public.customer_order_cancellations from public, anon, authenticated;
grant select on public.customer_order_cancellations to authenticated;
grant update (status, reviewed_at, admin_note) on public.customer_order_cancellations to authenticated;

drop policy if exists "Customers read own cancellation requests"
  on public.customer_order_cancellations;
create policy "Customers read own cancellation requests"
on public.customer_order_cancellations for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Admins read cancellation requests"
  on public.customer_order_cancellations;
create policy "Admins read cancellation requests"
on public.customer_order_cancellations for select
to authenticated
using (private.is_admin());

drop policy if exists "Admins review cancellation requests"
  on public.customer_order_cancellations;
create policy "Admins review cancellation requests"
on public.customer_order_cancellations for update
to authenticated
using (private.is_admin())
with check (private.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-cancellation-bills',
  'order-cancellation-bills',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Customers upload own cancellation bills" on storage.objects;
create policy "Customers upload own cancellation bills"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'order-cancellation-bills'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name = (
    (select auth.uid())::text
    || '/' || (storage.foldername(name))[2]
    || '/transaction-bill'
  )
  and exists (
    select 1
    from public.orders as o
    where o.client_reference::text = (storage.foldername(name))[2]
      and o.user_id = (select auth.uid())
      and o.status in ('awaiting_review', 'paid')
  )
);

drop policy if exists "Customers read own cancellation bills" on storage.objects;
create policy "Customers read own cancellation bills"
on storage.objects for select
to authenticated
using (
  bucket_id = 'order-cancellation-bills'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or private.is_admin()
  )
);

drop policy if exists "Customers delete own cancellation bills" on storage.objects;
create policy "Customers delete own cancellation bills"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'order-cancellation-bills'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and not exists (
    select 1
    from public.customer_order_cancellations as c
    where c.receipt_path = name
      and c.user_id = (select auth.uid())
  )
);

create or replace function public.submit_order_cancellation(
  p_client_reference uuid,
  p_customer_name text,
  p_customer_email text,
  p_social_contact_url text,
  p_reason text,
  p_bank_name text,
  p_account_holder text,
  p_account_number text,
  p_receipt_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_account_email text;
  v_order public.orders%rowtype;
  v_request_id uuid;
begin
  if v_user_id is null or not exists (
    select 1
    from auth.users as u
    where u.id = v_user_id
      and u.email_confirmed_at is not null
  ) then
    raise exception 'Sign in with a verified My AYS account to request an order cancellation.';
  end if;

  select pg_catalog.lower(pg_catalog.btrim(u.email))
  into v_account_email
  from auth.users as u
  where u.id = v_user_id;

  select * into v_order
  from public.orders as o
  where o.client_reference = p_client_reference
    and o.user_id = v_user_id
  for update;
  if not found then
    raise exception 'The order does not belong to this account.';
  end if;
  if v_order.status not in ('awaiting_review', 'paid') then
    raise exception 'Only orders awaiting confirmation or paid orders can request cancellation.';
  end if;
  if pg_catalog.lower(pg_catalog.btrim(v_order.customer_email)) <> v_account_email
    or pg_catalog.lower(pg_catalog.btrim(p_customer_email)) <> v_account_email then
    raise exception 'The email must match the verified account and the order.';
  end if;

  if char_length(pg_catalog.btrim(coalesce(p_customer_name, ''))) not between 2 and 160
    or char_length(pg_catalog.btrim(coalesce(p_social_contact_url, ''))) not between 5 and 500
    or pg_catalog.btrim(coalesce(p_social_contact_url, '')) !~* '^https?://'
    or char_length(pg_catalog.btrim(coalesce(p_reason, ''))) not between 10 and 2000
    or char_length(pg_catalog.btrim(coalesce(p_bank_name, ''))) not between 2 and 120
    or char_length(pg_catalog.btrim(coalesce(p_account_holder, ''))) not between 2 and 160
    or char_length(pg_catalog.btrim(coalesce(p_account_number, ''))) not between 4 and 80 then
    raise exception 'Please complete every cancellation form field with valid details.';
  end if;

  if p_receipt_path is distinct from (
    v_user_id::text || '/' || p_client_reference::text || '/transaction-bill'
  )
    or not exists (
      select 1 from storage.objects as s
      where s.bucket_id = 'order-cancellation-bills'
        and s.name = p_receipt_path
        and coalesce((s.metadata->>'size')::bigint, 0) between 1 and 5242880
    ) then
    raise exception 'Upload a valid transaction bill for this order before submitting.';
  end if;

  insert into public.customer_order_cancellations (
    order_id,
    user_id,
    client_reference,
    customer_name,
    customer_email,
    social_contact_url,
    order_items,
    reason,
    bank_name,
    account_holder,
    account_number,
    receipt_path
  )
  values (
    v_order.id,
    v_user_id,
    p_client_reference,
    pg_catalog.btrim(p_customer_name),
    v_account_email,
    pg_catalog.btrim(p_social_contact_url),
    v_order.items,
    pg_catalog.btrim(p_reason),
    pg_catalog.btrim(p_bank_name),
    pg_catalog.btrim(p_account_holder),
    pg_catalog.btrim(p_account_number),
    p_receipt_path
  )
  returning id into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.submit_order_cancellation(
  uuid, text, text, text, text, text, text, text, text
) from public, anon;
grant execute on function public.submit_order_cancellation(
  uuid, text, text, text, text, text, text, text, text
) to authenticated;
