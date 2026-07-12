-- ============================================================
-- Renovar — Sistema interno (área do aluno + gestão)
-- Migração 2 (aditiva ao schema.sql). Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 0) RBAC: cargo no perfil + funções auxiliares
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists role text not null default 'aluno'
    check (role in ('admin', 'gerente', 'funcionario', 'aluno')),
  add column if not exists prefs jsonb not null default '{}'::jsonb,
  add column if not exists avatar_url text;

create or replace function public.get_my_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.get_my_role() in ('admin','gerente','funcionario'), false) $$;

-- ninguém muda o próprio cargo (só admin; service_role/postgres passam direto)
create or replace function public.protect_role_change()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and public.get_my_role() is distinct from 'admin' then
    raise exception 'apenas administradores podem alterar cargos';
  end if;
  return new;
end $$;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role
  before update on public.profiles
  for each row execute function public.protect_role_change();

-- equipe enxerga todos os perfis; admin edita qualquer um
drop policy if exists "profiles_select_staff" on public.profiles;
create policy "profiles_select_staff" on public.profiles
  for select using (public.is_staff());

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles
  for update using (public.get_my_role() = 'admin');

-- ------------------------------------------------------------
-- 1) ÁREA DO ALUNO: planos, assinaturas, consultas, financeiro
-- ------------------------------------------------------------
create table if not exists public.planos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text not null default '',
  preco numeric(10,2) not null,
  aulas_semana int not null default 2,
  ativo boolean not null default true
);
alter table public.planos enable row level security;
drop policy if exists "planos_select_auth" on public.planos;
create policy "planos_select_auth" on public.planos
  for select using (auth.uid() is not null);
drop policy if exists "planos_write_gestao" on public.planos;
create policy "planos_write_gestao" on public.planos
  for all using (public.get_my_role() in ('admin','gerente'));

create table if not exists public.assinaturas (
  id uuid primary key default gen_random_uuid(),
  aluno_id uuid not null references public.profiles (id) on delete cascade,
  plano_id uuid not null references public.planos (id),
  status text not null default 'ativa' check (status in ('ativa','pausada','cancelada')),
  inicio date not null default current_date,
  created_at timestamptz not null default now()
);
alter table public.assinaturas enable row level security;
drop policy if exists "assinaturas_own" on public.assinaturas;
create policy "assinaturas_own" on public.assinaturas
  for all using (aluno_id = auth.uid()) with check (aluno_id = auth.uid());
drop policy if exists "assinaturas_staff" on public.assinaturas;
create policy "assinaturas_staff" on public.assinaturas
  for all using (public.is_staff());

