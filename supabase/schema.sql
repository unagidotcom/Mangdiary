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

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  display_name text,
  avatar_url text,
  bio text,
  instagram_handle text,
  tiktok_handle text,
  extra_links jsonb not null default '{}'::jsonb,
  matching_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.profiles
add column if not exists username text;

alter table if exists public.profiles
add column if not exists display_name text;

alter table if exists public.profiles
add column if not exists avatar_url text;

alter table if exists public.profiles
add column if not exists bio text;

alter table if exists public.profiles
add column if not exists instagram_handle text;

alter table if exists public.profiles
add column if not exists tiktok_handle text;

alter table if exists public.profiles
add column if not exists extra_links jsonb not null default '{}'::jsonb;

alter table if exists public.profiles
add column if not exists matching_enabled boolean not null default true;

create unique index if not exists profiles_username_lower_unique
on public.profiles (lower(username))
where username is not null and length(trim(username)) > 0;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  4194304,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

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

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null default '',
  is_read boolean not null default false,
  related_match_id uuid,
  related_entry_id uuid references public.journal_entries(id) on delete set null,
  created_at timestamptz not null default now()
);

create extension if not exists vector;

create table if not exists public.dream_embeddings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid not null references public.journal_entries(id) on delete cascade,
  embedding vector(1536) not null,
  created_at timestamptz not null default now(),
  unique (entry_id)
);

