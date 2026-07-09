-- ============================================================
-- Renovar Pilates & Fisioterapia — Schema do banco (Supabase)
-- Projeto: qsxigbnvuuxqsqfqthqg
-- Este arquivo é idempotente: pode ser executado mais de uma vez.
-- ============================================================

-- ------------------------------------------------------------
-- 1) PERFIS DE ALUNOS
--    Criado automaticamente quando um usuário se cadastra
--    (trigger em auth.users). RLS: cada um só vê o próprio.
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null default '',
  phone      text not null default '',
  plan       text not null default 'particular'
             check (plan in ('particular', 'gympass', 'totalpass')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Mantém updated_at sempre atualizado
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Cria o perfil automaticamente no cadastro,
-- copiando os metadados enviados pelo formulário de registro.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, plan)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', ''),
    case
      when new.raw_user_meta_data ->> 'plan' in ('particular', 'gympass', 'totalpass')
        then new.raw_user_meta_data ->> 'plan'
      else 'particular'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 2) MENSAGENS DE CONTATO
--    O formulário público insere aqui (anon pode INSERIR,
--    mas nunca LER — leitura só pelo painel/service_role).
-- ------------------------------------------------------------
create table if not exists public.contact_messages (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 2 and 120),
  email      text not null check (char_length(email) between 5 and 160),
  phone      text check (phone is null or char_length(phone) <= 30),
  interest   text not null check (interest in (
               'pilates', 'pilates-gympass', 'pilates-totalpass',
               'fisioterapia', 'miofascial')),
  message    text check (message is null or char_length(message) <= 2000),
  created_at timestamptz not null default now()
);

alter table public.contact_messages enable row level security;

drop policy if exists "contact_insert_public" on public.contact_messages;
create policy "contact_insert_public"
  on public.contact_messages for insert
  to anon, authenticated
  with check (true);

-- (sem política de SELECT de propósito: mensagens não são públicas)
