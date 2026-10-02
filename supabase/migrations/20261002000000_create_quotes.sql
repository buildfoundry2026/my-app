-- QuoteCanvas: per-user saved quotes, protected by row-level security.

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  raw_text text not null check (char_length(raw_text) <= 500),
  book_title text,
  author text,
  template_used text not null,
  aspect_ratio text not null default '4:5' check (aspect_ratio in ('9:16', '4:5', '1:1')),
  created_at timestamptz not null default now()
);

create index if not exists quotes_user_id_created_at_idx
  on public.quotes (user_id, created_at desc);

alter table public.quotes enable row level security;

create policy "Users can read their own quotes"
  on public.quotes for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own quotes"
  on public.quotes for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own quotes"
  on public.quotes for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own quotes"
  on public.quotes for delete
  to authenticated
  using ((select auth.uid()) = user_id);
