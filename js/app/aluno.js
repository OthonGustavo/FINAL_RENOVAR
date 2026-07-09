// ============================================================
// Renovar — Área do aluno: painel, consultas (CRUD), planos e financeiro
// ============================================================
(() => {
  'use strict';
  const { sb, $, $$, esc, money, fmtDate, toast, modal, confirm: confirmDlg } = App;

  const TIPO = { fisioterapia: 'Fisioterapia Traumato-Ortopédica', miofascial: 'Liberação Miofascial', avaliacao: 'Avaliação física' };
  const ST = {
    agendada: '<span class="tag tag-brand">● Agendada</span>',
    concluida: '<span class="tag tag-ok">✓ Concluída</span>',
    cancelada: '<span class="tag tag-muted">✕ Cancelada</span>',
    pago: '<span class="tag tag-ok">✓ Pago</span>',
    pendente: '<span class="tag tag-warn">⏳ Pendente</span>',
    atrasado: '<span class="tag tag-danger">! Atrasado</span>',
  };

  /* ================= MEU PAINEL ================= */
  App.route('/perfil', {
    title: 'Meu painel', roles: ['aluno'],
    async render(_, view) {
      const uid = App.user.id;
      const [{ data: consultas }, { data: fin }, { data: assin }] = await Promise.all([
        sb.from('consultas').select('*').eq('aluno_id', uid).eq('status', 'agendada').gte('data', new Date().toISOString().slice(0, 10)).order('data').limit(3),
        sb.from('financeiro_aluno').select('*').eq('aluno_id', uid).neq('status', 'pago').order('vencimento').limit(3),
        sb.from('assinaturas').select('*, planos(*)').eq('aluno_id', uid).eq('status', 'ativa').limit(1),
      ]);
      const plano = assin?.[0]?.planos;
      const nome = (App.profile.full_name || 'Aluno').split(' ')[0];

      view.innerHTML = `
        <div class="view-head"><div>
          <h2>Olá, ${esc(nome)}! 🧡</h2>
          <p>Bom te ver por aqui. Esse é o resumo da sua jornada na Renovar.</p>
        </div></div>
        <div class="grid-3">
          <div class="card kpi">
            <span class="kpi-label">Plano atual</span>
            <span class="kpi-value">${plano ? esc(plano.nome) : '—'}</span>
            <span class="kpi-delta flat">${plano ? plano.aulas_semana >= 7 ? 'aulas ilimitadas' : plano.aulas_semana + 'x por semana' : 'nenhum plano ativo'}</span>
          </div>
          <div class="card kpi">
            <span class="kpi-label">Próxima consulta</span>
            <span class="kpi-value" style="font-size:1.3rem">${consultas?.[0] ? fmtDate(consultas[0].data) + ' · ' + consultas[0].hora.slice(0, 5) : 'Nada marcado'}</span>
            <span class="kpi-delta flat">${consultas?.[0] ? esc(TIPO[consultas[0].tipo]) : 'agende quando quiser'}</span>
          </div>
          <div class="card kpi">
            <span class="kpi-label">Pagamentos em aberto</span>
            <span class="kpi-value">${fin?.length || 0}</span>
            <span class="kpi-delta ${fin?.length ? 'down' : 'up'}">${fin?.length ? '▼ ' + money(fin.reduce((a, f) => a + Number(f.valor), 0)) : '▲ tudo em dia'}</span>
          </div>
        </div>
        <div class="card" style="margin-top:1.2rem">
          <h3>Atalhos</h3>
          <div style="display:flex;gap:.7rem;flex-wrap:wrap">
            <a class="btn btn-primary" href="#/consultas">＋ Agendar consulta</a>
            <a class="btn btn-ghost" href="#/planos">Ver planos</a>
            <a class="btn btn-ghost" href="#/financeiro">Meu financeiro</a>
            <a class="btn btn-ghost" href="index.html">← Voltar ao site</a>
          </div>
        </div>`;
    },
  });

  /* ================= CONSULTAS (CRUD) ================= */
  const consultaForm = (c = {}) => `
    <h3>${c.id ? 'Editar consulta' : 'Agendar consulta'}</h3>
    <form id="f-consulta">
      <div class="field"><label>Tipo de atendimento</label>
        <select id="c-tipo" required>
          ${Object.entries(TIPO).map(([v, l]) => `<option value="${v}" ${c.tipo === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></div>
      <div class="field-row">
        <div class="field"><label>Data</label><input type="date" id="c-data" required value="${c.data || ''}" min="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="field"><label>Horário</label><input type="time" id="c-hora" required value="${c.hora ? c.hora.slice(0, 5) : ''}" min="06:00" max="21:00" step="1800"></div>
      </div>
      <div class="field"><label>Observações <small>(opcional)</small></label>
        <textarea id="c-obs" rows="3" placeholder="Alguma dor, preferência ou detalhe importante?">${esc(c.observacoes || '')}</textarea></div>
      <button class="btn btn-primary btn-block">${c.id ? 'Salvar alterações' : 'Confirmar agendamento'}</button>
    </form>`;

  const openConsulta = (c, onDone) => {
    const m = modal(consultaForm(c));
    m.el.querySelector('#f-consulta').onsubmit = async (e) => {
      e.preventDefault();
      const payload = {
        aluno_id: App.user.id,
        tipo: m.el.querySelector('#c-tipo').value,
        data: m.el.querySelector('#c-data').value,
        hora: m.el.querySelector('#c-hora').value,
        observacoes: m.el.querySelector('#c-obs').value.trim(),
      };
      const { error } = c.id
        ? await sb.from('consultas').update(payload).eq('id', c.id)
        : await sb.from('consultas').insert(payload);
      if (error) {
        toast(error.code === '23505' ? 'Você já tem uma consulta agendada nesse horário.' : 'Não foi possível salvar. ' + error.message, 'error');
        return;
      }
      m.close();
      toast(c.id ? 'Consulta atualizada! ✓' : 'Consulta agendada! Te esperamos no estúdio. 🧡', 'success');
      onDone();
    };
  };

  App.route('/consultas', {
    title: 'Minhas consultas', roles: ['aluno'],
    async render(_, view) {
      const { data: rows } = await sb.from('consultas').select('*').eq('aluno_id', App.user.id).order('data', { ascending: false }).order('hora');
      view.innerHTML = `
        <div class="view-head"><div>
          <h2>Minhas consultas</h2>
          <p>Agende, edite ou cancele seus atendimentos individuais.</p>
        </div><button class="btn btn-primary" id="nova">＋ Agendar consulta</button></div>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>Tipo</th><th>Data</th><th>Hora</th><th>Status</th><th>Observações</th><th class="num">Ações</th></tr></thead>
          <tbody>${(rows || []).map(c => `<tr>
            <td><strong>${esc(TIPO[c.tipo])}</strong></td>
            <td>${fmtDate(c.data)}</td><td>${c.hora.slice(0, 5)}</td>
            <td>${ST[c.status]}</td>
            <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.observacoes) || '—'}</td>
            <td class="num">${c.status === 'agendada' ? `
              <button class="btn btn-ghost btn-sm" data-edit="${c.id}">Editar</button>
              <button class="btn btn-danger btn-sm" data-del="${c.id}">Cancelar</button>` : '—'}</td>
          </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text-soft);padding:2rem">Nenhuma consulta ainda. Que tal agendar a primeira?</td></tr>'}</tbody>
        </table></div>`;

      const reload = () => this.render(_, view);
      view.querySelector('#nova').onclick = () => openConsulta({}, reload);
      $$('[data-edit]', view).forEach(b => b.onclick = () => openConsulta(rows.find(c => c.id === b.dataset.edit), reload));
      $$('[data-del]', view).forEach(b => b.onclick = async () => {
        if (!await confirmDlg('Cancelar esta consulta? O horário será liberado para outros alunos.')) return;
        const { error } = await sb.from('consultas').update({ status: 'cancelada' }).eq('id', b.dataset.del);
        if (error) return toast('Não foi possível cancelar.', 'error');
        toast('Consulta cancelada.', 'success');
        reload();
      });
    },
  });

  /* ================= PLANOS ================= */
  App.route('/planos', {
    title: 'Planos', roles: ['aluno'],
    async render(_, view) {
      const [{ data: planos }, { data: assin }] = await Promise.all([
        sb.from('planos').select('*').eq('ativo', true).order('preco'),
        sb.from('assinaturas').select('*').eq('aluno_id', App.user.id).eq('status', 'ativa'),
      ]);
      const atualId = assin?.[0]?.plano_id;
      view.innerHTML = `
        <div class="view-head"><div>
          <h2>Planos disponíveis</h2>
          <p>Alunos Gympass e TotalPass fazem check-in pelo app do benefício — sem mensalidade direta.</p>
        </div></div>
        <div class="grid-3">${(planos || []).map(p => `
          <div class="card" style="display:flex;flex-direction:column;gap:.5rem;${p.id === atualId ? 'border-color:var(--brand);box-shadow:var(--shadow)' : ''}">
            ${p.id === atualId ? '<span class="tag tag-brand" style="width:fit-content">Seu plano atual</span>' : ''}
            <h3 style="font-family:var(--font-display);font-weight:500;font-size:1.5rem;margin:0">${esc(p.nome)}</h3>
            <div><span style="font-family:var(--font-display);font-size:2rem;color:var(--brand)">${money(p.preco)}</span><span style="color:var(--text-soft)">/mês</span></div>
            <p style="color:var(--text-soft);font-size:.92rem;flex:1">${esc(p.descricao)}</p>
            <span class="tag tag-muted" style="width:fit-content">${p.aulas_semana >= 7 ? 'Aulas ilimitadas' : p.aulas_semana + 'x por semana'}</span>
            ${p.id === atualId
              ? '<button class="btn btn-ghost btn-block" disabled>Plano ativo ✓</button>'
              : `<button class="btn btn-primary btn-block" data-plano="${p.id}" data-nome="${esc(p.nome)}">Quero este plano</button>`}
          </div>`).join('')}</div>
        <p style="margin-top:1.2rem;color:var(--text-soft);font-size:.88rem">A troca de plano passa pela recepção para ajuste de cobrança — ao solicitar, nossa equipe confirma com você.</p>`;

      $$('[data-plano]', view).forEach(b => b.onclick = async () => {
        if (!await confirmDlg(`Solicitar mudança para o plano ${b.dataset.nome}?`)) return;
        if (assin?.[0]) await sb.from('assinaturas').update({ status: 'cancelada' }).eq('id', assin[0].id);
        const { error } = await sb.from('assinaturas').insert({ aluno_id: App.user.id, plano_id: b.dataset.plano });
        if (error) return toast('Não foi possível solicitar.', 'error');
        toast('Solicitação enviada! Nossa equipe confirma em breve. 🧡', 'success');
        const staff = await App.staff();
        const gerente = staff.find(s => s.role === 'gerente') || staff[0];
        if (gerente) App.notify(gerente.id, `${App.profile.full_name} solicitou o plano ${b.dataset.nome}.`, '/dashboard');
        this.render(_, view);
      });
    },
  });

  /* ================= FINANCEIRO ================= */
  App.route('/financeiro', {
    title: 'Meu financeiro', roles: ['aluno'],
    async render(_, view) {
      const { data: rows } = await sb.from('financeiro_aluno').select('*').eq('aluno_id', App.user.id).order('vencimento', { ascending: false });
      const aberto = (rows || []).filter(r => r.status !== 'pago');
      const pago = (rows || []).filter(r => r.status === 'pago');
      view.innerHTML = `
        <div class="view-head"><div>
          <h2>Meu financeiro</h2>
          <p>Mensalidades e atendimentos avulsos, tudo num lugar só.</p>
        </div></div>
        <div class="grid-2" style="margin-bottom:1.2rem">
          <div class="card kpi">
            <span class="kpi-label">Em aberto</span>
            <span class="kpi-value">${money(aberto.reduce((a, r) => a + Number(r.valor), 0))}</span>
            <span class="kpi-delta ${aberto.length ? 'down' : 'up'}">${aberto.length ? aberto.length + ' cobrança(s)' : '▲ tudo em dia 🎉'}</span>
          </div>
          <div class="card kpi">
            <span class="kpi-label">Total já investido em você</span>
            <span class="kpi-value">${money(pago.reduce((a, r) => a + Number(r.valor), 0))}</span>
            <span class="kpi-delta flat">${pago.length} pagamento(s)</span>
          </div>
        </div>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>Descrição</th><th>Vencimento</th><th class="num">Valor</th><th>Status</th><th class="num">Ação</th></tr></thead>
          <tbody>${(rows || []).map(r => `<tr>
            <td><strong>${esc(r.descricao)}</strong></td>
            <td>${fmtDate(r.vencimento)}</td>
            <td class="num">${money(r.valor)}</td>
            <td>${ST[r.status]}</td>
            <td class="num">${r.status !== 'pago' ? `<button class="btn btn-primary btn-sm" data-pay="${r.id}">Pagar agora</button>` : fmtDate(r.pago_em)}</td>
          </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-soft);padding:2rem">Nenhum lançamento por enquanto.</td></tr>'}</tbody>
        </table></div>
        <p style="margin-top:1rem;color:var(--text-soft);font-size:.85rem">💳 Pagamento processado com segurança. A confirmação cai em tempo real no fluxo de caixa do estúdio.</p>`;

      $$('[data-pay]', view).forEach(b => b.onclick = async () => {
        const row = rows.find(r => r.id === b.dataset.pay);
        if (!await confirmDlg(`Confirmar pagamento de ${money(row.valor)} (${row.descricao})?`)) return;
        const { error } = await sb.from('financeiro_aluno').update({ status: 'pago' }).eq('id', row.id);
        if (error) return toast('Pagamento não processado.', 'error');
        toast('Pagamento confirmado! Recibo disponível com a recepção. 🧡', 'success');
        this.render(_, view);
      });
    },
  });
})();
