create or replace function public.get_admin_customers(
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  user_id uuid,
  email text,
  display_name text,
  created_at timestamptz,
  order_count bigint,
  latest_order_at timestamptz,
  total_matches bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(pg_catalog.btrim(coalesce(p_search, '')), '');
begin
  if not coalesce(private.is_admin(), false) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  return query
  with customers as (
    select
      u.id,
      u.email::text,
      p.display_name,
      u.created_at,
      order_summary.order_count,
      order_summary.latest_order_at
    from public.profiles as p
    join auth.users as u on u.id = p.id
    cross join lateral (
      select
        pg_catalog.count(*)::bigint as order_count,
        pg_catalog.max(o.created_at) as latest_order_at
      from public.orders as o
      where o.user_id = u.id
    ) as order_summary
  )
  select
    customers.id,
    customers.email,
    customers.display_name,
    customers.created_at,
    customers.order_count,
    customers.latest_order_at,
    pg_catalog.count(*) over ()
  from customers
  where v_search is null
    or customers.display_name ilike '%' || v_search || '%'
    or customers.email ilike '%' || v_search || '%'
  order by customers.created_at desc, customers.id
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, least(coalesce(p_offset, 0), 100000));
end;
$$;

revoke all on function public.get_admin_customers(text, integer, integer)
  from public, anon;
grant execute on function public.get_admin_customers(text, integer, integer)
  to authenticated;

drop function if exists public.get_admin_customer_orders(uuid);
create or replace function public.get_admin_customer_orders(p_user_id uuid)
returns table (
  client_reference uuid,
  items jsonb,
  subtotal numeric,
  discount numeric,
  voucher_code text,
  total numeric,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  account_order_count bigint,
  account_order_total numeric
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
  if p_user_id is null then
    raise exception 'Customer ID is required.' using errcode = '22004';
  end if;

  return query
  select
    o.client_reference,
    o.items,
    o.subtotal,
    o.discount,
    o.voucher_code,
    o.total,
    o.status,
    o.created_at,
    o.updated_at,
    pg_catalog.count(*) over (),
    pg_catalog.sum(o.total) filter (where o.status in ('paid', 'fulfilled')) over ()
  from public.orders as o
  where o.user_id = p_user_id
  order by o.created_at desc
  limit 100;
end;
$$;

revoke all on function public.get_admin_customer_orders(uuid)
  from public, anon;
grant execute on function public.get_admin_customer_orders(uuid)
  to authenticated;
