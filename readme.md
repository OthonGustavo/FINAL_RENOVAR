# Renovar · Pilates & Fisioterapia

Site institucional de alto padrão + **sistema interno completo** (área do aluno e
módulos de gestão), com autenticação, RBAC, 2FA, tema claro/escuro e animações.

## Sistema interno (`app.html`)
Após o login, o usuário é redirecionado para o sistema, com menu por cargo (RBAC):

| Módulo | Quem acessa | Destaques |
| --- | --- | --- |
| Meu painel / Consultas / Planos / Financeiro | aluno | CRUD de consultas, troca de plano, pagamento com baixa automática no fluxo de caixa em tempo real |
| Dashboard gerencial | gerente, admin | KPIs automáticos (dia/mês/ano), gráficos Chart.js, alerta de estoque mínimo, previsão de faturamento (regressão linear), atualização em tempo real |
| Relatórios | gerente, admin | filtros por período/categoria, exportação CSV (Excel) e PDF |
| Projetos & Tarefas | equipe | Kanban drag-and-drop, mover p/ "Revisão" auto-atribui ao gerente, checklist, anexos, comentários com @menções, cronômetro de prazo |
| Base de Conhecimento | equipe | busca full-text (índice `tsvector` português), editor markdown com prévia, embeds YouTube/Vimeo, histórico de versões com restauração |
| Atendimento (Helpdesk) | equipe | inbox omnichannel (WhatsApp/e-mail/chat), fila automática, respostas rápidas via `/atalho`, sugestão de resposta, NPS automático ao encerrar |
| Copilot | todos | painel lateral: busca na base de conhecimento, resumo de reuniões, análise/previsão financeira, rascunho de documentos |
| Configurações | todos | perfil, foto (Supabase Storage), preferências de notificação, **2FA TOTP** |
| Administração | admin | gestão de cargos (RBAC) — reforçada por RLS no banco |

### Contas de teste
| Cargo | E-mail | Senha |
| --- | --- | --- |
| Admin | `admin.renovar@example.com` | `Renovar2026!` |
| Gerente | `gerente.renovar@example.com` | `Renovar2026!` |
| Funcionário | `atendente.renovar@example.com` | `Renovar2026!` |
| Aluno | `aluno.teste.renovar@example.com` | `SenhaForte2026!` |

## Serviços apresentados
- **Pilates em grupo** — turmas de até 6 alunos, com check-in via **Gympass (Wellhub)** ou **TotalPass**
- **Fisioterapia Traumato-Ortopédica** — atendimento individual
- **Liberação Miofascial** — atendimento individual

## Stack
| Camada | Tecnologia | Licença |
| --- | --- | --- |
| Marcação/estilo | HTML + CSS puro (variáveis CSS para os temas) | — |
| Animações | [GSAP 3 + ScrollTrigger](https://gsap.com) | GSAP (gratuita) |
| Scroll suave | [Lenis](https://github.com/darkroomengineering/lenis) | MIT |
| Carrossel | [Splide](https://github.com/Splidejs/splide) | MIT |
| Gráficos | [Chart.js](https://www.chartjs.org) | MIT |
| Backend (auth + dados) | [Supabase](https://supabase.com) via [supabase-js](https://github.com/supabase/supabase-js) | MIT |
| Fontes | Fraunces + Manrope (Google Fonts) | OFL |

Cores principais: `#FE5800` (laranja da marca) + branco. Tema escuro incluído.

## Como rodar
O site é estático. Para tudo funcionar (auth usa redirecionamentos), sirva por HTTP:

```bash
npx serve -l 4173 .
# abra http://localhost:4173
```

## Supabase
- Configuração pública do cliente: [js/config.js](js/config.js) — usa a **publishable key**
  (segura para o navegador; o acesso real é controlado por RLS).
- Schema do site: [supabase/schema.sql](supabase/schema.sql) — `profiles` (perfil criado
  no cadastro via trigger) e `contact_messages` (formulário de contato).
- Schema do sistema interno: [supabase/schema_app.sql](supabase/schema_app.sql) — planos,
  assinaturas, consultas, financeiro, vendas/despesas, estoque, projetos/tarefas, wiki,
  helpdesk, notificações e storage. Todos com RLS por cargo.

### Segurança
- **Nunca** coloque a `service_role`/`sb_secret_...` no front-end. O `js/auth.js` tem uma
  trava que se recusa a inicializar se detectar chave secreta.
- O front usa apenas a publishable key; as permissões reais são aplicadas por RLS no banco.

## Estrutura
```
index.html              landing page + modal de login/registro
app.html                sistema interno (SPA com hash-routing)
css/style.css           design system da landing (temas, responsivo)
css/app.css             design system do sistema interno
js/config.js            URL + publishable key do Supabase
js/app.js               landing: tema, navegação, GSAP/Lenis/Splide
js/auth.js              login, registro, recuperação de senha, contato
js/app/core.js          sessão, 2FA, RBAC, roteador, sidebar, notificações
js/app/aluno.js         painel, consultas, planos, financeiro do aluno
js/app/dashboard.js     KPIs, gráficos, estoque, relatórios, previsão
js/app/projetos.js      Kanban drag-and-drop e detalhes de tarefa
js/app/wiki.js          base de conhecimento com busca e versões
js/app/atendimento.js   helpdesk omnichannel
js/app/ia.js            copilot lateral
js/app/admin.js         configurações e painel de administração
supabase/*.sql          schema, RLS, triggers e dados iniciais
```
