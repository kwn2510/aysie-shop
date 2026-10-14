create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.profiles (id, display_name)
select
  u.id,
  coalesce(
    nullif(pg_catalog.btrim(u.raw_user_meta_data->>'display_name'), ''),
    split_part(u.email, '@', 1)
  )
from auth.users as u
where char_length(pg_catalog.btrim(coalesce(
  nullif(u.raw_user_meta_data->>'display_name', ''),
  split_part(u.email, '@', 1)
))) between 2 and 60
on conflict (id) do nothing;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
begin
  v_display_name := coalesce(
    nullif(pg_catalog.btrim(new.raw_user_meta_data->>'display_name'), ''),
    split_part(new.email, '@', 1)
  );
  if char_length(v_display_name) not between 2 and 60 then
    v_display_name := 'AYSie';
  end if;

  insert into public.profiles (id, display_name)
  values (new.id, v_display_name)
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.create_profile_for_new_user() from public, anon, authenticated;
drop trigger if exists create_profile_for_new_user on auth.users;
create trigger create_profile_for_new_user
after insert on auth.users
for each row
execute function public.create_profile_for_new_user();

create or replace function public.set_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.set_profile_updated_at() from public, anon, authenticated;
drop trigger if exists set_profile_updated_at on public.profiles;
create trigger set_profile_updated_at
before update on public.profiles
for each row
execute function public.set_profile_updated_at();

alter table public.profiles enable row level security;
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

drop policy if exists "Customers can read their own profile" on public.profiles;
create policy "Customers can read their own profile"
on public.profiles for select
to authenticated
using (id = (select auth.uid()));

drop policy if exists "Customers can update their own profile" on public.profiles;
create policy "Customers can update their own profile"
on public.profiles for update
to authenticated
using (id = (select auth.uid()))
with check (
  id = (select auth.uid())
  and char_length(pg_catalog.btrim(display_name)) between 2 and 60
);
