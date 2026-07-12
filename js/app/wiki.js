// ============================================================
// Renovar — Base de Conhecimento (Wiki): busca full-text,
// leitura com embeds, editor markdown e histórico de versões
// ============================================================
(() => {
  'use strict';
  const { sb, $, $$, esc, toast, modal, confirm: confirmDlg } = App;

  const CATS = ['RH', 'Vendas', 'Suporte', 'Geral'];

  /* ---------- mini-markdown -> HTML (com YouTube e downloads) ---------- */
  // Só aceita protocolos seguros; bloqueia javascript:, data:, vbscript: etc.
  // (a URL já vem HTML-escapada por esc(); aqui validamos o esquema)
  const safeUrl = (url, { img = false } = {}) => {
    const raw = url.replace(/&amp;/g, '&').trim();
    if (/^(https?:)?\/\//i.test(raw) || raw.startsWith('/')) return url;
    if (!img && /^mailto:/i.test(raw)) return url;
    return '#';
  };
  const inline = (s) => s
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img src="${safeUrl(src, { img: true })}" alt="${alt}" loading="lazy">`)
    .replace(/\[([^\]]+)\]\(([^)\s]+\.(?:pdf|docx?|xlsx?|pptx?|zip|rar))\)/gi, (_, txt, href) => `<a class="file-dl" href="${safeUrl(href)}" target="_blank" rel="noopener noreferrer" download>⬇ ${txt}</a>`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, href) => `<a href="${safeUrl(href)}" target="_blank" rel="noopener noreferrer">${txt}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  App.mdRender = (md) => {
    const lines = esc(md || '').split(/\r?\n/);
    const out = [];
    let list = null;
    const closeList = () => { if (list) { out.push(list === 'ul' ? '</ul>' : '</ol>'); list = null; } };
    for (const raw of lines) {
      const line = raw.trimEnd();
      const yt = line.match(/^https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)\s*$/);
      const vm = line.match(/^https?:\/\/(?:www\.)?vimeo\.com\/(\d+)\s*$/);
      if (yt) { closeList(); out.push(`<div class="video-embed"><iframe src="https://www.youtube.com/embed/${yt[1]}" allowfullscreen loading="lazy" title="Vídeo incorporado"></iframe></div>`); continue; }
      if (vm) { closeList(); out.push(`<div class="video-embed"><iframe src="https://player.vimeo.com/video/${vm[1]}" allowfullscreen loading="lazy" title="Vídeo incorporado"></iframe></div>`); continue; }
      if (/^### /.test(line)) { closeList(); out.push('<h3>' + inline(line.slice(4)) + '</h3>'); continue; }
      if (/^## /.test(line)) { closeList(); out.push('<h2>' + inline(line.slice(3)) + '</h2>'); continue; }
      if (/^> /.test(line)) { closeList(); out.push('<blockquote>' + inline(line.slice(2)) + '</blockquote>'); continue; }
      if (/^[-*] /.test(line)) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inline(line.slice(2)) + '</li>'); continue; }
      if (/^\d+\. /.test(line)) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inline(line.replace(/^\d+\. /, '')) + '</li>'); continue; }
      if (line === '') { closeList(); continue; }
      closeList(); out.push('<p>' + inline(line) + '</p>');
    }
    closeList();
    return out.join('\n');
  };

  /* ================= HOME DA WIKI ================= */
  App.route('/wiki', {
    title: 'Base de Conhecimento', roles: ['funcionario', 'gerente', 'admin'],
    async render(_, view) {
      let cat = '';
      view.innerHTML = `
        <div class="view-head"><div>
          <h2>Base de Conhecimento</h2><p>Manuais, políticas e respostas padrão — busca indexada em todo o texto.</p>
        </div><a class="btn btn-primary" href="#/wiki/novo/editar">＋ Novo artigo</a></div>
        <div class="wiki-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input id="w-busca" placeholder="Buscar por palavra-chave… (ex.: gympass, férias, planos)" autocomplete="off">
        </div>
        <div class="wiki-cats">
          <button class="wiki-cat active" data-cat="">Todas</button>
          ${CATS.map(c => `<button class="wiki-cat" data-cat="${c}">${c}</button>`).join('')}
        </div>
        <div class="grid-3" id="w-lista"></div>`;

      const lista = $('#w-lista', view);
      const load = async (termo = '') => {
        lista.innerHTML = '<div class="skel" style="height:120px"></div>';
        let q = sb.from('wiki_artigos').select('id, titulo, categoria, conteudo, atualizado_em');
        if (cat) q = q.eq('categoria', cat);
        if (termo) q = q.textSearch('fts', termo, { type: 'websearch', config: 'portuguese' });
        const { data: rows, error } = await q.order('atualizado_em', { ascending: false });
        if (error) { lista.innerHTML = `<p style="color:var(--danger)">Erro na busca: ${esc(error.message)}</p>`; return; }
        lista.innerHTML = (rows || []).map(a => `
          <div class="card wiki-item" data-id="${a.id}">
            <span class="tag tag-brand">${esc(a.categoria)}</span>
            <h4>${esc(a.titulo)}</h4>
            <p>${esc(a.conteudo.replace(/[#>*\-\[\]()]/g, ' ').slice(0, 110))}…</p>
            <small style="color:var(--text-soft)">atualizado ${App.timeAgo(a.atualizado_em)}</small>
          </div>`).join('') || '<p style="color:var(--text-soft);grid-column:1/-1;text-align:center;padding:2rem">Nada encontrado. Tente outra palavra-chave.</p>';
        $$('.wiki-item', lista).forEach(c => c.onclick = () => App.go('/wiki/' + c.dataset.id));
      };
      await load();

      let deb;
      $('#w-busca', view).oninput = (e) => { clearTimeout(deb); deb = setTimeout(() => load(e.target.value.trim()), 350); };
      $$('.wiki-cat', view).forEach(b => b.onclick = () => {
        $$('.wiki-cat', view).forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        cat = b.dataset.cat;
        load($('#w-busca', view).value.trim());
      });
    },
  });

  /* ================= VISUALIZAÇÃO DO ARTIGO ================= */
  App.route('/wiki/:id', {
    title: 'Artigo', roles: ['funcionario', 'gerente', 'admin'],
    async render({ id }, view) {
      const { data: a } = await sb.from('wiki_artigos').select('*').eq('id', id).single();
      if (!a) { App.go('/wiki'); return; }
      const staff = await App.staff();
      const autor = staff.find(s => s.id === a.autor_id);
      view.innerHTML = `
        <div class="article">
          <div class="view-head">
            <a class="icon-btn" href="#/wiki" title="Voltar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M19 12H5m6-6-6 6 6 6"/></svg></a>
            <div style="display:flex;gap:.6rem">
              <button class="btn btn-ghost btn-sm" id="w-hist">🕘 Histórico</button>
              <a class="btn btn-primary btn-sm" href="#/wiki/${id}/editar">✎ Editar</a>
            </div>
          </div>
          <span class="tag tag-brand">${esc(a.categoria)}</span>
          <h2 style="font-family:var(--font-display);font-weight:500;font-size:2.1rem;margin:.6rem 0 .3rem;letter-spacing:-.01em">${esc(a.titulo)}</h2>
          <p style="color:var(--text-soft);font-size:.88rem;margin-bottom:1.4rem">por ${esc(autor?.full_name || 'equipe')} · atualizado ${App.timeAgo(a.atualizado_em)}</p>
          <div class="article-body card">${App.mdRender(a.conteudo)}</div>
        </div>`;

      $('#w-hist', view).onclick = async () => {
        const { data: vers } = await sb.from('wiki_versoes').select('*').eq('artigo_id', id).order('criado_em', { ascending: false });
        const m = modal(`<h3>Histórico de versões</h3>
          ${(vers || []).map(v => `<div class="version-item">
            <div><strong>${esc(v.titulo)}</strong><br><small style="color:var(--text-soft)">${App.fmtDateTime(v.criado_em)}</small></div>
            <div style="display:flex;gap:.4rem"><button class="btn btn-ghost btn-sm" data-ver="${v.id}">Ver</button>
            <button class="btn btn-primary btn-sm" data-rest="${v.id}">Restaurar</button></div>
          </div>`).join('') || '<p style="color:var(--text-soft)">Este artigo ainda não tem versões anteriores.</p>'}`, { wide: true });
        $$('[data-ver]', m.el).forEach(b => b.onclick = () => {
          const v = vers.find(x => x.id === b.dataset.ver);
          modal(`<h3>${esc(v.titulo)} <span class="tag tag-muted">versão de ${App.fmtDateTime(v.criado_em)}</span></h3><div class="article-body">${App.mdRender(v.conteudo)}</div>`, { wide: true });
        });
        $$('[data-rest]', m.el).forEach(b => b.onclick = async () => {
          if (!await confirmDlg('Restaurar esta versão? A versão atual será guardada no histórico.')) return;
          const v = vers.find(x => x.id === b.dataset.rest);
          await sb.from('wiki_versoes').insert({ artigo_id: id, titulo: a.titulo, conteudo: a.conteudo, editor_id: App.user.id });
          await sb.from('wiki_artigos').update({ titulo: v.titulo, conteudo: v.conteudo, atualizado_em: new Date().toISOString() }).eq('id', id);
          m.close(); toast('Versão restaurada. ↩', 'success'); this.render({ id }, view);
        });
      };
    },
  });

  /* ================= EDITOR ================= */
  App.route('/wiki/:id/editar', {
    title: 'Editor de artigo', roles: ['funcionario', 'gerente', 'admin'],
    async render({ id }, view) {
      const isNew = id === 'novo';
      let a = { titulo: '', categoria: 'Geral', conteudo: '' };
      if (!isNew) {
        const { data } = await sb.from('wiki_artigos').select('*').eq('id', id).single();
        if (!data) { App.go('/wiki'); return; }
        a = data;
      }
      view.innerHTML = `
        <div class="view-head"><div>
          <h2>${isNew ? 'Novo artigo' : 'Editar artigo'}</h2>
          <p>Formatação em Markdown. Cole um link do YouTube/Vimeo numa linha para incorporar o vídeo.</p>
        </div><div style="display:flex;gap:.6rem">
          <a class="btn btn-ghost" href="#/wiki${isNew ? '' : '/' + id}">Cancelar</a>
          <button class="btn btn-primary" id="w-save">💾 Salvar</button>
        </div></div>
        <div class="grid-2" style="align-items:start">
          <div>
            <div class="field"><label>Título</label><input id="w-titulo" value="${esc(a.titulo)}" maxlength="140" placeholder="Ex.: Como abrir o estúdio pela manhã"></div>
            <div class="field"><label>Categoria</label><select id="w-cat">${CATS.map(c => `<option ${a.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
            <div class="editor-toolbar">
              <button type="button" data-md="**" title="Negrito"><b>B</b></button>
              <button type="button" data-md="*" title="Itálico"><i>I</i></button>
              <button type="button" data-ins="## " title="Título">H2</button>
              <button type="button" data-ins="### " title="Subtítulo">H3</button>
              <button type="button" data-ins="- " title="Lista">• Lista</button>
              <button type="button" data-ins="> " title="Citação">❝</button>
              <button type="button" data-wrap="[texto](https://)" title="Link">🔗 Link</button>
              <button type="button" data-wrap="![descrição](https://url-da-imagem)" title="Imagem">🖼 Imagem</button>
              <button type="button" data-wrap="https://www.youtube.com/watch?v=" title="Vídeo">▶ Vídeo</button>
              <button type="button" data-wrap="[baixar arquivo](https://url-do-arquivo.pdf)" title="Arquivo">📎 Arquivo</button>
            </div>
            <textarea class="editor-area" id="w-conteudo" placeholder="Escreva aqui…">${esc(a.conteudo)}</textarea>
          </div>
          <div class="card"><h3>Pré-visualização ao vivo</h3><div class="article-body" id="w-preview"></div></div>
        </div>`;

      const ta = $('#w-conteudo', view), prev = $('#w-preview', view);
      const paint = () => prev.innerHTML = App.mdRender(ta.value) || '<p style="color:var(--text-soft)">Comece a escrever para ver a prévia…</p>';
      paint();
      ta.oninput = paint;

      const insertAt = (txt) => {
        const s = ta.selectionStart, e = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + txt + ta.value.slice(e);
        ta.focus(); ta.selectionEnd = s + txt.length; paint();
      };
      $$('.editor-toolbar [data-ins]', view).forEach(b => b.onclick = () => insertAt('\n' + b.dataset.ins));
      $$('.editor-toolbar [data-wrap]', view).forEach(b => b.onclick = () => insertAt('\n' + b.dataset.wrap));
      $$('.editor-toolbar [data-md]', view).forEach(b => b.onclick = () => {
        const w = b.dataset.md, s = ta.selectionStart, e = ta.selectionEnd;
        const sel = ta.value.slice(s, e) || 'texto';
        ta.value = ta.value.slice(0, s) + w + sel + w + ta.value.slice(e);
        ta.focus(); paint();
      });

      $('#w-save', view).onclick = async () => {
        const titulo = $('#w-titulo', view).value.trim();
        const conteudo = ta.value.trim();
        if (!titulo || !conteudo) return toast('Preencha título e conteúdo.', 'error');
        if (isNew) {
          const { data, error } = await sb.from('wiki_artigos').insert({ titulo, categoria: $('#w-cat', view).value, conteudo }).select('id').single();
          if (error) return toast('Erro ao salvar: ' + error.message, 'error');
          toast('Artigo publicado! 📖', 'success');
          App.go('/wiki/' + data.id);
        } else {
          await sb.from('wiki_versoes').insert({ artigo_id: id, titulo: a.titulo, conteudo: a.conteudo, editor_id: App.user.id });
          const { error } = await sb.from('wiki_artigos').update({ titulo, categoria: $('#w-cat', view).value, conteudo, atualizado_em: new Date().toISOString() }).eq('id', id);
          if (error) return toast('Erro ao salvar: ' + error.message, 'error');
          toast('Artigo atualizado — versão anterior guardada no histórico. ✓', 'success');
          App.go('/wiki/' + id);
        }
      };
    },
  });
})();