create table if not exists public.consultas (
  id uuid primary key default gen_random_uuid(),
  aluno_id uuid not null references public.profiles (id) on delete cascade,
  tipo text not null check (tipo in ('fisioterapia','estetica','palmilhas','pilates','avaliacao')),
  data date not null,
  hora time not null,
  status text not null default 'agendada' check (status in ('agendada','concluida','cancelada')),
  observacoes text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists consultas_slot_unico
  on public.consultas (aluno_id, data, hora) where (status = 'agendada');
create index if not exists consultas_aluno_idx on public.consultas (aluno_id);
alter table public.consultas enable row level security;
drop policy if exists "consultas_own" on public.consultas;
create policy "consultas_own" on public.consultas
  for all using (aluno_id = auth.uid()) with check (aluno_id = auth.uid());
drop policy if exists "consultas_staff" on public.consultas;
create policy "consultas_staff" on public.consultas
  for all using (public.is_staff());

create table if not exists public.financeiro_aluno (
  id uuid primary key default gen_random_uuid(),
  aluno_id uuid not null references public.profiles (id) on delete cascade,
  descricao text not null,
  valor numeric(10,2) not null,
  vencimento date not null,
  status text not null default 'pendente' check (status in ('pendente','pago','atrasado')),
  pago_em timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists financeiro_aluno_idx on public.financeiro_aluno (aluno_id);
alter table public.financeiro_aluno enable row level security;
drop policy if exists "fin_select_own" on public.financeiro_aluno;
create policy "fin_select_own" on public.financeiro_aluno
  for select using (aluno_id = auth.uid());
drop policy if exists "fin_pay_own" on public.financeiro_aluno;
create policy "fin_pay_own" on public.financeiro_aluno
  for update using (aluno_id = auth.uid()) with check (aluno_id = auth.uid());
drop policy if exists "fin_staff" on public.financeiro_aluno;
create policy "fin_staff" on public.financeiro_aluno
  for all using (public.is_staff());

-- ------------------------------------------------------------
-- 2) DASHBOARD GERENCIAL: vendas, despesas, estoque
-- ------------------------------------------------------------
create table if not exists public.vendas (
  id uuid primary key default gen_random_uuid(),
  descricao text not null,
  valor numeric(10,2) not null,
  categoria text not null default 'geral',
  data date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists vendas_data_idx on public.vendas (data);
alter table public.vendas enable row level security;
drop policy if exists "vendas_gestao" on public.vendas;
create policy "vendas_gestao" on public.vendas
  for all using (public.get_my_role() in ('admin','gerente'));

create table if not exists public.despesas (
  id uuid primary key default gen_random_uuid(),
  descricao text not null,
  valor numeric(10,2) not null,
  categoria text not null default 'geral',
  data date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists despesas_data_idx on public.despesas (data);
alter table public.despesas enable row level security;
drop policy if exists "despesas_gestao" on public.despesas;
create policy "despesas_gestao" on public.despesas
  for all using (public.get_my_role() in ('admin','gerente'));

-- pagamento de aluno confirmado -> entra no fluxo de caixa na hora
create or replace function public.registrar_pagamento()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'pago' and old.status is distinct from 'pago' then
    new.pago_em := now();
    insert into public.vendas (descricao, valor, categoria, data)
    values ('Pagamento aluno: ' || new.descricao, new.valor, 'mensalidade', current_date);
  end if;
  return new;
end $$;

drop trigger if exists fin_registrar_pagamento on public.financeiro_aluno;
create trigger fin_registrar_pagamento
  before update on public.financeiro_aluno
  for each row execute function public.registrar_pagamento();

-- aluno só pode marcar a própria cobrança como paga; valor/descrição/vencimento imutáveis
-- (impede forjar o valor que o trigger acima lança no fluxo de caixa)
create or replace function public.guard_financeiro_aluno()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or public.is_staff() then
    return new;
  end if;
  if new.aluno_id   is distinct from old.aluno_id
     or new.descricao  is distinct from old.descricao
     or new.valor      is distinct from old.valor
     or new.vencimento is distinct from old.vencimento then
    raise exception 'alteracao de campos da cobranca nao permitida';
  end if;
  if old.status = 'pago' and new.status <> 'pago' then
    raise exception 'cobranca ja paga nao pode ser revertida';
  end if;
  return new;
end $$;

-- fin_guard (antes de fin_registrar_pagamento na ordem alfabética) valida antes da baixa
drop trigger if exists fin_guard on public.financeiro_aluno;
create trigger fin_guard
  before update on public.financeiro_aluno
  for each row execute function public.guard_financeiro_aluno();

create table if not exists public.produtos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  categoria text not null default 'geral',
  quantidade int not null default 0,
  estoque_minimo int not null default 5,
  preco numeric(10,2) not null default 0
);
alter table public.produtos enable row level security;
drop policy if exists "produtos_staff_select" on public.produtos;
create policy "produtos_staff_select" on public.produtos
  for select using (public.is_staff());
drop policy if exists "produtos_gestao_write" on public.produtos;
create policy "produtos_gestao_write" on public.produtos
  for all using (public.get_my_role() in ('admin','gerente'));

-- ------------------------------------------------------------
-- 3) PROJETOS E TAREFAS (Kanban)
-- ------------------------------------------------------------
create table if not exists public.projetos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text not null default '',
  cor text not null default '#FE5800',
  status text not null default 'ativo' check (status in ('ativo','arquivado')),
  created_at timestamptz not null default now()
);
alter table public.projetos enable row level security;
drop policy if exists "projetos_staff" on public.projetos;
create policy "projetos_staff" on public.projetos
  for all using (public.is_staff());

create table if not exists public.tarefas (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references public.projetos (id) on delete cascade,
  titulo text not null,
  descricao text not null default '',
  coluna text not null default 'todo' check (coluna in ('todo','doing','review','done')),
  posicao int not null default 0,
  responsavel_id uuid references public.profiles (id) on delete set null,
  criado_por uuid default auth.uid() references public.profiles (id) on delete set null,
  prazo timestamptz,
  checklist jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tarefas_projeto_idx on public.tarefas (projeto_id);
alter table public.tarefas enable row level security;
drop policy if exists "tarefas_staff" on public.tarefas;
create policy "tarefas_staff" on public.tarefas
  for all using (public.is_staff());

drop trigger if exists tarefas_set_updated_at on public.tarefas;
create trigger tarefas_set_updated_at
  before update on public.tarefas
  for each row execute function public.set_updated_at();

create table if not exists public.tarefa_comentarios (
  id uuid primary key default gen_random_uuid(),
  tarefa_id uuid not null references public.tarefas (id) on delete cascade,
  autor_id uuid default auth.uid() references public.profiles (id) on delete set null,
  texto text not null,
  created_at timestamptz not null default now()
);
create index if not exists tarefa_comentarios_idx on public.tarefa_comentarios (tarefa_id);
alter table public.tarefa_comentarios enable row level security;
drop policy if exists "comentarios_staff" on public.tarefa_comentarios;
create policy "comentarios_staff" on public.tarefa_comentarios
  for all using (public.is_staff());

-- ------------------------------------------------------------
-- 4) WIKI (base de conhecimento) com busca indexada e versões
-- ------------------------------------------------------------
create table if not exists public.wiki_artigos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  categoria text not null default 'Geral' check (categoria in ('RH','Vendas','Suporte','Geral')),
  conteudo text not null default '',
  autor_id uuid default auth.uid() references public.profiles (id) on delete set null,
  atualizado_em timestamptz not null default now(),
  fts tsvector generated always as
    (to_tsvector('portuguese', coalesce(titulo,'') || ' ' || coalesce(conteudo,''))) stored
);
create index if not exists wiki_fts_idx on public.wiki_artigos using gin (fts);
alter table public.wiki_artigos enable row level security;
drop policy if exists "wiki_staff" on public.wiki_artigos;
create policy "wiki_staff" on public.wiki_artigos
  for all using (public.is_staff());

