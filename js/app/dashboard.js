// ============================================================
// Renovar — Dashboard gerencial: KPIs, gráficos, estoque,
// relatórios (CSV/PDF) e fluxo de caixa em tempo real
// ============================================================
(() => {
  'use strict';
  const { sb, $, $$, esc, money, fmtDate, toast } = App;

  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  let charts = [];
  const destroyCharts = () => { charts.forEach(c => c.destroy()); charts = []; };

  /* ---------- Dados financeiros (compartilhado com a IA) ---------- */
  App.getFinance = async () => {
    const [{ data: vendas }, { data: despesas }] = await Promise.all([
      sb.from('vendas').select('valor, categoria, data').order('data'),
      sb.from('despesas').select('valor, categoria, data').order('data'),
    ]);
    return { vendas: vendas || [], despesas: despesas || [] };
  };

  const monthKey = (d) => d.slice(0, 7);
  const groupByMonth = (rows) => {
    const map = {};
    rows.forEach(r => { const k = monthKey(r.data); map[k] = (map[k] || 0) + Number(r.valor); });
    return map;
  };

  // regressão linear simples (mínimos quadrados) sobre o total mensal
  App.forecast3m = (vendas) => {
    const byMonth = groupByMonth(vendas);
    const keys = Object.keys(byMonth).sort().slice(0, -1); // descarta mês corrente (parcial)
    const ys = keys.map(k => byMonth[k]);
    const n = ys.length;
    if (n < 3) return { keys, ys, proj: [] };
    const xs = ys.map((_, i) => i);
    const sx = xs.reduce((a, b) => a + b, 0), sy = ys.reduce((a, b) => a + b, 0);
    const sxy = xs.reduce((a, x, i) => a + x * ys[i], 0), sxx = xs.reduce((a, x) => a + x * x, 0);
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const inter = (sy - slope * sx) / n;
    const proj = [n, n + 1, n + 2].map(x => Math.max(0, inter + slope * x));
    const last = new Date(keys[keys.length - 1] + '-15');
    const projKeys = [1, 2, 3].map(i => { const d = new Date(last); d.setMonth(d.getMonth() + i); return d.toISOString().slice(0, 7); });
    return { keys, ys, proj, projKeys, slope };
  };

  const labelMes = (k) => MESES[Number(k.slice(5, 7)) - 1] + '/' + k.slice(2, 4);

  const baseOpts = () => ({
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: cssVar('--text-soft'), font: { family: 'Manrope', weight: 700, size: 12 }, boxWidth: 14, boxHeight: 3 } },
      tooltip: { backgroundColor: cssVar('--surface'), titleColor: cssVar('--text'), bodyColor: cssVar('--text-soft'), borderColor: cssVar('--line'), borderWidth: 1, padding: 10, callbacks: { label: (c) => ` ${c.dataset.label}: ${money(c.parsed.y ?? c.parsed)}` } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: cssVar('--text-soft'), font: { family: 'Manrope', size: 11 } } },
      y: { grid: { color: cssVar('--line') }, border: { display: false }, ticks: { color: cssVar('--text-soft'), font: { family: 'Manrope', size: 11 }, callback: (v) => 'R$ ' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v) } },
    },
  });

  /* ================= DASHBOARD ================= */
  App.route('/dashboard', {
    title: 'Dashboard gerencial', roles: ['gerente', 'admin'],
    async render(_, view) {
      const hoje = new Date().toISOString().slice(0, 10);
      const mesAtual = hoje.slice(0, 7);
      const ano = hoje.slice(0, 4);

      const [{ vendas, despesas }, { data: produtos }, { data: consultasHoje }] = await Promise.all([
        App.getFinance(),
        sb.from('produtos').select('*').order('nome'),
        sb.from('consultas').select('id').eq('data', hoje).eq('status', 'agendada'),
      ]);

      const fatDia = vendas.filter(v => v.data === hoje).reduce((a, v) => a + Number(v.valor), 0);
      const fatMes = vendas.filter(v => monthKey(v.data) === mesAtual).reduce((a, v) => a + Number(v.valor), 0);
      const fatAno = vendas.filter(v => v.data.startsWith(ano)).reduce((a, v) => a + Number(v.valor), 0);
      const despMes = despesas.filter(d => monthKey(d.data) === mesAtual).reduce((a, d) => a + Number(d.valor), 0);

      const mesPassado = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();
      const fatMesPassado = vendas.filter(v => monthKey(v.data) === mesPassado).reduce((a, v) => a + Number(v.valor), 0);
      const diaDoMes = new Date().getDate();
      const ritmo = fatMesPassado > 0 ? ((fatMes / diaDoMes * 30) / fatMesPassado - 1) * 100 : 0;

      const baixoEstoque = (produtos || []).filter(p => p.quantidade <= p.estoque_minimo);
      const fc = App.forecast3m(vendas);

      view.innerHTML = `
        ${baixoEstoque.length ? `<div class="card" style="border-color:var(--warn);background:var(--warn-soft);margin-bottom:1.2rem;display:flex;align-items:center;gap:.8rem;flex-wrap:wrap">
          <span style="font-size:1.3rem">⚠️</span>
          <div style="flex:1"><strong>Alerta de estoque:</strong> ${baixoEstoque.map(p => esc(p.nome) + ` (${p.quantidade} un.)`).join(' · ')} abaixo do mínimo de segurança.</div>
        </div>` : ''}
        <div class="grid-4">
          <div class="card kpi"><span class="kpi-label">Faturamento hoje</span><span class="kpi-value">${money(fatDia)}</span><span class="kpi-delta flat">${consultasHoje?.length || 0} consulta(s) hoje</span></div>
          <div class="card kpi"><span class="kpi-label">Faturamento do mês</span><span class="kpi-value">${money(fatMes)}</span>
            <span class="kpi-delta ${ritmo >= 0 ? 'up' : 'down'}">${ritmo >= 0 ? '▲' : '▼'} ${Math.abs(ritmo).toFixed(1)}% vs. ritmo do mês passado</span></div>
          <div class="card kpi"><span class="kpi-label">Faturamento do ano</span><span class="kpi-value">${money(fatAno)}</span><span class="kpi-delta flat">acumulado ${ano}</span></div>
          <div class="card kpi"><span class="kpi-label">Resultado do mês</span><span class="kpi-value">${money(fatMes - despMes)}</span>
            <span class="kpi-delta ${fatMes - despMes >= 0 ? 'up' : 'down'}">${fatMes - despMes >= 0 ? '▲ lucro' : '▼ prejuízo'} · despesas ${money(despMes)}</span></div>
        </div>

        <div class="grid-2" style="margin-top:1.2rem">
          <div class="card"><h3>Receitas × Despesas (mensal)</h3><div class="chart-box"><canvas id="ch-fluxo"></canvas></div></div>
          <div class="card"><h3>Vendas por categoria (mês atual)</h3><div class="chart-box"><canvas id="ch-cat"></canvas></div></div>
        </div>

        <div class="card" style="margin-top:1.2rem">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.6rem;margin-bottom:.9rem">
            <h3 style="margin:0">🤖 Insights financeiros (IA) — previsão dos próximos 3 meses</h3>
            <span class="tag tag-brand">regressão sobre o fluxo de caixa</span>
          </div>
          <div class="chart-box"><canvas id="ch-fc"></canvas></div>
          <p id="fc-note" style="margin-top:.8rem;color:var(--text-soft);font-size:.9rem"></p>
        </div>

        <div class="card" style="margin-top:1.2rem">
          <h3>Estoque</h3>
          <div class="table-wrap"><table class="tbl">
            <thead><tr><th>Produto</th><th>Categoria</th><th class="num">Qtd.</th><th class="num">Mínimo</th><th class="num">Preço</th><th>Situação</th></tr></thead>
            <tbody>${(produtos || []).map(p => `<tr>
              <td><strong>${esc(p.nome)}</strong></td><td>${esc(p.categoria)}</td>
              <td class="num">${p.quantidade}</td><td class="num">${p.estoque_minimo}</td>
              <td class="num">${money(p.preco)}</td>
              <td>${p.quantidade <= p.estoque_minimo ? '<span class="tag tag-warn">⚠ repor estoque</span>' : '<span class="tag tag-ok">✓ ok</span>'}</td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>`;

      /* ----- gráficos ----- */
      destroyCharts();
      const c1 = cssVar('--chart-1'), c2 = cssVar('--chart-2');

      const meses = [...new Set([...Object.keys(groupByMonth(vendas)), ...Object.keys(groupByMonth(despesas))])].sort().slice(-7);
      const vm = groupByMonth(vendas), dm = groupByMonth(despesas);
      charts.push(new Chart($('#ch-fluxo'), {
        type: 'line',
        data: { labels: meses.map(labelMes), datasets: [
          { label: 'Receitas', data: meses.map(m => vm[m] || 0), borderColor: c1, backgroundColor: c1, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0.35 },
          { label: 'Despesas', data: meses.map(m => dm[m] || 0), borderColor: c2, backgroundColor: c2, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0.35 },
        ]},
        options: baseOpts(),
      }));

      const porCat = {};
      vendas.filter(v => monthKey(v.data) === mesAtual).forEach(v => porCat[v.categoria] = (porCat[v.categoria] || 0) + Number(v.valor));
      const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
      const optsBar = baseOpts(); optsBar.plugins.legend.display = false;
      charts.push(new Chart($('#ch-cat'), {
        type: 'bar',
        data: { labels: cats.map(c => c[0]), datasets: [{ label: 'Vendas', data: cats.map(c => c[1]), backgroundColor: c1, borderRadius: 4, maxBarThickness: 44 }] },
        options: optsBar,
      }));

      if (fc.proj.length) {
        const allKeys = [...fc.keys, ...fc.projKeys];
        charts.push(new Chart($('#ch-fc'), {
          type: 'line',
          data: { labels: allKeys.map(labelMes), datasets: [
            { label: 'Faturamento real', data: [...fc.ys, ...fc.projKeys.map(() => null)], borderColor: c1, backgroundColor: c1, borderWidth: 2, pointRadius: 3, tension: 0.35 },
            { label: 'Previsão (IA)', data: [...fc.ys.map((v, i) => i === fc.ys.length - 1 ? v : null), ...fc.proj], borderColor: c1, backgroundColor: c1, borderWidth: 2, borderDash: [6, 5], pointRadius: 3, pointStyle: 'rectRot', tension: 0.35 },
          ]},
          options: baseOpts(),
        }));
        const tendencia = fc.slope >= 0 ? 'crescimento' : 'queda';
        $('#fc-note').textContent = `Tendência de ${tendencia} de ${money(Math.abs(fc.slope))}/mês. Projeção: ${fc.projKeys.map((k, i) => labelMes(k) + ' ≈ ' + money(fc.proj[i])).join(' · ')}. Modelo: regressão linear local sobre ${fc.keys.length} meses de histórico.`;
      }

      /* ----- tempo real: novo pagamento/venda/despesa atualiza na hora ----- */
      const ch = sb.channel('dash-rt')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vendas' }, () => { toast('Fluxo de caixa atualizado em tempo real. 💸', 'success'); this.render(_, view); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'despesas' }, () => this.render(_, view))
        .subscribe();
      App.onLeave(() => { sb.removeChannel(ch); destroyCharts(); });

      const onTheme = () => this.render(_, view);
      document.addEventListener('themechange', onTheme);
      App.onLeave(() => document.removeEventListener('themechange', onTheme));
    },
  });

  /* ================= RELATÓRIOS ================= */
  App.route('/relatorios', {
    title: 'Relatórios', roles: ['gerente', 'admin'],
    async render(_, view) {
      view.innerHTML = `
        <div class="view-head"><div>
          <h2>Relatórios</h2>
          <p>Filtre por período e categoria; exporte em CSV (Excel) ou PDF.</p>
        </div></div>
        <div class="card">
          <div class="filters no-print">
            <div class="field"><label>Tipo</label><select id="r-tipo"><option value="vendas">Vendas</option><option value="despesas">Despesas</option></select></div>
            <div class="field"><label>De</label><input type="date" id="r-de"></div>
            <div class="field"><label>Até</label><input type="date" id="r-ate"></div>
            <div class="field"><label>Categoria</label><select id="r-cat"><option value="">Todas</option></select></div>
            <button class="btn btn-primary" id="r-go">Filtrar</button>
            <button class="btn btn-ghost" id="r-csv">⬇ CSV (Excel)</button>
            <button class="btn btn-ghost" id="r-pdf">⬇ PDF</button>
          </div>
          <div id="r-out"><p style="color:var(--text-soft)">Escolha os filtros e clique em Filtrar.</p></div>
        </div>`;

      const de = $('#r-de'), ate = $('#r-ate');
      const mesIni = new Date(); mesIni.setDate(1);
      de.value = mesIni.toISOString().slice(0, 10);
      ate.value = new Date().toISOString().slice(0, 10);
      let lastRows = [];

      const carregaCategorias = async () => {
        const t = $('#r-tipo').value;
        const { data } = await sb.from(t).select('categoria');
        const cats = [...new Set((data || []).map(r => r.categoria))].sort();
        $('#r-cat').innerHTML = '<option value="">Todas</option>' + cats.map(c => `<option>${esc(c)}</option>`).join('');
      };
      await carregaCategorias();
      $('#r-tipo').onchange = carregaCategorias;

      const filtrar = async () => {
        const t = $('#r-tipo').value;
        let q = sb.from(t).select('*').gte('data', de.value).lte('data', ate.value).order('data', { ascending: false });
        if ($('#r-cat').value) q = q.eq('categoria', $('#r-cat').value);
        const { data: rows, error } = await q;
        if (error) return toast('Erro ao filtrar: ' + error.message, 'error');
        lastRows = rows || [];
        const total = lastRows.reduce((a, r) => a + Number(r.valor), 0);
        $('#r-out').innerHTML = `
          <p style="margin-bottom:.8rem"><strong>${lastRows.length}</strong> lançamento(s) · total <strong style="color:var(--brand-ink)">${money(total)}</strong></p>
          <div class="table-wrap"><table class="tbl">
            <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th class="num">Valor</th></tr></thead>
            <tbody>${lastRows.map(r => `<tr><td>${fmtDate(r.data)}</td><td>${esc(r.descricao)}</td><td><span class="tag tag-muted">${esc(r.categoria)}</span></td><td class="num">${money(r.valor)}</td></tr>`).join('')}</tbody>
          </table></div>`;
      };
      $('#r-go').onclick = filtrar;
      await filtrar();

      $('#r-csv').onclick = () => {
        if (!lastRows.length) return toast('Nada para exportar.', 'error');
        const head = 'data;descricao;categoria;valor\n';
        const body = lastRows.map(r => [r.data, `"${r.descricao.replace(/"/g, '""')}"`, r.categoria, String(r.valor).replace('.', ',')].join(';')).join('\n');
        const blob = new Blob(['﻿' + head + body], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `relatorio-${$('#r-tipo').value}-${de.value}_a_${ate.value}.csv`;
        a.click(); URL.revokeObjectURL(a.href);
        toast('CSV exportado — abre direto no Excel. ✓', 'success');
      };
      $('#r-pdf').onclick = () => { toast('Gerando PDF pela impressão do navegador…', 'info'); setTimeout(() => window.print(), 300); };
    },
  });
})();
