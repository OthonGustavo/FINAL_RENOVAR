-- ============================================================
-- Renovar — Sistema interno: patch + dados iniciais
-- Pode ser executado mais de uma vez (seed só roda se vazio).
-- ============================================================

-- ---------- Patch: e-mail no perfil + anexos de tarefas ----------
alter table public.profiles add column if not exists email text not null default '';
update public.profiles p set email = u.email
  from auth.users u where u.id = p.id and p.email = '';

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, plan, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', ''),
    case when new.raw_user_meta_data ->> 'plan' in ('particular','gympass','totalpass')
         then new.raw_user_meta_data ->> 'plan' else 'particular' end,
    coalesce(new.email, '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

create table if not exists public.tarefa_anexos (
  id uuid primary key default gen_random_uuid(),
  tarefa_id uuid not null references public.tarefas (id) on delete cascade,
  nome text not null,
  url text not null,
  criado_em timestamptz not null default now()
);
alter table public.tarefa_anexos enable row level security;
drop policy if exists "anexos_staff" on public.tarefa_anexos;
create policy "anexos_staff" on public.tarefa_anexos
  for all using (public.is_staff());

insert into storage.buckets (id, name, public)
values ('anexos', 'anexos', true) on conflict (id) do nothing;

drop policy if exists "anexos_read_public" on storage.objects;
create policy "anexos_read_public" on storage.objects
  for select using (bucket_id = 'anexos');
drop policy if exists "anexos_upload_staff" on storage.objects;
create policy "anexos_upload_staff" on storage.objects
  for insert to authenticated with check (bucket_id = 'anexos' and public.is_staff());
drop policy if exists "anexos_delete_staff" on storage.objects;
create policy "anexos_delete_staff" on storage.objects
  for delete to authenticated using (bucket_id = 'anexos' and public.is_staff());

-- ---------- Cargos das contas de teste ----------
update public.profiles set role = 'admin'
  where email = 'admin.renovar@example.com';
update public.profiles set role = 'gerente'
  where email = 'gerente.renovar@example.com';
update public.profiles set role = 'funcionario'
  where email = 'atendente.renovar@example.com';
update public.profiles set role = 'aluno'
  where email = 'aluno.teste.renovar@example.com';

-- ---------- Seed (só roda se o catálogo estiver vazio) ----------
do $seed$
declare
  v_admin uuid; v_gerente uuid; v_atend uuid; v_aluno uuid;
  v_plano1 uuid; v_plano2 uuid; v_plano3 uuid;
  v_proj1 uuid; v_proj2 uuid; v_proj3 uuid;
  v_art uuid; v_tk uuid;
begin
  if exists (select 1 from public.planos) then
    raise notice 'seed já aplicado — nada a fazer';
    return;
  end if;

  select id into v_admin   from public.profiles where email = 'admin.renovar@example.com';
  select id into v_gerente from public.profiles where email = 'gerente.renovar@example.com';
  select id into v_atend   from public.profiles where email = 'atendente.renovar@example.com';
  select id into v_aluno   from public.profiles where email = 'aluno.teste.renovar@example.com';

  -- Planos
  insert into public.planos (nome, descricao, preco, aulas_semana) values
    ('Essencial', 'Pilates em grupo 2x por semana. Ideal para começar com consistência.', 289.90, 2)
    returning id into v_plano1;
  insert into public.planos (nome, descricao, preco, aulas_semana) values
    ('Performance', 'Pilates em grupo 3x por semana + 1 avaliação trimestral inclusa.', 389.90, 3)
    returning id into v_plano2;
  insert into public.planos (nome, descricao, preco, aulas_semana) values
    ('Livre', 'Aulas ilimitadas + prioridade na agenda de fisioterapia.', 449.90, 7)
    returning id into v_plano3;

  -- Aluno de teste: assinatura, financeiro e consultas
  if v_aluno is not null then
    insert into public.assinaturas (aluno_id, plano_id, status, inicio)
    values (v_aluno, v_plano1, 'ativa', current_date - 65);

    insert into public.financeiro_aluno (aluno_id, descricao, valor, vencimento, status, pago_em) values
      (v_aluno, 'Mensalidade Essencial — 2 meses atrás', 289.90, current_date - 60, 'pago', now() - interval '58 days'),
      (v_aluno, 'Mensalidade Essencial — mês passado',   289.90, current_date - 30, 'pago', now() - interval '28 days'),
      (v_aluno, 'Avaliação física inicial',               120.00, current_date - 62, 'pago', now() - interval '60 days'),
      (v_aluno, 'Mensalidade Essencial — mês atual',      289.90, current_date + 5,  'pendente', null);

    insert into public.consultas (aluno_id, tipo, data, hora, status, observacoes) values
      (v_aluno, 'avaliacao',    current_date - 62, '09:00', 'concluida', 'Avaliação postural inicial.'),
      (v_aluno, 'fisioterapia', current_date - 20, '10:00', 'concluida', 'Sessão para dor lombar.'),
      (v_aluno, 'miofascial',   current_date + 7,  '18:30', 'agendada',  'Liberação pós-treino.');
  end if;

  -- Vendas: ~7 meses com tendência de crescimento (gráficos + previsão)
  insert into public.vendas (descricao, valor, categoria, data)
  select 'Recebimento avulso',
         round(((160 + random() * 380) * (1 + 0.5 * (210 - (current_date - d))::numeric / 210))::numeric, 2),
         (array['mensalidade','fisioterapia','miofascial','avaliacao','produtos'])[1 + floor(random() * 5)::int],
         d
  from (select (current_date - g)::date as d from generate_series(0, 210) g) dias
  cross join generate_series(1, 3) n
  where random() > 0.38;

  -- Despesas mensais recorrentes
  insert into public.despesas (descricao, valor, categoria, data)
  select t.descricao, t.valor, t.categoria, (m.m + (t.dia - 1) * interval '1 day')::date
  from (select date_trunc('month', current_date) - (interval '1 month' * g) as m
        from generate_series(0, 6) g) m
  cross join lateral (values
    ('Aluguel do estúdio',        4500.00::numeric,                            'fixas',      5),
    ('Folha de pagamento',        12800.00::numeric,                           'pessoal',    1),
    ('Energia e água',            round((480 + random() * 260)::numeric, 2),   'fixas',     10),
    ('Marketing digital',         round((700 + random() * 500)::numeric, 2),   'marketing', 15),
    ('Manutenção de equipamentos',round((200 + random() * 420)::numeric, 2),   'manutencao',20)
  ) as t(descricao, valor, categoria, dia)
  where (m.m + (t.dia - 1) * interval '1 day')::date <= current_date;

  -- Estoque (2 itens abaixo do mínimo p/ alerta visual)
  insert into public.produtos (nome, categoria, quantidade, estoque_minimo, preco) values
    ('Meia antiderrapante',      'acessorios', 34, 10, 39.90),
    ('Faixa elástica média',     'acessorios',  8, 10, 29.90),
    ('Bola overball 26cm',       'equipamentos', 15, 5, 45.00),
    ('Rolo de liberação',        'equipamentos',  3, 5, 89.90),
    ('Squeeze Renovar 600ml',    'loja', 22, 8, 34.90),
    ('Camiseta Renovar',         'loja', 41, 10, 69.90),
    ('Mola Reformer (reposição)','manutencao', 12, 4, 120.00),
    ('Óleo para miofascial',     'insumos', 6, 6, 55.00);

  -- Projetos + tarefas (Kanban)
  insert into public.projetos (nome, descricao, cor) values
    ('Campanha de Matrículas', 'Ações de marketing para o próximo trimestre.', '#FE5800')
    returning id into v_proj1;
  insert into public.projetos (nome, descricao, cor) values
    ('Reforma da Sala 2', 'Ampliação da sala de equipamentos e troca do piso.', '#2E6FED')
    returning id into v_proj2;
  insert into public.projetos (nome, descricao, cor) values
    ('Implantação do Sistema', 'Rollout do sistema interno para toda a equipe.', '#2E9E5B')
    returning id into v_proj3;

  insert into public.tarefas (projeto_id, titulo, descricao, coluna, posicao, responsavel_id, criado_por, prazo, checklist) values
    (v_proj1, 'Criar artes para redes sociais', 'Posts para Instagram e stories da campanha.', 'todo', 0, v_atend, v_gerente, now() + interval '5 days', '[{"t":"Definir mote","done":true},{"t":"3 posts feed","done":false},{"t":"5 stories","done":false}]'),
    (v_proj1, 'Negociar parceria com academias', 'Cross-selling com academias vizinhas.', 'doing', 0, v_gerente, v_admin, now() + interval '10 days', '[]'),
    (v_proj1, 'Landing page da promoção', 'Página com formulário de captação.', 'review', 0, v_gerente, v_gerente, now() + interval '2 days', '[{"t":"Copy","done":true},{"t":"Layout","done":true},{"t":"Publicar","done":false}]'),
    (v_proj1, 'Definir meta de matrículas', 'Meta trimestral aprovada pela diretoria.', 'done', 0, v_admin, v_admin, now() - interval '3 days', '[]'),
    (v_proj2, 'Orçamento de 3 fornecedores de piso', 'Piso vinílico apropriado para equipamentos.', 'doing', 1, v_atend, v_gerente, now() - interval '1 day', '[{"t":"Fornecedor A","done":true},{"t":"Fornecedor B","done":false},{"t":"Fornecedor C","done":false}]'),
    (v_proj2, 'Cronograma de obra sem fechar o estúdio', 'Planejar obra em etapas noturnas.', 'todo', 1, null, v_gerente, now() + interval '14 days', '[]'),
    (v_proj3, 'Cadastrar toda a equipe no sistema', 'Criar contas e definir cargos.', 'done', 1, v_admin, v_admin, now() - interval '7 days', '[]'),
    (v_proj3, 'Escrever manuais na Wiki', 'Documentar processos de atendimento e vendas.', 'doing', 2, v_atend, v_gerente, now() + interval '4 days', '[{"t":"Atendimento","done":true},{"t":"Vendas","done":false}]'),
    (v_proj3, 'Treinamento da equipe', 'Sessão de 2h com todos os colaboradores.', 'todo', 2, v_gerente, v_admin, now() + interval '9 days', '[]');

  -- Wiki
  insert into public.wiki_artigos (titulo, categoria, conteudo, autor_id) values
    ('Boas-vindas ao novo colaborador', 'RH', $w$## Bem-vindo(a) à Renovar!

Este guia resume seus primeiros passos:

- Solicite seu acesso ao sistema com o administrador
- Leia os manuais da categoria **Suporte** antes do primeiro atendimento
- Horário de funcionamento: seg–sex 6h às 21h, sábado 8h às 12h

### Cultura
Atendemos pessoas, não números. Cada aluno tem nome, história e objetivo.$w$, v_admin),
    ('Política de férias e folgas', 'RH', $w$## Regras gerais

1. Férias devem ser solicitadas com **60 dias** de antecedência
2. Folgas de sábado seguem escala mensal publicada no mural
3. Trocas de plantão precisam de aprovação do gerente$w$, v_admin),
    ('Como registrar uma venda no balcão', 'Vendas', $w$## Passo a passo

1. Abra o **Dashboard → Relatórios**
2. Registre a venda com categoria correta (produto, avaliação, mensalidade)
3. Conferência de caixa é feita às 20h30 todos os dias

> Dica: vendas com categoria errada distorcem os relatórios do gerente.$w$, v_gerente),
    ('Tabela de planos e valores', 'Vendas', $w$## Planos vigentes

- **Essencial** — 2x/semana — R$ 289,90
- **Performance** — 3x/semana — R$ 389,90
- **Livre** — ilimitado — R$ 449,90

Alunos Gympass/TotalPass fazem check-in pelo app do benefício e não pagam mensalidade direta.$w$, v_gerente),
    ('Script de atendimento WhatsApp', 'Suporte', $w$## Primeiro contato

Olá! 🧡 Bem-vindo(a) à Renovar Pilates & Fisioterapia. Como posso ajudar?

## Perguntas frequentes

- **Horários**: temos turmas das 6h às 21h — consulte a grade
- **Gympass/TotalPass**: basta reservar no app e fazer check-in na recepção
- **Fisioterapia**: atendimento individual particular, com recibo para reembolso

## Encerramento

Posso ajudar em algo mais? Sua avaliação é muito importante para nós!$w$, v_atend),
    ('Procedimento de check-in Gympass e TotalPass', 'Suporte', $w$## Check-in

1. Aluno apresenta o app com token ativo
2. Valide o token e registre a presença na planilha da turma
3. Problemas com token: oriente a atualizar o app e refazer o check-in

Vídeo de referência:
https://www.youtube.com/watch?v=ysz5S6PUM-U$w$, v_atend);

  -- histórico de versão de exemplo
  select id into v_art from public.wiki_artigos where titulo = 'Tabela de planos e valores';
  insert into public.wiki_versoes (artigo_id, titulo, conteudo, editor_id, criado_em)
  values (v_art, 'Tabela de planos e valores', '## Planos vigentes (desatualizado)

- Essencial — R$ 269,90
- Performance — R$ 359,90', v_gerente, now() - interval '40 days');

  -- Respostas rápidas do helpdesk
  insert into public.respostas_rapidas (atalho, texto) values
    ('/boasvindas', 'Olá! 🧡 Bem-vindo(a) à Renovar Pilates & Fisioterapia. Como posso ajudar você hoje?'),
    ('/horarios', 'Nosso funcionamento: segunda a sexta das 6h às 21h e sábados das 8h às 12h.'),
    ('/planos', 'Nossos planos: Essencial (2x/sem) R$ 289,90 · Performance (3x/sem) R$ 389,90 · Livre (ilimitado) R$ 449,90.'),
    ('/gympass', 'Aceitamos Gympass e TotalPass nas aulas em grupo! Basta reservar pelo app e fazer o check-in na recepção. 😉'),
    ('/encerramento', 'Fico à disposição! Se puder, avalie nosso atendimento na pesquisa que enviaremos. Até a próxima aula! 🙏');

  -- Tickets do helpdesk
  insert into public.tickets (cliente_nome, cliente_contato, canal, assunto, status, atendente_id, criado_em) values
    ('Paula Mendes',  '(11) 98811-2233', 'whatsapp', 'Dúvida sobre Gympass',            'aberto', null, now() - interval '25 minutes'),
    ('Carlos Nunes',  'carlos@email.com','email',    'Remarcar sessão de fisioterapia', 'aberto', null, now() - interval '2 hours'),
    ('Julia Prado',   '(11) 97722-3344', 'chat',     'Valores dos planos',              'em_atendimento', v_atend, now() - interval '1 day');
  insert into public.tickets (cliente_nome, cliente_contato, canal, assunto, status, atendente_id, nps, criado_em, encerrado_em) values
    ('Marcos Lima',   '(11) 96611-9090', 'whatsapp', 'Horário das turmas da manhã', 'resolvido', v_atend, 9,  now() - interval '3 days', now() - interval '3 days' + interval '32 minutes'),
    ('Renata Souza',  'renata@email.com','email',    'Recibo para reembolso do plano de saúde', 'resolvido', v_gerente, 10, now() - interval '6 days', now() - interval '5 days');

  select id into v_tk from public.tickets where cliente_nome = 'Paula Mendes';
  insert into public.ticket_mensagens (ticket_id, origem, texto, criado_em) values
    (v_tk, 'cliente', 'Oi! Vocês aceitam Gympass no plano básico? Como funciona o check-in?', now() - interval '25 minutes');

  select id into v_tk from public.tickets where cliente_nome = 'Carlos Nunes';
  insert into public.ticket_mensagens (ticket_id, origem, texto, criado_em) values
    (v_tk, 'cliente', 'Boa tarde, preciso remarcar minha sessão de quinta para sexta no mesmo horário. É possível?', now() - interval '2 hours');

  select id into v_tk from public.tickets where cliente_nome = 'Julia Prado';
  insert into public.ticket_mensagens (ticket_id, origem, autor_id, texto, criado_em) values
    (v_tk, 'cliente', null, 'Olá! Quais os valores dos planos de pilates?', now() - interval '1 day'),
    (v_tk, 'atendente', v_atend, 'Olá, Julia! Nossos planos: Essencial R$ 289,90 · Performance R$ 389,90 · Livre R$ 449,90. Quer agendar uma aula experimental?', now() - interval '23 hours'),
    (v_tk, 'cliente', null, 'Quero sim! Pode ser sábado?', now() - interval '20 hours');

  select id into v_tk from public.tickets where cliente_nome = 'Marcos Lima';
  insert into public.ticket_mensagens (ticket_id, origem, autor_id, texto, criado_em) values
    (v_tk, 'cliente', null, 'Quais os horários das turmas de manhã?', now() - interval '3 days'),
    (v_tk, 'atendente', v_atend, 'Bom dia, Marcos! Turmas às 6h, 7h, 8h e 9h30. Posso reservar um horário experimental?', now() - interval '3 days' + interval '10 minutes'),
    (v_tk, 'sistema', null, 'Pesquisa NPS enviada via WhatsApp. Resposta do cliente: 9/10.', now() - interval '3 days' + interval '32 minutes');

  raise notice 'seed aplicado com sucesso';
end $seed$;