create table if not exists public.dream_matches (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references auth.users(id) on delete cascade,
  user_b_id uuid not null references auth.users(id) on delete cascade,
  entry_a_id uuid references public.journal_entries(id) on delete set null,
  entry_b_id uuid references public.journal_entries(id) on delete set null,
  score double precision not null default 0,
  status text not null default 'pending',
  consent_a text not null default 'pending',
  consent_b text not null default 'pending',
  share_a_entry_id uuid references public.journal_entries(id) on delete set null,
  share_b_entry_id uuid references public.journal_entries(id) on delete set null,
  share_a_anonymous boolean not null default true,
  share_b_anonymous boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists dream_matches_pair_entries_unique
on public.dream_matches (
  least(user_a_id, user_b_id),
  greatest(user_a_id, user_b_id),
  least(entry_a_id, entry_b_id),
  greatest(entry_a_id, entry_b_id)
)
where entry_a_id is not null and entry_b_id is not null;

alter table if exists public.notifications
drop constraint if exists notifications_related_match_id_fkey;

alter table if exists public.notifications
add constraint notifications_related_match_id_fkey
foreign key (related_match_id) references public.dream_matches(id) on delete set null;

create table if not exists public.dream_circles (
  id uuid primary key default gen_random_uuid(),
  related_match_id uuid references public.dream_matches(id) on delete set null,
  name text,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

alter table if exists public.dream_circles
add column if not exists related_match_id uuid references public.dream_matches(id) on delete set null;

create table if not exists public.circle_members (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.dream_circles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  alias text,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  unique (circle_id, user_id)
);

create table if not exists public.circle_messages (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.dream_circles(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.circle_pinned_dreams (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.dream_circles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid not null references public.journal_entries(id) on delete cascade,
  pinned_at timestamptz not null default now(),
  unique (circle_id, user_id, entry_id)
);

alter table public.journal_entries enable row level security;
alter table public.profiles enable row level security;
alter table public.weekly_reflections enable row level security;
alter table public.monthly_reflections enable row level security;
alter table public.notifications enable row level security;
alter table public.dream_embeddings enable row level security;
alter table public.dream_matches enable row level security;
alter table public.dream_circles enable row level security;
alter table public.circle_members enable row level security;
alter table public.circle_messages enable row level security;
alter table public.circle_pinned_dreams enable row level security;

drop policy if exists "Users can read own journal entries" on public.journal_entries;
drop policy if exists "Users can insert own journal entries" on public.journal_entries;
drop policy if exists "Users can update own journal entries" on public.journal_entries;
drop policy if exists "Users can delete own journal entries" on public.journal_entries;
drop policy if exists "Users can read own profile" on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Avatar images are public" on storage.objects;
drop policy if exists "Users can upload own avatar" on storage.objects;
drop policy if exists "Users can update own avatar" on storage.objects;
drop policy if exists "Users can delete own avatar" on storage.objects;
drop policy if exists "Users can read own weekly reflections" on public.weekly_reflections;
drop policy if exists "Users can manage own weekly reflections" on public.weekly_reflections;
drop policy if exists "Users can read own monthly reflections" on public.monthly_reflections;
drop policy if exists "Users can manage own monthly reflections" on public.monthly_reflections;
drop policy if exists "Users can read own notifications" on public.notifications;
drop policy if exists "Users can update own notifications" on public.notifications;
drop policy if exists "Users can read own dream matches" on public.dream_matches;
drop policy if exists "Users can update own dream matches" on public.dream_matches;
drop policy if exists "Users can read member circles" on public.dream_circles;
drop policy if exists "Users can read own circle memberships" on public.circle_members;
drop policy if exists "Users can read circle messages" on public.circle_messages;
drop policy if exists "Users can insert circle messages" on public.circle_messages;
drop policy if exists "Users can read circle pinned dreams" on public.circle_pinned_dreams;

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

create policy "Users can read own profile"
on public.profiles for select
using (auth.uid() = id);

create policy "Users can insert own profile"
on public.profiles for insert
with check (auth.uid() = id);

create policy "Users can update own profile"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "Avatar images are public"
on storage.objects for select
using (bucket_id = 'avatars');

create policy "Users can upload own avatar"
on storage.objects for insert
with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can update own avatar"
on storage.objects for update
using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1])
with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can delete own avatar"
on storage.objects for delete
using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

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

create policy "Users can read own notifications"
on public.notifications for select
using (auth.uid() = user_id);

create policy "Users can update own notifications"
on public.notifications for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can read own dream matches"
on public.dream_matches for select
using (auth.uid() = user_a_id or auth.uid() = user_b_id);

create policy "Users can update own dream matches"
on public.dream_matches for update
using (auth.uid() = user_a_id or auth.uid() = user_b_id)
with check (auth.uid() = user_a_id or auth.uid() = user_b_id);

create policy "Users can read member circles"
on public.dream_circles for select
using (
  exists (
    select 1
    from public.circle_members
    where circle_members.circle_id = dream_circles.id
      and circle_members.user_id = auth.uid()
      and circle_members.left_at is null
  )
);

create policy "Users can read own circle memberships"
on public.circle_members for select
using (auth.uid() = user_id);

create policy "Users can read circle messages"
on public.circle_messages for select
using (
  exists (
    select 1
    from public.circle_members
    where circle_members.circle_id = circle_messages.circle_id
      and circle_members.user_id = auth.uid()
      and circle_members.left_at is null
  )
);

create policy "Users can insert circle messages"
on public.circle_messages for insert
with check (
  auth.uid() = sender_id
  and exists (
    select 1
    from public.circle_members
    where circle_members.circle_id = circle_messages.circle_id
      and circle_members.user_id = auth.uid()
      and circle_members.left_at is null
  )
);

create policy "Users can read circle pinned dreams"
on public.circle_pinned_dreams for select
using (
  exists (
    select 1
    from public.circle_members
    where circle_members.circle_id = circle_pinned_dreams.circle_id
      and circle_members.user_id = auth.uid()
      and circle_members.left_at is null
  )
);

create index if not exists journal_entries_user_date_idx
on public.journal_entries (user_id, entry_date desc, entry_index desc, created_at desc);

create index if not exists notifications_user_created_idx
on public.notifications (user_id, created_at desc);

create index if not exists dream_embeddings_user_entry_idx
on public.dream_embeddings (user_id, entry_id);

create index if not exists dream_matches_user_a_idx
on public.dream_matches (user_a_id, created_at desc);

create index if not exists dream_matches_user_b_idx
on public.dream_matches (user_b_id, created_at desc);

create unique index if not exists dream_circles_related_match_unique
on public.dream_circles (related_match_id)
where related_match_id is not null;

create index if not exists circle_members_user_idx
on public.circle_members (user_id, joined_at desc);

create index if not exists circle_messages_circle_created_idx
on public.circle_messages (circle_id, created_at);
