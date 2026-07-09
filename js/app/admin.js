// ============================================================
// Renovar — Configurações do usuário (perfil, foto, notificações,
// 2FA TOTP real via Supabase) + Painel de Administração (RBAC)
// ============================================================
(() => {
  'use strict';
  const { sb, $, $$, esc, toast, modal, confirm: confirmDlg } = App;

  /* ================= CONFIGURAÇÕES ================= */
  App.route('/config', {
    title: 'Configurações',
    async render(_, view) {
      const p = App.profile;
      const { data: factors } = await sb.auth.mfa.listFactors().catch(() => ({ data: null }));
      const totp = factors?.totp?.find(f => f.status === 'verified');

      view.innerHTML = `
        <div class="view-head"><div><h2>Configurações</h2><p>Seu perfil, preferências e segurança.</p></div></div>
        <div class="grid-2" style="align-items:start">
          <div class="card">
            <h3>Perfil</h3>
            <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.1rem">
              ${App.avatarHtml(p).replace('class="avatar"', 'class="avatar" id="cfg-avatar" style="width:72px;height:72px;font-size:1.5rem"')}
              <div>
                <label class="btn btn-ghost btn-sm" style="cursor:pointer">📷 Trocar foto<input type="file" id="cfg-foto" accept="image/*" hidden></label>
                <p style="font-size:.78rem;color:var(--text-soft);margin-top:.4rem">JPG/PNG até 10 MB.</p>
              </div>
            </div>
            <form id="f-perfil">
              <div class="field"><label>Nome completo</label><input id="cfg-nome" value="${esc(p.full_name)}" required maxlength="120"></div>
              <div class="field"><label>Telefone</label><input id="cfg-fone" value="${esc(p.phone)}" maxlength="20"></div>
              <div class="field"><label>E-mail</label><input value="${esc(p.email)}" disabled style="opacity:.6"></div>
              <button class="btn btn-primary">Salvar perfil</button>
            </form>
          </div>
          <div>
            <div class="card">
              <h3>Notificações</h3>
              <label class="check-item" style="margin-bottom:.5rem"><input type="checkbox" id="cfg-push" ${p.prefs?.push !== false ? 'checked' : ''}><span>Notificações no navegador (push) quando eu for mencionado</span></label>
              <label class="check-item"><input type="checkbox" id="cfg-mail" ${p.prefs?.email ? 'checked' : ''}><span>Resumo por e-mail <small style="color:var(--text-soft)">(requer servidor de e-mail — em breve)</small></span></label>
              <p style="font-size:.8rem;color:var(--text-soft);margin-top:.7rem">Permissão do navegador: <strong id="cfg-perm">${typeof Notification !== 'undefined' ? Notification.permission : 'não suportado'}</strong>
              ${typeof Notification !== 'undefined' && Notification.permission === 'default' ? '<button class="btn btn-ghost btn-sm" id="cfg-pedir" style="margin-left:.5rem">Permitir</button>' : ''}</p>
            </div>
            <div class="card" style="margin-top:1.2rem">
              <h3>🔐 Autenticação em duas etapas (2FA)</h3>
              ${totp
                ? `<p style="font-size:.9rem;margin-bottom:.9rem"><span class="tag tag-ok">✓ ativada</span> Sua conta pede um código do app autenticador a cada login.</p>
                   <button class="btn btn-danger btn-sm" id="mfa-off">Desativar 2FA</button>`
                : `<p style="font-size:.9rem;color:var(--text-soft);margin-bottom:.9rem">Proteja sua conta com um código do Google Authenticator, 1Password ou similar.</p>
                   <button class="btn btn-primary btn-sm" id="mfa-on">Ativar 2FA</button>`}
            </div>
            <div class="card" style="margin-top:1.2rem">
              <h3>Aparência</h3>
              <button class="btn btn-ghost" id="cfg-tema">Alternar tema claro/escuro</button>
            </div>
          </div>
        </div>`;

      /* perfil */
      $('#f-perfil', view).onsubmit = async (e) => {
        e.preventDefault();
        const full_name = $('#cfg-nome', view).value.trim();
        const phone = $('#cfg-fone', view).value.trim();
        const { error } = await sb.from('profiles').update({ full_name, phone }).eq('id', App.user.id);
        if (error) return toast('Erro ao salvar.', 'error');
        await sb.auth.updateUser({ data: { full_name, phone } });
        App.profile.full_name = full_name; App.profile.phone = phone;
        toast('Perfil atualizado. ✓', 'success');
      };

      /* foto */
      $('#cfg-foto', view).onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) return toast('Imagem acima de 10 MB.', 'error');
        const path = `${App.user.id}/avatar-${Date.now()}.${file.name.split('.').pop()}`;
        const { error } = await sb.storage.from('avatars').upload(path, file, { upsert: true });
        if (error) return toast('Falha no upload: ' + error.message, 'error');
        const { data: pub } = sb.storage.from('avatars').getPublicUrl(path);
        await sb.from('profiles').update({ avatar_url: pub.publicUrl }).eq('id', App.user.id);
        App.profile.avatar_url = pub.publicUrl;
        toast('Foto atualizada! 📸', 'success');
        this.render(_, view);
      };

      /* notificações */
      const salvaPrefs = async () => {
        const prefs = { ...(App.profile.prefs || {}), push: $('#cfg-push', view).checked, email: $('#cfg-mail', view).checked };
        await sb.from('profiles').update({ prefs }).eq('id', App.user.id);
        App.profile.prefs = prefs;
        toast('Preferências salvas. ✓', 'success');
      };
      $('#cfg-push', view).onchange = salvaPrefs;
      $('#cfg-mail', view).onchange = salvaPrefs;
      const pedir = $('#cfg-pedir', view);
      if (pedir) pedir.onclick = async () => {
        const r = await Notification.requestPermission();
        $('#cfg-perm', view).textContent = r;
        if (r === 'granted') toast('Push habilitado no navegador. 🔔', 'success');
      };

      $('#cfg-tema', view).onclick = App.toggleTheme;

      /* 2FA */
      const on = $('#mfa-on', view);
      if (on) on.onclick = async () => {
        const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Renovar App' });
        if (error) return toast('2FA indisponível: ' + error.message, 'error');
        const m = modal(`<h3>Ativar 2FA</h3>
          <p style="font-size:.9rem;color:var(--text-soft);margin-bottom:.9rem">1. Escaneie o QR code no seu app autenticador.<br>2. Digite o código de 6 dígitos para confirmar.</p>
          <div style="display:grid;place-items:center;background:#fff;border-radius:16px;padding:1rem;margin-bottom:.9rem">${data.totp.qr_code.startsWith('data:') ? `<img src="${data.totp.qr_code}" width="190" alt="QR code 2FA">` : data.totp.qr_code}</div>
          <p style="font-size:.78rem;color:var(--text-soft);word-break:break-all;margin-bottom:.9rem">Chave manual: <code>${esc(data.totp.secret)}</code></p>
          <div class="field"><input id="mfa-code" inputmode="numeric" maxlength="6" placeholder="000000" style="text-align:center;letter-spacing:.4em;font-weight:800;font-size:1.2rem"></div>
          <button class="btn btn-primary btn-block" id="mfa-verify">Confirmar e ativar</button>`);
        m.el.querySelector('#mfa-verify').onclick = async () => {
          const code = m.el.querySelector('#mfa-code').value.trim();
          const { error: err } = await sb.auth.mfa.challengeAndVerify({ factorId: data.id, code });
          if (err) return toast('Código inválido — confira o app.', 'error');
          m.close(); toast('2FA ativada! Sua conta está mais segura. 🔐', 'success');
          this.render(_, view);
        };
      };
      const off = $('#mfa-off', view);
      if (off) off.onclick = async () => {
        if (!await confirmDlg('Desativar a verificação em duas etapas?')) return;
        await sb.auth.mfa.unenroll({ factorId: totp.id });
        toast('2FA desativada.', 'success');
        this.render(_, view);
      };
    },
  });

  /* ================= ADMINISTRAÇÃO (RBAC) ================= */
  App.route('/admin', {
    title: 'Administração', roles: ['admin'],
    async render(_, view) {
      const { data: users } = await sb.from('profiles').select('*').order('role').order('full_name');
      const ROLES = [['admin', 'Admin'], ['gerente', 'Gerente'], ['funcionario', 'Funcionário'], ['aluno', 'Aluno']];
      const contag = Object.fromEntries(ROLES.map(([r]) => [r, (users || []).filter(u => u.role === r).length]));

      view.innerHTML = `
        <div class="view-head"><div>
          <h2>Painel de Administração</h2>
          <p>Controle de permissões por cargo (RBAC). Alterações valem no próximo carregamento da sessão do usuário.</p>
        </div></div>
        <div class="grid-4" style="margin-bottom:1.2rem">${ROLES.map(([r, l]) => `
          <div class="card kpi"><span class="kpi-label">${l}s</span><span class="kpi-value">${contag[r]}</span></div>`).join('')}</div>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>Usuário</th><th>E-mail</th><th>Telefone</th><th>Cargo</th></tr></thead>
          <tbody>${(users || []).map(u => `<tr>
            <td style="display:flex;align-items:center;gap:.6rem">${App.avatarHtml(u).replace('class="avatar"', 'class="avatar" style="width:32px;height:32px;font-size:.72rem"')}<strong>${esc(u.full_name || '—')}</strong>${u.id === App.user.id ? ' <span class="tag tag-brand">você</span>' : ''}</td>
            <td>${esc(u.email)}</td><td>${esc(u.phone || '—')}</td>
            <td><select data-user="${u.id}" ${u.id === App.user.id ? 'disabled title="Você não pode alterar o próprio cargo"' : ''} style="font:inherit;font-size:.86rem;padding:.4rem .6rem;border-radius:10px;border:1.5px solid var(--line);background:var(--surface);color:var(--text)">
              ${ROLES.map(([r, l]) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${l}</option>`).join('')}
            </select></td>
          </tr>`).join('')}</tbody>
        </table></div>
        <div class="card" style="margin-top:1.2rem">
          <h3>Matriz de permissões</h3>
          <div class="table-wrap"><table class="tbl">
            <thead><tr><th>Área</th><th>Admin</th><th>Gerente</th><th>Funcionário</th><th>Aluno</th></tr></thead>
            <tbody>
              <tr><td>Dashboard & Relatórios</td><td>✅</td><td>✅</td><td>—</td><td>—</td></tr>
              <tr><td>Projetos, Wiki, Atendimento</td><td>✅</td><td>✅</td><td>✅</td><td>—</td></tr>
              <tr><td>Consultas, Planos, Financeiro pessoal</td><td>—</td><td>—</td><td>—</td><td>✅</td></tr>
              <tr><td>Administração (cargos)</td><td>✅</td><td>—</td><td>—</td><td>—</td></tr>
            </tbody>
          </table></div>
          <p style="font-size:.82rem;color:var(--text-soft);margin-top:.7rem">🔒 As permissões também são aplicadas no banco (políticas RLS) — esconder o menu é cosmético; o servidor é quem manda.</p>
        </div>`;

      $$('[data-user]', view).forEach(sel => sel.onchange = async () => {
        const u = users.find(x => x.id === sel.dataset.user);
        if (!await confirmDlg(`Mudar o cargo de ${u.full_name || u.email} para "${sel.options[sel.selectedIndex].text}"?`)) {
          sel.value = u.role; return;
        }
        const { error } = await sb.from('profiles').update({ role: sel.value }).eq('id', u.id);
        if (error) { sel.value = u.role; return toast('Erro: ' + error.message, 'error'); }
        u.role = sel.value;
        App.notify(u.id, `Seu cargo no sistema mudou para ${sel.options[sel.selectedIndex].text}.`, '/config');
        toast('Cargo atualizado. ✓', 'success');
      });
    },
  });
})();
