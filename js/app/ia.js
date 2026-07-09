// ============================================================
// Renovar — Copilot: assistente do estúdio
// Responde dúvidas via Base de Conhecimento, resume textos e
// reuniões, analisa e projeta o financeiro.
// ============================================================
(() => {
  'use strict';
  const { sb, $, $$, esc, money } = App;

  /* ---------- resumo extrativo (frequência de palavras) ---------- */
  const STOP = new Set('a o os as um uma de do da dos das em no na nos nas por para com sem sob que e ou mas se ao aos à às é são foi ser ter tem seu sua seus suas isso este esta esse essa não sim como mais menos muito pouco também já vai vamos nós eles elas você vocês eu ele ela quando onde porque então até entre sobre depois antes cada'.split(' '));
  App.iaResumir = (texto, maxFrases = 4) => {
    const frases = texto.replace(/\s+/g, ' ').match(/[^.!?\n]+[.!?\n]?/g) || [];
    if (frases.length <= maxFrases) return texto.trim();
    const freq = {};
    texto.toLowerCase().replace(/[^\wáéíóúâêôãõç\s]/gi, ' ').split(/\s+/).forEach(w => {
      if (w.length > 3 && !STOP.has(w)) freq[w] = (freq[w] || 0) + 1;
    });
    const score = (f) => f.toLowerCase().split(/\s+/).reduce((a, w) => a + (freq[w] || 0), 0) / Math.max(f.split(/\s+/).length, 1);
    const top = frases.map((f, i) => ({ f: f.trim(), i, s: score(f) }))
      .sort((a, b) => b.s - a.s).slice(0, maxFrases)
      .sort((a, b) => a.i - b.i);
    return '📌 Pontos principais:\n' + top.map(t => '• ' + t.f).join('\n');
  };

  /* ---------- sugestão de resposta p/ helpdesk (busca na Wiki) ---------- */
  App.iaSugerirResposta = async (contexto) => {
    const termos = contexto.toLowerCase().replace(/[^\wáéíóúâêôãõç\s]/gi, ' ')
      .split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)).slice(0, 6).join(' ');
    let artigos = [];
    if (termos) {
      const { data } = await sb.from('wiki_artigos').select('titulo, conteudo')
        .textSearch('fts', termos.split(' ').join(' or '), { type: 'websearch', config: 'portuguese' }).limit(1);
      artigos = data || [];
    }
    if (!artigos.length) {
      const { data } = await sb.from('wiki_artigos').select('titulo, conteudo').eq('categoria', 'Suporte').limit(1);
      artigos = data || [];
    }
    const base = artigos[0];
    const trecho = base ? base.conteudo.replace(/[#>*]/g, '').replace(/\n{2,}/g, '\n').split('\n')
      .filter(l => l.trim().length > 25).slice(0, 3).join(' ').slice(0, 320) : '';
    return `Olá! Obrigado pelo contato. 🧡\n\n${trecho || 'Nossa equipe vai te ajudar com isso rapidinho.'}\n\nPosso ajudar em algo mais?` +
      (base ? `\n\n— fonte: artigo "${base.titulo}" da Base de Conhecimento` : '');
  };

  /* ---------- análise financeira ---------- */
  const analiseFinanceira = async () => {
    const { vendas, despesas } = await App.getFinance();
    const mes = new Date().toISOString().slice(0, 7);
    const fatMes = vendas.filter(v => v.data.startsWith(mes)).reduce((a, v) => a + +v.valor, 0);
    const despMes = despesas.filter(d => d.data.startsWith(mes)).reduce((a, d) => a + +d.valor, 0);
    const porCat = {};
    vendas.filter(v => v.data.startsWith(mes)).forEach(v => porCat[v.categoria] = (porCat[v.categoria] || 0) + +v.valor);
    const top = Object.entries(porCat).sort((a, b) => b[1] - a[1])[0];
    const fc = App.forecast3m(vendas);
    const margem = fatMes ? ((fatMes - despMes) / fatMes * 100).toFixed(1) : 0;
    let out = `📊 Análise do mês atual\n• Receitas: ${money(fatMes)}\n• Despesas: ${money(despMes)}\n• Resultado: ${money(fatMes - despMes)} (margem ${margem}%)`;
    if (top) out += `\n• Categoria líder: ${top[0]} (${money(top[1])})`;
    if (fc.proj?.length) {
      out += `\n\n🔮 Previsão (regressão linear, ${fc.keys.length} meses de histórico):`;
      fc.projKeys.forEach((k, i) => out += `\n• ${k}: ≈ ${money(fc.proj[i])}`);
      out += `\n\nTendência: ${fc.slope >= 0 ? '📈 crescimento' : '📉 queda'} de ${money(Math.abs(fc.slope))}/mês.`;
    }
    return out;
  };

  /* ---------- respostas p/ aluno (dados próprios) ---------- */
  const respostaAluno = async (q) => {
    const uid = App.user.id;
    if (/consult|agend|hor[aá]ri/.test(q)) {
      const { data } = await sb.from('consultas').select('*').eq('aluno_id', uid).eq('status', 'agendada').gte('data', new Date().toISOString().slice(0, 10)).order('data').limit(3);
      return data?.length
        ? '📅 Suas próximas consultas:\n' + data.map(c => `• ${App.fmtDate(c.data)} às ${c.hora.slice(0, 5)} — ${c.tipo}`).join('\n') + '\n\nPara editar ou cancelar, acesse Minhas consultas.'
        : 'Você não tem consultas agendadas. Quer marcar? Vá em "Minhas consultas" → Agendar. 🧡';
    }
    if (/pag|financ|mensalid|boleto|d[eé]bito/.test(q)) {
      const { data } = await sb.from('financeiro_aluno').select('*').eq('aluno_id', uid).neq('status', 'pago').order('vencimento');
      return data?.length
        ? '💳 Cobranças em aberto:\n' + data.map(f => `• ${f.descricao} — ${money(f.valor)} (vence ${App.fmtDate(f.vencimento)})`).join('\n')
        : '✅ Seu financeiro está em dia. Nenhuma cobrança pendente!';
    }
    if (/plano/.test(q)) {
      const { data } = await sb.from('assinaturas').select('*, planos(*)').eq('aluno_id', uid).eq('status', 'ativa').limit(1);
      const p = data?.[0]?.planos;
      return p ? `📋 Seu plano atual é o ${p.nome} (${money(p.preco)}/mês, ${p.aulas_semana >= 7 ? 'aulas ilimitadas' : p.aulas_semana + 'x por semana'}). Veja outros na aba Planos.`
        : 'Você ainda não tem plano ativo. Confira as opções na aba Planos! 🧡';
    }
    return null;
  };

  /* ---------- cérebro do copilot ---------- */
  let aguardandoResumo = false;
  const pensar = async (q) => {
    const lower = q.toLowerCase();
    if (aguardandoResumo || (lower.split(/\s+/).length > 60 && !/previs|faturamento|análise|analise/.test(lower))) {
      aguardandoResumo = false;
      return App.iaResumir(q);
    }
    if (/resum|reuni[ãa]o|transcri/.test(lower)) {
      aguardandoResumo = true;
      return 'Claro! Cole aqui o texto ou a ata da reunião (áudio ainda não é suportado nesta versão local) que eu devolvo os pontos principais. ✍️';
    }
    if (App.role === 'aluno') {
      const r = await respostaAluno(lower);
      if (r) return r;
    }
    if (['gerente', 'admin'].includes(App.role) && /previs|faturamento|fluxo|caixa|an[áa]lise|financeir|cen[áa]rio|margem/.test(lower)) {
      return analiseFinanceira();
    }
    if (/redig|escrev|documento|comunicado/.test(lower)) {
      const tema = q.replace(/^.*?(redigir|redija|escreva|escrever)\s*/i, '').trim() || 'comunicado interno';
      return `📝 Rascunho — ${tema}\n\nPrezados,\n\nGostaríamos de comunicar sobre: ${tema}.\n[Contexto e detalhes principais]\n[O que muda e a partir de quando]\n[Canal para dúvidas]\n\nAtenciosamente,\nEquipe Renovar Pilates & Fisioterapia\n\n(Edite os trechos entre colchetes.)`;
    }
    // fallback: busca na Wiki (só equipe tem acesso à wiki)
    if (App.role !== 'aluno') {
      const termos = lower.replace(/[^\wáéíóúâêôãõç\s]/gi, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)).slice(0, 6);
      if (termos.length) {
        const { data } = await sb.from('wiki_artigos').select('id, titulo, conteudo')
          .textSearch('fts', termos.join(' or '), { type: 'websearch', config: 'portuguese' }).limit(2);
        if (data?.length) {
          return '📖 Encontrei na Base de Conhecimento:\n\n' + data.map(a =>
            `• ${a.titulo}\n  ${a.conteudo.replace(/[#>*\n]/g, ' ').slice(0, 140)}…`).join('\n\n') +
            '\n\nAbra a Wiki para ler na íntegra.';
        }
      }
    }
    return App.role === 'aluno'
      ? 'Posso te ajudar com: "minhas consultas", "meu plano", "pagamentos" ou resumir um texto. O que você precisa? 🧡'
      : 'Posso: buscar na Wiki (pergunte algo), resumir reuniões ("resumir"), analisar o financeiro ("análise financeira"), prever faturamento ("previsão") ou redigir documentos ("redigir comunicado sobre…").';
  };

  /* ---------- interface do copilot ---------- */
  document.addEventListener('app:ready', () => {
    const panel = document.createElement('aside');
    panel.className = 'copilot';
    panel.innerHTML = `
      <div class="copilot-head">
        <span class="spark"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l1.9 5.7L20 9.6l-5.4 3.4L16 19l-4-3.4L8 19l1.4-6L4 9.6l6.1-1.9L12 2z"/></svg></span>
        <div style="flex:1"><strong>Copilot Renovar</strong><small>seu assistente do estúdio</small></div>
        <button class="icon-btn" id="cp-close" aria-label="Fechar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </div>
      <div class="copilot-msgs" id="cp-msgs"></div>
      <div class="cp-sug" id="cp-sug"></div>
      <div class="copilot-input">
        <textarea id="cp-in" placeholder="Pergunte algo…" rows="1"></textarea>
        <button class="btn btn-primary" id="cp-send">➤</button>
      </div>`;
    document.body.appendChild(panel);

    const msgs = $('#cp-msgs', panel);
    const push = (texto, who) => {
      const el = document.createElement('div');
      el.className = 'cp-msg ' + who;
      el.textContent = texto;
      msgs.appendChild(el);
      msgs.scrollTop = msgs.scrollHeight;
      if (window.gsap) gsap.from(el, { y: 10, opacity: 0, duration: 0.3 });
    };

    const sugestoes = App.role === 'aluno'
      ? ['Minhas consultas', 'Meu plano', 'Pagamentos pendentes', 'Resumir um texto']
      : ['gerente', 'admin'].includes(App.role)
        ? ['Análise financeira', 'Previsão de faturamento', 'Resumir reunião', 'Como funciona o Gympass?']
        : ['Como funciona o Gympass?', 'Política de férias', 'Resumir reunião', 'Redigir comunicado'];
    $('#cp-sug', panel).innerHTML = sugestoes.map(s => `<button>${esc(s)}</button>`).join('');
    $$('#cp-sug button', panel).forEach(b => b.onclick = () => { $('#cp-in', panel).value = b.textContent; enviar(); });

    push(`Olá, ${(App.profile.full_name || '').split(' ')[0] || 'tudo bem'}! 👋 Sou o Copilot da Renovar. Como posso ajudar?`, 'bot');

    const enviar = async () => {
      const inp = $('#cp-in', panel);
      const q = inp.value.trim();
      if (!q) return;
      inp.value = '';
      push(q, 'user');
      const pensando = document.createElement('div');
      pensando.className = 'cp-msg bot';
      pensando.textContent = 'Pensando…';
      msgs.appendChild(pensando);
      try {
        const r = await pensar(q);
        pensando.remove();
        push(r, 'bot');
      } catch (err) {
        pensando.remove();
        push('Ops, algo deu errado: ' + err.message, 'bot');
      }
    };
    $('#cp-send', panel).onclick = enviar;
    $('#cp-in', panel).onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } };

    $('#btn-copilot').onclick = () => panel.classList.toggle('open');
    $('#cp-close', panel).onclick = () => panel.classList.remove('open');
    App.copilotOpen = () => panel.classList.add('open');
  });
})();
