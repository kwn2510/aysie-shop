create table if not exists public.customer_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_reference uuid not null,
  order_status text not null
    check (order_status in ('awaiting_review', 'paid', 'fulfilled', 'cancelled')),
  title text not null,
  message text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists customer_notifications_user_created_idx
  on public.customer_notifications (user_id, created_at desc);
create index if not exists customer_notifications_unread_idx
  on public.customer_notifications (user_id, created_at desc)
  where read_at is null;

alter table public.customer_notifications enable row level security;
revoke all on public.customer_notifications from public, anon, authenticated;
grant select on public.customer_notifications to authenticated;
grant update (read_at) on public.customer_notifications to authenticated;

drop policy if exists "Customers can read their own notifications"
  on public.customer_notifications;
create policy "Customers can read their own notifications"
on public.customer_notifications for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Customers can mark their own notifications as read"
  on public.customer_notifications;
create policy "Customers can mark their own notifications as read"
on public.customer_notifications for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create or replace function public.notify_customer_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_short_reference text := pg_catalog.left(new.client_reference::text, 8);
  v_title text;
  v_message text;
begin
  if new.user_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.status is not distinct from new.status then
      return new;
    end if;
  end if;

  case new.status
    when 'awaiting_review' then
      v_title := 'Shop đã ghi nhận đơn hàng';
      v_message := 'Đơn ' || v_short_reference || ' đang chờ shop kiểm tra thanh toán.';
    when 'paid' then
      v_title := 'Thanh toán đã được xác nhận';
      v_message := 'Shop đã xác nhận thanh toán cho đơn ' || v_short_reference || '.';
    when 'fulfilled' then
      v_title := 'Mầm đã được giao';
      v_message := 'File của đơn ' || v_short_reference || ' đã được gửi qua email đặt hàng.';
    when 'cancelled' then
      v_title := 'Đơn hàng đã được hủy';
      v_message := 'Đơn ' || v_short_reference || ' đã được shop cập nhật trạng thái hủy.';
    else
      return new;
  end case;

  insert into public.customer_notifications (
    user_id, client_reference, order_status, title, message
  )
  values (
    new.user_id, new.client_reference, new.status, v_title, v_message
  );

  return new;
end;
$$;

revoke all on function public.notify_customer_order_status()
  from public, anon, authenticated;
drop trigger if exists notify_customer_order_status on public.orders;
create trigger notify_customer_order_status
after insert or update of status on public.orders
for each row
execute function public.notify_customer_order_status();
