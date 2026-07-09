// ============================================================
// Renovar — Projetos & Tarefas: Kanban drag-and-drop, modal de
// tarefa (checklist, anexos, comentários), prazos e auto-atribuição
// ============================================================
(() => {
  'use strict';
  const { sb, $, $$, esc, toast, modal, confirm: confirmDlg } = App;

  const COLS = [
    ['todo', 'A Fazer', '#8a8078'],
    ['doing', 'Em Andamento', '#2e6fed'],
    ['review', 'Revisão', '#b97a0a'],
    ['done', 'Concluído', '#2e9e5b'],
  ];

  const deadlineBadge = (prazo, coluna) => {
    if (!prazo) return '';
    const diff = new Date(prazo).getTime() - Date.now();
    if (coluna === 'done') return `<span class="deadline">✓ entregue</span>`;
    const abs = Math.abs(diff);
    const d = Math.floor(abs / 864e5), h = Math.floor((abs % 864e5) / 36e5), m = Math.floor((abs % 36e5) / 6e4);
    const txt = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}min` : `${m}min`;
    if (diff < 0) return `<span class="deadline late">⏰ atrasada ${txt}</span>`;
    if (diff < 48 * 36e5) return `<span class="deadline soon">⏳ faltam ${txt}</span>`;
    return `<span class="deadline">📅 ${txt}</span>`;
  };

  /* ================= LISTA DE PROJETOS ================= */
  App.route('/projetos', {
    title: 'Projetos & Tarefas', roles: ['funcionario', 'gerente', 'admin'],
    async render(_, view) {
      const [{ data: projetos }, { data: tarefas }] = await Promise.all([
        sb.from('projetos').select('*').eq('status', 'ativo').order('created_at'),
        sb.from('tarefas').select('id, projeto_id, coluna'),
      ]);
      const podeGerir = ['gerente', 'admin'].includes(App.role);
      view.innerHTML = `
        <div class="view-head"><div>
          <h2>Projetos ativos</h2><p>Clique num projeto para abrir o quadro Kanban.</p>
        </div>${podeGerir ? '<button class="btn btn-primary" id="novo-proj">＋ Novo projeto</button>' : ''}</div>
        <div class="grid-3">${(projetos || []).map(p => {
          const ts = (tarefas || []).filter(t => t.projeto_id === p.id);
          const done = ts.filter(t => t.coluna === 'done').length;
          const pct = ts.length ? Math.round(done / ts.length * 100) : 0;
          return `<div class="card proj-card" data-open="${p.id}">
            <div style="display:flex;align-items:center;gap:.7rem">
              <span class="proj-color" style="background:${esc(p.cor)}">${esc(p.nome[0])}</span>
              <h3 style="margin:0;flex:1">${esc(p.nome)}</h3>
            </div>
            <p style="color:var(--text-soft);font-size:.9rem">${esc(p.descricao)}</p>
            <div class="kb-meta"><span class="tag tag-muted">${ts.length} tarefa(s)</span><span class="tag tag-ok">${done} concluída(s)</span>
              <div class="progress-mini"><span style="width:${pct}%"></span></div></div>
          </div>`;
        }).join('') || '<p style="color:var(--text-soft)">Nenhum projeto ativo.</p>'}</div>`;

      $$('[data-open]', view).forEach(c => c.onclick = () => App.go('/projetos/' + c.dataset.open));
      if (podeGerir) $('#novo-proj').onclick = () => {
        const m = modal(`<h3>Novo projeto</h3><form id="f-proj">
          <div class="field"><label>Nome</label><input id="p-nome" required maxlength="80"></div>
          <div class="field"><label>Descrição</label><textarea id="p-desc" rows="2"></textarea></div>
          <div class="field"><label>Cor</label><input type="color" id="p-cor" value="#FE5800" style="height:46px;padding:.3rem"></div>
          <button class="btn btn-primary btn-block">Criar projeto</button></form>`);
        m.el.querySelector('#f-proj').onsubmit = async (e) => {
          e.preventDefault();
          const { error } = await sb.from('projetos').insert({ nome: $('#p-nome', m.el).value.trim(), descricao: $('#p-desc', m.el).value.trim(), cor: $('#p-cor', m.el).value });
          if (error) return toast('Erro ao criar.', 'error');
          m.close(); toast('Projeto criado! 🚀', 'success'); this.render(_, view);
        };
      };
    },
  });

  /* ================= QUADRO KANBAN ================= */
  App.route('/projetos/:id', {
    title: 'Quadro Kanban', roles: ['funcionario', 'gerente', 'admin'],
    async render({ id }, view) {
      const [{ data: proj }, { data: tarefas }, staff] = await Promise.all([
        sb.from('projetos').select('*').eq('id', id).single(),
        sb.from('tarefas').select('*').eq('projeto_id', id).order('posicao'),
        App.staff(),
      ]);
      if (!proj) { App.go('/projetos'); return; }
      const byId = Object.fromEntries(staff.map(s => [s.id, s]));

      const cardHtml = (t) => {
        const resp = byId[t.responsavel_id];
        const chk = t.checklist || [];
        const doneChk = chk.filter(c => c.done).length;
        return `<div class="kb-card" draggable="true" data-task="${t.id}">
          <h5>${esc(t.titulo)}</h5>
          <div class="kb-meta">
            ${resp ? `<span class="kb-avatar" title="${esc(resp.full_name)}">${resp.avatar_url ? `<img src="${esc(resp.avatar_url)}" alt="">` : esc(App.initials(resp.full_name))}</span>` : '<span class="kb-avatar" style="background:var(--line);color:var(--text-soft)" title="Sem responsável">?</span>'}
            ${deadlineBadge(t.prazo, t.coluna)}
            ${chk.length ? `<span class="tag tag-muted">☑ ${doneChk}/${chk.length}</span>` : ''}
          </div>
        </div>`;
      };

      view.innerHTML = `
        <div class="view-head"><div style="display:flex;align-items:center;gap:.7rem">
          <a class="icon-btn" href="#/projetos" title="Voltar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M19 12H5m6-6-6 6 6 6"/></svg></a>
          <div><h2 style="display:flex;align-items:center;gap:.55rem"><span class="proj-color" style="background:${esc(proj.cor)};width:26px;height:26px;border-radius:8px;font-size:.8rem">${esc(proj.nome[0])}</span>${esc(proj.nome)}</h2>
          <p>Arraste os cards entre as colunas. Mover para <strong>Revisão</strong> atribui automaticamente ao gerente.</p></div>
        </div><button class="btn btn-primary" id="nova-tarefa">＋ Nova tarefa</button></div>
        <div class="kanban">${COLS.map(([key, label, cor]) => `
          <div class="kb-col" data-col="${key}">
            <div class="kb-col-head"><h4><span class="kb-dot" style="background:${cor}"></span>${label}</h4>
            <span class="kb-count">${(tarefas || []).filter(t => t.coluna === key).length}</span></div>
            <div class="kb-cards" data-col="${key}">${(tarefas || []).filter(t => t.coluna === key).map(cardHtml).join('')}</div>
          </div>`).join('')}</div>`;

      const reload = () => this.render({ id }, view);

      /* ----- drag & drop ----- */
      let dragId = null;
      $$('.kb-card', view).forEach(card => {
        card.addEventListener('dragstart', () => { dragId = card.dataset.task; card.classList.add('dragging'); });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
        card.addEventListener('click', () => openTask(tarefas.find(t => t.id === card.dataset.task)));
      });
      $$('.kb-col', view).forEach(col => {
        col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop-hover'); });
        col.addEventListener('dragleave', () => col.classList.remove('drop-hover'));
        col.addEventListener('drop', async (e) => {
          e.preventDefault(); col.classList.remove('drop-hover');
          const novaCol = col.dataset.col;
          const t = tarefas.find(x => x.id === dragId);
          if (!t || t.coluna === novaCol) return;
          const patch = { coluna: novaCol };
          // automação: mover p/ Revisão atribui ao gerente e notifica
          if (novaCol === 'review') {
            const gerente = staff.find(s => s.role === 'gerente') || staff.find(s => s.role === 'admin');
            if (gerente) {
              patch.responsavel_id = gerente.id;
              App.notify(gerente.id, `Tarefa "${t.titulo}" entrou em Revisão e foi atribuída a você.`, `/projetos/${id}`);
            }
          }
          const { error } = await sb.from('tarefas').update(patch).eq('id', t.id);
          if (error) return toast('Não foi possível mover.', 'error');
          if (t.responsavel_id && novaCol !== 'review') App.notify(t.responsavel_id, `A tarefa "${t.titulo}" mudou para ${COLS.find(c => c[0] === novaCol)[1]}.`, `/projetos/${id}`);
          if (novaCol === 'review') toast('Movida para Revisão — gerente atribuído automaticamente. 🤝', 'success');
          reload();
        });
      });

      /* ----- modal de tarefa ----- */
      const staffOptions = (sel) => '<option value="">— sem responsável —</option>' + staff.map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.full_name)} (${s.role})</option>`).join('');

      const openTask = async (t) => {
        const isNew = !t;
        t = t || { titulo: '', descricao: '', coluna: 'todo', checklist: [], responsavel_id: null, prazo: null };
        const [{ data: comentarios }, { data: anexos }] = isNew ? [{ data: [] }, { data: [] }] : await Promise.all([
          sb.from('tarefa_comentarios').select('*').eq('tarefa_id', t.id).order('created_at'),
          sb.from('tarefa_anexos').select('*').eq('tarefa_id', t.id).order('criado_em'),
        ]);
        const prazoLocal = t.prazo ? new Date(new Date(t.prazo).getTime() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : '';

        const m = modal(`
          <h3>${isNew ? 'Nova tarefa' : 'Detalhes da tarefa'}</h3>
          <div class="field"><label>Título</label><input id="t-titulo" value="${esc(t.titulo)}" maxlength="120"></div>
          <div class="field"><label>Descrição</label><textarea id="t-desc" rows="3">${esc(t.descricao)}</textarea></div>
          <div class="field-row">
            <div class="field"><label>Responsável</label><select id="t-resp">${staffOptions(t.responsavel_id)}</select></div>
            <div class="field"><label>Entrega (deadline)</label><input type="datetime-local" id="t-prazo" value="${prazoLocal}"></div>
          </div>
          <div class="field"><label>Checklist</label>
            <div class="check-list" id="t-check">${(t.checklist || []).map((c, i) => `
              <label class="check-item ${c.done ? 'done' : ''}"><input type="checkbox" data-i="${i}" ${c.done ? 'checked' : ''}><span>${esc(c.t)}</span><button type="button" class="rm" data-rm="${i}">×</button></label>`).join('')}</div>
            <div style="display:flex;gap:.5rem;margin-top:.45rem"><input id="t-check-new" placeholder="Novo item…" style="flex:1;font:inherit;font-size:.9rem;padding:.5rem .8rem;border-radius:10px;border:1.5px solid var(--line);background:var(--surface);color:var(--text)"><button type="button" class="btn btn-ghost btn-sm" id="t-check-add">Adicionar</button></div>
          </div>
          ${isNew ? '' : `
          <div class="field"><label>Anexos</label>
            <div id="t-anexos" style="display:flex;flex-direction:column;gap:.35rem">${(anexos || []).map(a => `<a class="file-dl" href="${esc(a.url)}" target="_blank" rel="noopener">📎 ${esc(a.nome)}</a>`).join('') || '<small style="color:var(--text-soft)">Nenhum anexo.</small>'}</div>
            <input type="file" id="t-file" style="margin-top:.5rem;font-size:.85rem">
          </div>
          <div class="field"><label>Comentários <small>(use @nome para mencionar e notificar)</small></label>
            <div id="t-coments">${(comentarios || []).map(c => {
              const a = byId[c.autor_id];
              return `<div class="comment"><span class="kb-avatar">${esc(App.initials(a?.full_name || '?'))}</span>
                <div class="comment-body"><strong>${esc(a?.full_name || 'Alguém')}</strong><small>${App.timeAgo(c.created_at)}</small>
                <p>${esc(c.texto).replace(/@(\w+)/g, '<span class="mention">@$1</span>')}</p></div></div>`;
            }).join('') || '<small style="color:var(--text-soft)">Sem comentários ainda.</small>'}</div>
            <div style="display:flex;gap:.5rem;margin-top:.5rem"><input id="t-com-new" placeholder="Escreva um comentário… (@gabriela para mencionar)" style="flex:1;font:inherit;font-size:.9rem;padding:.55rem .8rem;border-radius:10px;border:1.5px solid var(--line);background:var(--surface);color:var(--text)"><button type="button" class="btn btn-primary btn-sm" id="t-com-add">Enviar</button></div>
          </div>`}
          <div style="display:flex;gap:.6rem;justify-content:space-between;margin-top:1rem">
            ${isNew ? '<span></span>' : '<button class="btn btn-danger btn-sm" id="t-del">Excluir tarefa</button>'}
            <button class="btn btn-primary" id="t-save">${isNew ? 'Criar tarefa' : 'Salvar'}</button>
          </div>`, { wide: true });

        let checklist = structuredClone(t.checklist || []);
        const redrawCheck = () => {
          $('#t-check', m.el).innerHTML = checklist.map((c, i) => `
            <label class="check-item ${c.done ? 'done' : ''}"><input type="checkbox" data-i="${i}" ${c.done ? 'checked' : ''}><span>${esc(c.t)}</span><button type="button" class="rm" data-rm="${i}">×</button></label>`).join('');
          bindCheck();
        };
        const bindCheck = () => {
          $$('#t-check input[type=checkbox]', m.el).forEach(cb => cb.onchange = () => { checklist[cb.dataset.i].done = cb.checked; redrawCheck(); });
          $$('#t-check [data-rm]', m.el).forEach(b => b.onclick = () => { checklist.splice(b.dataset.rm, 1); redrawCheck(); });
        };
        bindCheck();
        $('#t-check-add', m.el).onclick = () => {
          const v = $('#t-check-new', m.el).value.trim();
          if (!v) return;
          checklist.push({ t: v, done: false });
          $('#t-check-new', m.el).value = '';
          redrawCheck();
        };

        if (!isNew) {
          $('#t-file', m.el).onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > 8 * 1024 * 1024) return toast('Arquivo acima de 8 MB.', 'error');
            const path = `${t.id}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, '_')}`;
            const { error } = await sb.storage.from('anexos').upload(path, file);
            if (error) return toast('Falha no upload: ' + error.message, 'error');
            const { data: pub } = sb.storage.from('anexos').getPublicUrl(path);
            await sb.from('tarefa_anexos').insert({ tarefa_id: t.id, nome: file.name, url: pub.publicUrl });
            toast('Anexo enviado. 📎', 'success');
            m.close(); reload();
          };
          $('#t-com-add', m.el).onclick = async () => {
            const texto = $('#t-com-new', m.el).value.trim();
            if (!texto) return;
            await sb.from('tarefa_comentarios').insert({ tarefa_id: t.id, texto });
            await App.notifyMentions(texto, `/projetos/${id}`, `"${t.titulo}"`);
            if (t.responsavel_id) App.notify(t.responsavel_id, `Novo comentário em "${t.titulo}".`, `/projetos/${id}`);
            toast('Comentário publicado. 💬', 'success');
            m.close(); reload();
          };
          $('#t-del', m.el).onclick = async () => {
            if (!await confirmDlg('Excluir esta tarefa definitivamente?')) return;
            await sb.from('tarefas').delete().eq('id', t.id);
            m.close(); toast('Tarefa excluída.', 'success'); reload();
          };
        }

        $('#t-save', m.el).onclick = async () => {
          const titulo = $('#t-titulo', m.el).value.trim();
          if (!titulo) return toast('Dê um título à tarefa.', 'error');
          const payload = {
            projeto_id: id, titulo,
            descricao: $('#t-desc', m.el).value.trim(),
            responsavel_id: $('#t-resp', m.el).value || null,
            prazo: $('#t-prazo', m.el).value ? new Date($('#t-prazo', m.el).value).toISOString() : null,
            checklist,
          };
          const { error } = isNew
            ? await sb.from('tarefas').insert(payload)
            : await sb.from('tarefas').update(payload).eq('id', t.id);
          if (error) return toast('Erro ao salvar: ' + error.message, 'error');
          if (payload.responsavel_id && payload.responsavel_id !== t.responsavel_id)
            App.notify(payload.responsavel_id, `Você foi definido como responsável por "${titulo}".`, `/projetos/${id}`);
          m.close(); toast(isNew ? 'Tarefa criada! ✓' : 'Tarefa salva. ✓', 'success'); reload();
        };
      };

      $('#nova-tarefa', view).onclick = () => openTask(null);

      /* ----- tempo real: outro membro moveu um card ----- */
      const ch = sb.channel('kb-' + id)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tarefas', filter: `projeto_id=eq.${id}` }, () => reload())
        .subscribe();
      // cronômetro de deadline: atualiza os badges a cada minuto
      const tick = setInterval(() => {
        $$('.kb-card', view).forEach(card => {
          const t = tarefas.find(x => x.id === card.dataset.task);
          if (t?.prazo) { const b = card.querySelector('.deadline'); if (b) b.outerHTML = deadlineBadge(t.prazo, t.coluna); }
        });
      }, 60000);
      App.onLeave(() => { sb.removeChannel(ch); clearInterval(tick); });
    },
  });
})();
