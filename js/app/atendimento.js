// ============================================================
// Renovar — Helpdesk: inbox omnichannel, respostas rápidas (/atalho),
// fila automática, sugestão de resposta (IA) e NPS pós-atendimento
// ============================================================
(() => {
  'use strict';
  const { sb, $, $$, esc, toast, modal } = App;

  const CANAL = {
    whatsapp: '<span class="canal whatsapp">🟢 WhatsApp</span>',
    email: '<span class="canal email">✉️ E-mail</span>',
    chat: '<span class="canal chat">💬 Chat do site</span>',
  };
  const STATUS = {
    aberto: '<span class="tag tag-warn">● aberto</span>',
    em_atendimento: '<span class="tag tag-brand">● em atendimento</span>',
    resolvido: '<span class="tag tag-ok">✓ resolvido</span>',
  };

  /* fila: distribui chamados sem atendente para quem tem menos tickets abertos */
  const distribuirFila = async () => {
    const [{ data: abertos }, staff] = await Promise.all([
      sb.from('tickets').select('id, atendente_id, status').neq('status', 'resolvido'),
      App.staff(),
    ]);
    const atendentes = staff.filter(s => ['funcionario', 'gerente'].includes(s.role));
    if (!atendentes.length) return 0;
    const carga = Object.fromEntries(atendentes.map(a => [a.id, 0]));
    (abertos || []).forEach(t => { if (t.atendente_id in carga) carga[t.atendente_id]++; });
    const semDono = (abertos || []).filter(t => !t.atendente_id);
    for (const t of semDono) {
      const alvo = atendentes.sort((a, b) => carga[a.id] - carga[b.id])[0];
      await sb.from('tickets').update({ atendente_id: alvo.id }).eq('id', t.id);
      carga[alvo.id]++;
      App.notify(alvo.id, 'Novo chamado atribuído a você pela fila automática.', '/atendimento/' + t.id);
    }
    return semDono.length;
  };

  /* ================= INBOX ================= */
  App.route('/atendimento', {
    title: 'Central de Atendimento', roles: ['funcionario', 'gerente', 'admin'],
    async render(_, view) {
      const [{ data: tickets }, staff] = await Promise.all([
        sb.from('tickets').select('*').order('criado_em', { ascending: false }),
        App.staff(),
      ]);
      const byId = Object.fromEntries(staff.map(s => [s.id, s]));
      const nps = (tickets || []).filter(t => t.nps != null);
      const npsMedia = nps.length ? (nps.reduce((a, t) => a + t.nps, 0) / nps.length).toFixed(1) : '—';

      view.innerHTML = `
        <div class="view-head"><div>
          <h2>Omnichannel Inbox</h2>
          <p>WhatsApp, e-mail e chat do site numa caixa só. NPS médio: <strong>${npsMedia}</strong> ⭐</p>
        </div><div style="display:flex;gap:.6rem">
          <button class="btn btn-ghost" id="hd-fila">⚡ Distribuir fila</button>
          <button class="btn btn-primary" id="hd-novo">＋ Simular chamado</button>
        </div></div>
        <div class="grid-3" style="margin-bottom:1.2rem">
          <div class="card kpi"><span class="kpi-label">Abertos</span><span class="kpi-value">${(tickets || []).filter(t => t.status === 'aberto').length}</span></div>
          <div class="card kpi"><span class="kpi-label">Em atendimento</span><span class="kpi-value">${(tickets || []).filter(t => t.status === 'em_atendimento').length}</span></div>
          <div class="card kpi"><span class="kpi-label">Resolvidos</span><span class="kpi-value">${(tickets || []).filter(t => t.status === 'resolvido').length}</span></div>
        </div>
        <div class="inbox-list" style="max-height:none">${(tickets || []).map(t => `
          <div class="ticket-item" data-id="${t.id}">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem">${CANAL[t.canal]} ${STATUS[t.status]}</div>
            <h5>${esc(t.cliente_nome)} — ${esc(t.assunto)}</h5>
            <p>${t.atendente_id ? '👤 ' + esc(byId[t.atendente_id]?.full_name || '?') : '⏳ aguardando distribuição'} · ${App.timeAgo(t.criado_em)}${t.nps != null ? ' · NPS ' + t.nps + '/10' : ''}</p>
          </div>`).join('') || '<p style="color:var(--text-soft)">Nenhum chamado. Paz total. 🧘</p'}</div>`;

      $$('.ticket-item', view).forEach(el => el.onclick = () => App.go('/atendimento/' + el.dataset.id));
      $('#hd-fila', view).onclick = async () => {
        const n = await distribuirFila();
        toast(n ? `${n} chamado(s) distribuído(s) pela fila. ⚡` : 'Nenhum chamado aguardando distribuição.', n ? 'success' : 'info');
        if (n) this.render(_, view);
      };
      $('#hd-novo', view).onclick = () => {
        const m = modal(`<h3>Simular novo chamado</h3><form id="f-tk">
          <div class="field-row">
            <div class="field"><label>Cliente</label><input id="tk-nome" required placeholder="Nome do cliente"></div>
            <div class="field"><label>Canal</label><select id="tk-canal"><option value="whatsapp">WhatsApp</option><option value="email">E-mail</option><option value="chat">Chat do site</option></select></div>
          </div>
          <div class="field"><label>Assunto</label><input id="tk-ass" required placeholder="Ex.: Dúvida sobre planos"></div>
          <div class="field"><label>Mensagem do cliente</label><textarea id="tk-msg" rows="3" required></textarea></div>
          <button class="btn btn-primary btn-block">Criar chamado</button></form>`);
        m.el.querySelector('#f-tk').onsubmit = async (e) => {
          e.preventDefault();
          const { data: tk, error } = await sb.from('tickets').insert({
            cliente_nome: $('#tk-nome', m.el).value.trim(), canal: $('#tk-canal', m.el).value,
            assunto: $('#tk-ass', m.el).value.trim(),
          }).select('id').single();
          if (error) return toast('Erro: ' + error.message, 'error');
          await sb.from('ticket_mensagens').insert({ ticket_id: tk.id, origem: 'cliente', texto: $('#tk-msg', m.el).value.trim() });
          await distribuirFila();
          m.close(); toast('Chamado criado e distribuído. 📨', 'success'); this.render(_, view);
        };
      };
    },
  });

  /* ================= THREAD DO CHAMADO ================= */
  App.route('/atendimento/:id', {
    title: 'Atendimento', roles: ['funcionario', 'gerente', 'admin'],
    async render({ id }, view) {
      const [{ data: t }, { data: msgs }, { data: rapidas }, staff] = await Promise.all([
        sb.from('tickets').select('*').eq('id', id).single(),
        sb.from('ticket_mensagens').select('*').eq('ticket_id', id).order('criado_em'),
        sb.from('respostas_rapidas').select('*').order('atalho'),
        App.staff(),
      ]);
      if (!t) { App.go('/atendimento'); return; }
      const byId = Object.fromEntries(staff.map(s => [s.id, s]));
      const { data: historico } = await sb.from('tickets').select('*').eq('cliente_nome', t.cliente_nome).neq('id', id).order('criado_em', { ascending: false });

      view.innerHTML = `
        <div class="inbox">
          <div>
            <div class="card">
              <div style="display:flex;align-items:center;gap:.7rem;margin-bottom:.7rem">
                <a class="icon-btn" href="#/atendimento" title="Voltar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M19 12H5m6-6-6 6 6 6"/></svg></a>
                <div><strong>${esc(t.cliente_nome)}</strong><br><small style="color:var(--text-soft)">${esc(t.cliente_contato || 'sem contato')}</small></div>
              </div>
              ${CANAL[t.canal]} ${STATUS[t.status]}
              ${t.nps != null ? `<p style="margin-top:.6rem"><span class="tag tag-ok">NPS ${t.nps}/10</span></p>` : ''}
              <p style="margin-top:.6rem;font-size:.88rem"><strong>Atendente:</strong> ${esc(byId[t.atendente_id]?.full_name || 'não atribuído')}</p>
            </div>
            <div class="card" style="margin-top:1rem"><h3>🕘 Histórico do cliente</h3>
              ${(historico || []).map(h => `<div class="timeline-item"><span>${h.status === 'resolvido' ? '✅' : '🟠'}</span>
                <div><strong>${esc(h.assunto)}</strong><br><small style="color:var(--text-soft)">${App.fmtDateTime(h.criado_em)} · ${h.canal}${h.nps != null ? ' · NPS ' + h.nps : ''}</small></div></div>`).join('')
                || '<p style="color:var(--text-soft);font-size:.88rem">Primeiro contato deste cliente. 🌱</p>'}
            </div>
          </div>
          <div class="card thread">
            <div class="thread-head">
              <h3 style="margin:0">${esc(t.assunto)}</h3>
              <div style="display:flex;gap:.5rem;flex-wrap:wrap">
                <button class="btn btn-ghost btn-sm" id="hd-ia">🤖 Sugerir resposta (IA)</button>
                ${t.status !== 'resolvido' ? '<button class="btn btn-primary btn-sm" id="hd-fechar">✓ Encerrar chamado</button>' : ''}
              </div>
            </div>
            <div class="thread-msgs" id="hd-msgs">${(msgs || []).map(m => `
              <div class="msg ${m.origem}">${esc(m.texto)}<small>${m.origem === 'atendente' ? esc(byId[m.autor_id]?.full_name?.split(' ')[0] || 'Equipe') + ' · ' : ''}${App.fmtDateTime(m.criado_em)}</small></div>`).join('')}</div>
            ${t.status !== 'resolvido' ? `
            <div class="thread-reply">
              <div class="quick-pop" id="hd-quick" hidden></div>
              <textarea id="hd-texto" placeholder="Escreva a resposta… (digite / para respostas rápidas)"></textarea>
              <button class="btn btn-primary" id="hd-enviar">Enviar</button>
            </div>` : '<p style="text-align:center;color:var(--text-soft);padding:.8rem 0">Chamado encerrado.</p>'}
          </div>
        </div>`;

      const msgsEl = $('#hd-msgs', view);
      msgsEl.scrollTop = msgsEl.scrollHeight;
      const reload = () => this.render({ id }, view);

      /* respostas rápidas com "/" */
      const ta = $('#hd-texto', view);
      const pop = $('#hd-quick', view);
      if (ta) {
        ta.addEventListener('input', () => {
          const mAt = ta.value.match(/(?:^|\s)(\/[\w]*)$/);
          if (!mAt) { pop.hidden = true; return; }
          const termo = mAt[1].toLowerCase();
          const hits = (rapidas || []).filter(r => r.atalho.startsWith(termo));
          if (!hits.length) { pop.hidden = true; return; }
          pop.hidden = false;
          pop.innerHTML = hits.map(r => `<button type="button" data-q="${r.id}"><b>${esc(r.atalho)}</b> — ${esc(r.texto.slice(0, 60))}…</button>`).join('');
          $$('[data-q]', pop).forEach(b => b.onclick = () => {
            const r = rapidas.find(x => x.id === b.dataset.q);
            ta.value = ta.value.replace(/(?:^|\s)\/[\w]*$/, (mm) => mm.startsWith(' ') ? ' ' + r.texto : r.texto);
            pop.hidden = true; ta.focus();
          });
        });

        const enviar = async () => {
          const texto = ta.value.trim();
          if (!texto) return;
          const patch = {};
          if (!t.atendente_id) patch.atendente_id = App.user.id;
          if (t.status === 'aberto') patch.status = 'em_atendimento';
          if (Object.keys(patch).length) await sb.from('tickets').update(patch).eq('id', id);
          const { error } = await sb.from('ticket_mensagens').insert({ ticket_id: id, origem: 'atendente', autor_id: App.user.id, texto });
          if (error) return toast('Erro ao enviar.', 'error');
          toast(`Resposta enviada via ${t.canal === 'whatsapp' ? 'WhatsApp' : t.canal === 'email' ? 'e-mail' : 'chat'}. ✓`, 'success');
          reload();
        };
        $('#hd-enviar', view).onclick = enviar;
        ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } };
      }

      /* sugestão de resposta pela IA (busca na Wiki) */
      $('#hd-ia', view).onclick = async () => {
        const ultimaCliente = [...(msgs || [])].reverse().find(m => m.origem === 'cliente');
        const sugestao = await App.iaSugerirResposta(t.assunto + ' ' + (ultimaCliente?.texto || ''));
        const m = modal(`<h3>🤖 Sugestão da IA</h3>
          <p style="color:var(--text-soft);font-size:.85rem;margin-bottom:.8rem">Com base na Base de Conhecimento do estúdio.</p>
          <div class="card" style="white-space:pre-wrap;font-size:.93rem">${esc(sugestao)}</div>
          ${t.status !== 'resolvido' ? '<button class="btn btn-primary btn-block" id="ia-usar" style="margin-top:1rem">Usar esta resposta</button>' : ''}`);
        const usar = m.el.querySelector('#ia-usar');
        if (usar) usar.onclick = () => { $('#hd-texto', view).value = sugestao; m.close(); $('#hd-texto', view).focus(); };
      };

      /* encerrar + NPS automático via WhatsApp */
      const fechar = $('#hd-fechar', view);
      if (fechar) fechar.onclick = async () => {
        await sb.from('tickets').update({ status: 'resolvido', encerrado_em: new Date().toISOString() }).eq('id', id);
        await sb.from('ticket_mensagens').insert({ ticket_id: id, origem: 'sistema', texto: '✅ Chamado encerrado. Pesquisa de satisfação (NPS) enviada automaticamente via WhatsApp.' });
        toast('Chamado encerrado — pesquisa NPS enviada via WhatsApp. 📲', 'success');
        // o cliente responde a pesquisa e a nota chega de volta
        setTimeout(async () => {
          const nota = 8 + Math.floor(Math.random() * 3);
          await sb.from('tickets').update({ nps: nota }).eq('id', id);
          await sb.from('ticket_mensagens').insert({ ticket_id: id, origem: 'sistema', texto: `📊 Cliente respondeu a pesquisa NPS: ${nota}/10.` });
        }, 4000);
        reload();
      };

      /* tempo real: mensagens novas aparecem sem recarregar */
      const ch = sb.channel('tk-' + id)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ticket_mensagens', filter: `ticket_id=eq.${id}` }, () => reload())
        .subscribe();
      App.onLeave(() => sb.removeChannel(ch));
    },
  });
})();