create table if not exists public.wiki_versoes (
  id uuid primary key default gen_random_uuid(),
  artigo_id uuid not null references public.wiki_artigos (id) on delete cascade,
  titulo text not null,
  conteudo text not null,
  editor_id uuid references public.profiles (id) on delete set null,
  criado_em timestamptz not null default now()
);
create index if not exists wiki_versoes_idx on public.wiki_versoes (artigo_id);
alter table public.wiki_versoes enable row level security;
drop policy if exists "wiki_versoes_staff" on public.wiki_versoes;
create policy "wiki_versoes_staff" on public.wiki_versoes
  for all using (public.is_staff());

-- ------------------------------------------------------------
-- 5) HELPDESK (atendimento omnichannel)
-- ------------------------------------------------------------
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  cliente_nome text not null,
  cliente_contato text not null default '',
  canal text not null check (canal in ('whatsapp','email','chat')),
  assunto text not null,
  status text not null default 'aberto' check (status in ('aberto','em_atendimento','resolvido')),
  atendente_id uuid references public.profiles (id) on delete set null,
  nps int check (nps between 0 and 10),
  criado_em timestamptz not null default now(),
  encerrado_em timestamptz
);
alter table public.tickets enable row level security;
drop policy if exists "tickets_staff" on public.tickets;
create policy "tickets_staff" on public.tickets
  for all using (public.is_staff());

create table if not exists public.ticket_mensagens (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  origem text not null check (origem in ('cliente','atendente','sistema')),
  autor_id uuid references public.profiles (id) on delete set null,
  texto text not null,
  criado_em timestamptz not null default now()
);
create index if not exists ticket_mensagens_idx on public.ticket_mensagens (ticket_id);
alter table public.ticket_mensagens enable row level security;
drop policy if exists "ticket_msgs_staff" on public.ticket_mensagens;
create policy "ticket_msgs_staff" on public.ticket_mensagens
  for all using (public.is_staff());

create table if not exists public.respostas_rapidas (
  id uuid primary key default gen_random_uuid(),
  atalho text not null unique,
  texto text not null
);
alter table public.respostas_rapidas enable row level security;
drop policy if exists "respostas_staff" on public.respostas_rapidas;
create policy "respostas_staff" on public.respostas_rapidas
  for all using (public.is_staff());

-- ------------------------------------------------------------
-- 6) NOTIFICAÇÕES (tempo real via Realtime)
-- ------------------------------------------------------------
create table if not exists public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.profiles (id) on delete cascade,
  texto text not null,
  link text not null default '',
  lida boolean not null default false,
  criado_em timestamptz not null default now()
);
create index if not exists notificacoes_usuario_idx on public.notificacoes (usuario_id);
alter table public.notificacoes enable row level security;
drop policy if exists "notif_select_own" on public.notificacoes;
create policy "notif_select_own" on public.notificacoes
  for select using (usuario_id = auth.uid());
drop policy if exists "notif_update_own" on public.notificacoes;
create policy "notif_update_own" on public.notificacoes
  for update using (usuario_id = auth.uid());
drop policy if exists "notif_delete_own" on public.notificacoes;
create policy "notif_delete_own" on public.notificacoes
  for delete using (usuario_id = auth.uid());
-- só a equipe cria notificações (evita spoofing/spam entre usuários autenticados)
drop policy if exists "notif_insert_auth" on public.notificacoes;
drop policy if exists "notif_insert_staff" on public.notificacoes;
create policy "notif_insert_staff" on public.notificacoes
  for insert to authenticated with check (public.is_staff());

-- publica tabelas no Realtime (ignora se já publicadas)
do $$
declare t text;
begin
  foreach t in array array['notificacoes','tarefas','ticket_mensagens','vendas','despesas','financeiro_aluno']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 7) STORAGE: fotos de perfil (bucket público "avatars")
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars_read_public" on storage.objects;
create policy "avatars_read_public" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars_upsert_own" on storage.objects;
create policy "avatars_upsert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
