create table if not exists public.product_reviews (
  id bigint generated always as identity primary key,
  product_id bigint,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 60),
  product_name text check (product_name is null or char_length(btrim(product_name)) between 1 and 100),
  rating smallint not null check (rating between 1 and 5),
  comment text not null check (char_length(btrim(comment)) between 10 and 1200),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

alter table public.product_reviews add column if not exists product_name text;
alter table public.product_reviews alter column product_id drop not null;
alter table public.product_reviews drop constraint if exists product_reviews_product_id_fkey;

create index if not exists product_reviews_public_list_idx
  on public.product_reviews (created_at desc)
  where status = 'approved';
create index if not exists product_reviews_admin_queue_idx
  on public.product_reviews (status, created_at desc);

create or replace function public.prepare_product_review()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.status := 'pending';
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists prepare_product_review on public.product_reviews;
create trigger prepare_product_review
before insert on public.product_reviews
for each row execute function public.prepare_product_review();

alter table public.product_reviews enable row level security;

revoke all on public.product_reviews from anon, authenticated;
grant select, insert on public.product_reviews to anon, authenticated;
grant update (status) on public.product_reviews to authenticated;
grant usage, select on sequence public.product_reviews_id_seq to anon, authenticated;
grant usage on schema private to anon, authenticated;
grant execute on function private.is_admin() to anon, authenticated;

drop policy if exists "Anyone can read approved product reviews" on public.product_reviews;
create policy "Anyone can read approved product reviews"
on public.product_reviews for select
to anon, authenticated
using (status = 'approved' or private.is_admin());

drop policy if exists "Visitors can submit pending product reviews" on public.product_reviews;
create policy "Visitors can submit pending product reviews"
on public.product_reviews for insert
to anon, authenticated
with check (
  status = 'pending'
  and char_length(btrim(display_name)) between 2 and 60
  and char_length(btrim(comment)) between 10 and 1200
  and (product_name is null or char_length(btrim(product_name)) between 1 and 100)
  and rating between 1 and 5
);

drop policy if exists "Admins can moderate product reviews" on public.product_reviews;
create policy "Admins can moderate product reviews"
on public.product_reviews for update
to authenticated
using (private.is_admin())
with check (private.is_admin());
