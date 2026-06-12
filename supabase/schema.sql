create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null default '',
  summary text,
  reflection text,
  mood text,
  themes text[] not null default '{}',
  image_url text,
  image_prompt text,
  entry_date date not null,
  entry_index integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.journal_entries
drop constraint if exists journal_entries_user_id_entry_date_key;

alter table if exists public.journal_entries
add column if not exists entry_index integer not null default 1;

with numbered as (
  select
    id,
    row_number() over (partition by user_id, entry_date order by created_at, id) as next_index
  from public.journal_entries
)
update public.journal_entries
set entry_index = numbered.next_index
from numbered
where public.journal_entries.id = numbered.id;

create unique index if not exists journal_entries_user_date_index_unique
on public.journal_entries (user_id, entry_date, entry_index);

create table if not exists public.weekly_reflections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  content jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start)
);

create table if not exists public.monthly_reflections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month_start date not null,
  content jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, month_start)
);

alter table public.journal_entries enable row level security;
alter table public.weekly_reflections enable row level security;
alter table public.monthly_reflections enable row level security;

drop policy if exists "Users can read own journal entries" on public.journal_entries;
drop policy if exists "Users can insert own journal entries" on public.journal_entries;
drop policy if exists "Users can update own journal entries" on public.journal_entries;
drop policy if exists "Users can delete own journal entries" on public.journal_entries;
drop policy if exists "Users can read own weekly reflections" on public.weekly_reflections;
drop policy if exists "Users can manage own weekly reflections" on public.weekly_reflections;
drop policy if exists "Users can read own monthly reflections" on public.monthly_reflections;
drop policy if exists "Users can manage own monthly reflections" on public.monthly_reflections;

create policy "Users can read own journal entries"
on public.journal_entries for select
using (auth.uid() = user_id);

create policy "Users can insert own journal entries"
on public.journal_entries for insert
with check (auth.uid() = user_id);

create policy "Users can update own journal entries"
on public.journal_entries for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own journal entries"
on public.journal_entries for delete
using (auth.uid() = user_id);

create policy "Users can read own weekly reflections"
on public.weekly_reflections for select
using (auth.uid() = user_id);

create policy "Users can manage own weekly reflections"
on public.weekly_reflections for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can read own monthly reflections"
on public.monthly_reflections for select
using (auth.uid() = user_id);

create policy "Users can manage own monthly reflections"
on public.monthly_reflections for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists journal_entries_user_date_idx
on public.journal_entries (user_id, entry_date desc, entry_index desc, created_at desc);
