-- Mid-Autumn blessing wall.
-- Run this migration once in the Supabase SQL Editor before publishing the site.

create extension if not exists pgcrypto;

create table if not exists public.mid_autumn_blessings (
  id uuid primary key default gen_random_uuid(),
  nickname text not null default '一位朋友'
    check (char_length(nickname) between 1 and 20),
  message text not null
    check (char_length(btrim(message)) between 2 and 160),
  visitor_id uuid not null,
  status text not null default 'published'
    check (status in ('published', 'hidden')),
  created_at timestamptz not null default now()
);

create index if not exists mid_autumn_blessings_visible_idx
  on public.mid_autumn_blessings (status, created_at desc);

create or replace function public.enforce_mid_autumn_blessing_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    select count(*)
    from public.mid_autumn_blessings
    where visitor_id = new.visitor_id
      and created_at > now() - interval '10 minutes'
  ) >= 5 then
    raise exception '祝福提交得有点快，请稍后再试。';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_mid_autumn_blessing_rate_limit
  on public.mid_autumn_blessings;
create trigger enforce_mid_autumn_blessing_rate_limit
  before insert on public.mid_autumn_blessings
  for each row execute procedure public.enforce_mid_autumn_blessing_rate_limit();

alter table public.mid_autumn_blessings enable row level security;

drop policy if exists "visible blessings are public" on public.mid_autumn_blessings;
create policy "visible blessings are public"
  on public.mid_autumn_blessings for select
  to anon, authenticated
  using (status = 'published');

drop policy if exists "visitors can publish a blessing" on public.mid_autumn_blessings;
create policy "visitors can publish a blessing"
  on public.mid_autumn_blessings for insert
  to anon, authenticated
  with check (
    status = 'published'
    and char_length(nickname) between 1 and 20
    and char_length(btrim(message)) between 2 and 160
    and visitor_id is not null
  );

grant usage on schema public to anon, authenticated;
grant select, insert on public.mid_autumn_blessings to anon, authenticated;
grant execute on function public.enforce_mid_autumn_blessing_rate_limit()
  to anon, authenticated;
