// ============================================================
// Renovar — núcleo do sistema interno
// Sessão + 2FA, RBAC, roteador, sidebar, notificações realtime
// ============================================================
window.App = (() => {
  'use strict';

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  const cfg = window.APP_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  const App = {
    sb, $, $$, esc,
    user: null, profile: null, role: 'aluno',
    routes: [], _leaveFns: [], _staff: null,
  };

  /* ---------- Formatadores ---------- */
  const moneyFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  App.money = (v) => moneyFmt.format(Number(v || 0));
  App.fmtDate = (d) => d ? new Date(d.length <= 10 ? d + 'T12:00' : d).toLocaleDateString('pt-BR') : '—';
  App.fmtDateTime = (d) => d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  App.timeAgo = (d) => {
    const s = (Date.now() - new Date(d).getTime()) / 1000;
    if (s < 60) return 'agora';
    if (s < 3600) return `${Math.floor(s / 60)} min atrás`;
    if (s < 86400) return `${Math.floor(s / 3600)} h atrás`;
    return `${Math.floor(s / 86400)} d atrás`;
  };
  App.initials = (name) => (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  App.avatarHtml = (p, cls = 'avatar') => p?.avatar_url
    ? `<span class="${cls}"><img src="${esc(p.avatar_url)}" alt=""></span>`
    : `<span class="${cls}">${esc(App.initials(p?.full_name || p?.email))}</span>`;

  /* ---------- Toast ---------- */
  App.toast = (msg, type = 'info', dur = 4500) => {
    const root = $('#toast-root');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => { el.classList.add('leaving'); el.addEventListener('animationend', () => el.remove(), { once: true }); }, dur);
  };

  /* ---------- Modal ---------- */
  App.modal = (html, { wide = false } = {}) => {
    const root = document.createElement('div');
    root.className = 'modal-root';
    root.innerHTML = `<div class="modal-backdrop"></div>
      <div class="modal-card${wide ? ' wide' : ''}">
        <button class="icon-btn modal-x" aria-label="Fechar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
        ${html}
      </div>`;
    document.body.appendChild(root);
    const close = () => { root.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    root.querySelector('.modal-backdrop').addEventListener('click', close);
    root.querySelector('.modal-x').addEventListener('click', close);
    if (window.gsap) gsap.fromTo(root.querySelector('.modal-card'), { y: 26, opacity: 0, scale: 0.97 }, { y: 0, opacity: 1, scale: 1, duration: 0.35, ease: 'power3.out' });
    return { el: root, close };
  };

  App.confirm = (msg) => new Promise((resolve) => {
    const m = App.modal(`<h3>Confirmar</h3><p style="color:var(--text-soft);margin-bottom:1.3rem">${esc(msg)}</p>
      <div style="display:flex;gap:.7rem;justify-content:flex-end">
        <button class="btn btn-ghost" data-no>Cancelar</button>
        <button class="btn btn-primary" data-yes>Confirmar</button>
      </div>`);
    m.el.querySelector('[data-yes]').onclick = () => { m.close(); resolve(true); };
    m.el.querySelector('[data-no]').onclick = () => { m.close(); resolve(false); };
  });

  /* ---------- Tema ---------- */
  const applyTheme = (t) => {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('renovar-theme', t);
    document.dispatchEvent(new CustomEvent('themechange'));
  };
  App.toggleTheme = () => applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');

  /* ---------- Equipe (cache) ---------- */
  App.staff = async () => {
    if (!App._staff) {
      const { data } = await sb.from('profiles').select('id, full_name, email, role, avatar_url')
        .in('role', ['admin', 'gerente', 'funcionario']).order('full_name');
      App._staff = data || [];
    }
    return App._staff;
  };

  /* ---------- Notificações ---------- */
  App.notify = async (userId, texto, link = '') => {
    if (!userId || userId === App.user.id) return;
    await sb.from('notificacoes').insert({ usuario_id: userId, texto, link });
  };
  // detecta @menções num texto e notifica os membros citados
  App.notifyMentions = async (texto, link, contexto) => {
    const staff = await App.staff();
    const lower = texto.toLowerCase();
    for (const p of staff) {
      const first = (p.full_name || '').split(/\s+/)[0].toLowerCase();
      if (first && lower.includes('@' + first)) await App.notify(p.id, `${App.profile.full_name.split(' ')[0]} mencionou você: ${contexto}`, link);
    }
  };

  let notifCache = [];
  const renderNotifs = () => {
    const list = $('#notif-list');
    const unread = notifCache.filter(n => !n.lida).length;
    const badge = $('#notif-badge');
    badge.hidden = unread === 0;
    badge.textContent = unread;
    list.innerHTML = notifCache.length === 0
      ? '<p class="notif-empty">Nenhuma notificação por aqui. 🧡</p>'
      : notifCache.map(n => `<button class="notif-item${n.lida ? '' : ' unread'}" data-id="${n.id}" data-link="${esc(n.link)}">${esc(n.texto)}<small>${App.timeAgo(n.criado_em)}</small></button>`).join('');
    $$('.notif-item', list).forEach(b => b.onclick = async () => {
      await sb.from('notificacoes').update({ lida: true }).eq('id', b.dataset.id);
      const n = notifCache.find(x => x.id === b.dataset.id); if (n) n.lida = true;
      renderNotifs();
      $('#notif-panel').hidden = true;
      if (b.dataset.link) location.hash = b.dataset.link;
    });
  };

  const initNotifs = async () => {
    const { data } = await sb.from('notificacoes').select('*').order('criado_em', { ascending: false }).limit(20);
    notifCache = data || [];
    renderNotifs();
    sb.channel('notifs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notificacoes', filter: `usuario_id=eq.${App.user.id}` }, (payload) => {
        notifCache.unshift(payload.new);
        renderNotifs();
        App.toast(payload.new.texto, 'info', 6000);
        if (Notification?.permission === 'granted' && App.profile.prefs?.push !== false) {
          try { new Notification('Renovar', { body: payload.new.texto }); } catch (_) {}
        }
      }).subscribe();
  };

  /* ---------- Roteador ---------- */
  App.route = (pattern, cfg2) => App.routes.push({ pattern, ...cfg2 });
  App.onLeave = (fn) => App._leaveFns.push(fn);
  App.go = (path) => { location.hash = path; };

  const matchRoute = (path) => {
    for (const r of App.routes) {
      const rx = new RegExp('^' + r.pattern.replace(/:[^/]+/g, '([^/]+)') + '$');
      const m = path.match(rx);
      if (m) {
        const keys = (r.pattern.match(/:[^/]+/g) || []).map(k => k.slice(1));
        const params = {};
        keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1]));
        return { route: r, params };
      }
    }
    return null;
  };

  App.homeRoute = () => App.role === 'aluno' ? '/perfil'
    : App.role === 'funcionario' ? '/projetos' : '/dashboard';

  const navigate = async () => {
    const path = location.hash.replace(/^#/, '') || App.homeRoute();
    const hit = matchRoute(path);
    if (!hit) { location.hash = App.homeRoute(); return; }
    const { route, params } = hit;
    if (route.roles && !route.roles.includes(App.role)) {
      App.toast('Você não tem permissão para acessar essa área.', 'error');
      location.hash = App.homeRoute();
      return;
    }
    App._leaveFns.forEach(fn => { try { fn(); } catch (_) {} });
    App._leaveFns = [];
    $('#page-title').textContent = route.title || 'Renovar';
    $$('.side-nav a').forEach(a => a.classList.toggle('active', a.dataset.base && path.startsWith(a.dataset.base)));
    const view = $('#view');
    view.innerHTML = '<div class="skel" style="height:120px"></div>';
    try {
      await route.render(params, view);
      if (window.gsap) gsap.fromTo(view.children, { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, stagger: 0.05, ease: 'power3.out', clearProps: 'all' });
    } catch (err) {
      console.error(err);
      view.innerHTML = `<div class="card"><h3>Ops, algo deu errado</h3><p style="color:var(--text-soft)">${esc(err.message)}</p></div>`;
    }
    $('#sidebar').classList.remove('open');
  };

  /* ---------- Sidebar ---------- */
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>',
    plan: '<path d="M12 2 3 7l9 5 9-5-9-5ZM3 12l9 5 9-5M3 17l9 5 9-5"/>',
    money: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M15 9.5c0-1.4-1.3-2-3-2s-3 .6-3 2 1.2 1.8 3 2.2 3 .9 3 2.3-1.3 2-3 2-3-.6-3-2"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
    report: '<path d="M6 2h9l5 5v15H6zM14 2v6h6M9 13h6M9 17h6"/>',
    kanban: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="10" rx="1.5"/><rect x="17" y="4" width="4" height="13" rx="1.5"/>',
    wiki: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15ZM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
    chatb: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.8L3 20l1-4.9a8.4 8.4 0 1 1 17-3.6Z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2A1.7 1.7 0 0 0 4.7 8.6a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1Z"/>',
    shield: '<path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Z"/>',
  };
  const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;

  const buildSidebar = () => {
    const r = App.role;
    const groups = [];
    if (r === 'aluno') {
      groups.push(['Minha área', [
        ['/perfil', 'home', 'Meu painel'],
        ['/consultas', 'cal', 'Minhas consultas'],
        ['/planos', 'plan', 'Planos'],
        ['/financeiro', 'money', 'Financeiro'],
      ]]);
    }
    if (['gerente', 'admin'].includes(r)) {
      groups.push(['Gestão', [
        ['/dashboard', 'chart', 'Dashboard'],
        ['/relatorios', 'report', 'Relatórios'],
      ]]);
    }
    if (['funcionario', 'gerente', 'admin'].includes(r)) {
      groups.push(['Operação', [
        ['/projetos', 'kanban', 'Projetos & Tarefas'],
        ['/wiki', 'wiki', 'Base de Conhecimento'],
        ['/atendimento', 'chatb', 'Atendimento'],
      ]]);
    }
    if (r === 'admin') groups.push(['Conta', [['/admin', 'shield', 'Administração']]]);

    $('#side-nav').innerHTML = groups.map(([g, items]) =>
      `<span class="nav-group">${g}</span>` +
      items.map(([path, ic, label]) => `<a href="#${path}" data-base="${path}">${icon(ic)}${label}</a>`).join('')
    ).join('');
  };

  const ROLE_LABEL = { admin: 'Admin', gerente: 'Gerente', funcionario: 'Equipe', aluno: 'Aluno' };

  /* ---------- Menu do perfil (avatar do topo) ---------- */
  const buildProfileMenu = () => {
    $('#profile-avatar-lg').outerHTML = App.avatarHtml(App.profile).replace('class="avatar"', 'class="avatar" id="profile-avatar-lg"');
    $('#profile-name').textContent = (App.profile.full_name || 'Usuário').split(' ').slice(0, 2).join(' ');
    $('#profile-role').textContent = ROLE_LABEL[App.role];
    $('#profile-email').textContent = App.profile.email;

    const panel = $('#profile-panel');
    $('#btn-profile').onclick = (e) => {
      e.stopPropagation();
      panel.hidden = !panel.hidden;
      $('#btn-profile').setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) $('#notif-panel').hidden = true;
    };
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.profile-wrap')) panel.hidden = true;
    });

    const goTo = (path) => { panel.hidden = true; App.go(path); };
    $('#pf-ver-perfil').onclick = () => goTo('/config');
    $('#pf-config').onclick = () => goTo('/config');
    $('#pf-trocar').onclick = async () => { await sb.auth.signOut(); location.href = './?login=1'; };
    $('#pf-sair').onclick = async () => { await sb.auth.signOut(); location.replace('index.html'); };
  };

  /* ---------- 2FA (gate de verificação no login) ---------- */
  const mfaGate = () => new Promise((resolve) => {
    const gate = $('#gate');
    gate.innerHTML = `<div class="gate-card">
      <div class="gate-logo">r</div>
      <h2>Verificação em duas etapas</h2>
      <p>Digite o código de 6 dígitos do seu aplicativo autenticador.</p>
      <input id="mfa-code" inputmode="numeric" maxlength="6" placeholder="••••••" autocomplete="one-time-code" />
      <button class="btn btn-primary btn-block" id="mfa-go">Verificar</button>
      <button class="btn btn-ghost btn-block" id="mfa-out" style="margin-top:.5rem">Sair</button>
    </div>`;
    const verify = async () => {
      const code = $('#mfa-code').value.trim();
      if (code.length !== 6) return App.toast('Digite os 6 dígitos.', 'error');
      const { data: factors } = await sb.auth.mfa.listFactors();
      const totp = factors?.totp?.[0];
      if (!totp) return resolve(true);
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: totp.id, code });
      if (error) return App.toast('Código inválido. Tente novamente.', 'error');
      resolve(true);
    };
    $('#mfa-go').onclick = verify;
    $('#mfa-code').onkeydown = (e) => e.key === 'Enter' && verify();
    $('#mfa-out').onclick = async () => { await sb.auth.signOut(); location.replace('index.html'); };
    setTimeout(() => $('#mfa-code').focus(), 100);
  });

  /* ---------- Boot ---------- */
  document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.replace('index.html'); return; }
    App.user = session.user;

    // exige o segundo fator quando o usuário tem 2FA ativado
    try {
      const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') await mfaGate();
    } catch (_) { /* MFA indisponível: segue sem o gate */ }

    const { data: profile } = await sb.from('profiles').select('*').eq('id', App.user.id).single();
    App.profile = profile || { full_name: App.user.email, email: App.user.email, role: 'aluno', prefs: {} };
    App.role = App.profile.role;

    buildSidebar();
    $('#top-avatar').outerHTML = App.avatarHtml(App.profile).replace('class="avatar"', 'class="avatar" id="top-avatar"');
    buildProfileMenu();
    initNotifs();

    // topo: tema, menu mobile, sino
    $('#btn-theme').onclick = App.toggleTheme;
    $('#btn-menu').onclick = () => $('#sidebar').classList.toggle('open');
    $('#btn-bell').onclick = (e) => { e.stopPropagation(); $('#notif-panel').hidden = !$('#notif-panel').hidden; if (!$('#notif-panel').hidden) $('#profile-panel').hidden = true; };
    document.addEventListener('click', (e) => { if (!e.target.closest('.notif-wrap')) $('#notif-panel').hidden = true; });
    sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') location.replace('index.html'); });

    window.addEventListener('hashchange', navigate);
    $('#gate').remove();
    navigate();
    document.dispatchEvent(new CustomEvent('app:ready'));
  });

  return App;
})();
