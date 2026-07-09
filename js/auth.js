// ============================================================
// Renovar Pilates — Autenticação e dados (Supabase, licença MIT)
// Registro, login, recuperação de senha e formulário de contato.
// ============================================================
(() => {
  'use strict';

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
  const toast = (...args) => window.toast && window.toast(...args);

  /* ---------- Cliente Supabase ---------- */
  const cfg = window.APP_CONFIG || {};
  let sb = null;

  const configOk =
    typeof window.supabase !== 'undefined' &&
    /^https:\/\/.+\.supabase\.co$/.test(cfg.SUPABASE_URL || '') &&
    typeof cfg.SUPABASE_ANON_KEY === 'string' &&
    cfg.SUPABASE_ANON_KEY.length > 20;

  // trava de segurança: nunca aceitar uma chave secreta no navegador
  const looksSecret =
    (cfg.SUPABASE_ANON_KEY || '').startsWith('sb_secret_') ||
    (cfg.SUPABASE_ANON_KEY || '').includes('service_role');

  if (configOk && !looksSecret) {
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  } else if (looksSecret) {
    console.error('[Renovar] Chave SECRETA detectada em js/config.js — troque pela publishable/anon key.');
  } else {
    console.warn('[Renovar] Supabase não configurado — login e formulários ficam desativados.');
  }

  const requireBackend = () => {
    if (sb) return true;
    toast('Estamos em manutenção — tente novamente mais tarde.', 'error');
    return false;
  };

  /* ---------- Mensagens de erro em português ---------- */
  const translateError = (message = '') => {
    const msg = message.toLowerCase();
    if (msg.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
    if (msg.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.';
    if (msg.includes('already registered') || msg.includes('already been registered'))
      return 'Este e-mail já possui cadastro. Tente entrar ou recuperar a senha.';
    if (msg.includes('password should be at least')) return 'A senha precisa ter pelo menos 8 caracteres.';
    if (msg.includes('rate limit') || msg.includes('too many requests'))
      return 'Muitas tentativas. Aguarde alguns instantes e tente de novo.';
    if (msg.includes('invalid email') || msg.includes('unable to validate email'))
      return 'Digite um e-mail válido.';
    if (msg.includes('network') || msg.includes('fetch')) return 'Falha de conexão. Verifique sua internet.';
    return 'Algo deu errado. Tente novamente em instantes.';
  };

  /* ---------- Modal: abrir / fechar / abas ---------- */
  const modal = $('#auth-modal');
  const tabs = $('#auth-tabs');
  const tabLogin = $('#tab-login');
  const tabRegister = $('#tab-register');
  const formLogin = $('#form-login');
  const formRegister = $('#form-register');
  const formForgot = $('#form-forgot');
  const successBox = $('#auth-success');
  const modalTitle = $('#auth-title');
  const modalSubtitle = $('#auth-subtitle');

  let recoveryMode = false; // true quando o usuário chega pelo link de redefinição

  const showPane = (pane) => {
    [formLogin, formRegister, formForgot, successBox].forEach((el) => (el.hidden = el !== pane));
    tabs.hidden = pane === formForgot || pane === successBox;
    if (pane === formLogin) {
      tabs.classList.remove('tab-register');
      tabLogin.setAttribute('aria-selected', 'true');
      tabRegister.setAttribute('aria-selected', 'false');
      modalTitle.textContent = 'Área do aluno';
      modalSubtitle.textContent = 'Acesse sua conta ou crie um cadastro gratuito.';
    } else if (pane === formRegister) {
      tabs.classList.add('tab-register');
      tabLogin.setAttribute('aria-selected', 'false');
      tabRegister.setAttribute('aria-selected', 'true');
      modalTitle.textContent = 'Criar conta';
      modalSubtitle.textContent = 'Leva menos de um minuto — e é grátis.';
    } else if (pane === formForgot) {
      modalTitle.textContent = recoveryMode ? 'Nova senha' : 'Recuperar senha';
      modalSubtitle.textContent = recoveryMode
        ? 'Defina sua nova senha de acesso.'
        : 'Enviaremos um link de redefinição para o seu e-mail.';
    }
  };

  const openModal = (pane = formLogin) => {
    showPane(pane);
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    if (window.gsap) {
      gsap.fromTo('.modal-backdrop', { opacity: 0 }, { opacity: 1, duration: 0.3 });
      gsap.fromTo(
        '.modal-card',
        { y: 34, opacity: 0, scale: 0.97 },
        { y: 0, opacity: 1, scale: 1, duration: 0.45, ease: 'power3.out' }
      );
    }
    setTimeout(() => pane.querySelector('input')?.focus(), 80);
  };

  const closeModal = () => {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  };

  $('#btn-auth')?.addEventListener('click', () => openModal());
  $('#btn-auth-mobile')?.addEventListener('click', () => {
    $('#nav-toggle')?.click(); // fecha o menu mobile
    openModal();
  });
  $$('[data-close-modal]').forEach((el) => el.addEventListener('click', closeModal));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
  });

  tabLogin.addEventListener('click', () => showPane(formLogin));
  tabRegister.addEventListener('click', () => showPane(formRegister));
  $('#link-forgot').addEventListener('click', () => showPane(formForgot));
  $('#link-back-login').addEventListener('click', () => {
    recoveryMode = false;
    resetForgotForm();
    showPane(formLogin);
  });

  const showSuccess = (title, message) => {
    $('#auth-success-title').textContent = title;
    $('#auth-success-message').textContent = message;
    showPane(successBox);
  };

  /* ---------- Mostrar/ocultar senha ---------- */
  $$('.toggle-password').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = btn.parentElement.querySelector('input');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.classList.toggle('showing', show);
      btn.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
    });
  });

  /* ---------- Medidor de força da senha ---------- */
  const strengthBar = $('#password-strength');
  const strengthHint = $('#password-hint');
  const passwordScore = (value) => {
    let score = 0;
    if (value.length >= 8) score++;
    if (value.length >= 12) score++;
    if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
    if (/\d/.test(value) && /[^a-zA-Z0-9]/.test(value)) score++;
    return score;
  };

  $('#reg-password')?.addEventListener('input', (e) => {
    const score = passwordScore(e.target.value);
    strengthBar.className = `password-strength s${score}`;
    const labels = [
      'Use pelo menos 8 caracteres, com letras e números.',
      'Senha fraca — adicione mais caracteres.',
      'Senha razoável — misture maiúsculas e minúsculas.',
      'Boa senha!',
      'Senha excelente.',
    ];
    strengthHint.textContent = labels[score];
  });

  /* ---------- Máscara simples de telefone ---------- */
  const maskPhone = (input) => {
    input.addEventListener('input', () => {
      const digits = input.value.replace(/\D/g, '').slice(0, 11);
      let out = digits;
      if (digits.length > 2) out = `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
      if (digits.length > 7) out = `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
      input.value = out;
    });
  };
  ['#reg-phone', '#contact-phone'].forEach((sel) => $(sel) && maskPhone($(sel)));

  /* ---------- Estado de sessão na interface ---------- */
  const updateUserUI = (session) => {
    const logged = Boolean(session?.user);
    $('#btn-auth').style.display = logged ? 'none' : '';
    $('#btn-auth-mobile').style.display = logged ? 'none' : '';
    $('#user-menu').hidden = !logged;
    if (logged) {
      const meta = session.user.user_metadata || {};
      const name = (meta.full_name || session.user.email || 'Aluno').trim();
      const firstName = name.split(/\s+/)[0];
      $('#user-name').textContent = firstName;
      $('#user-avatar').textContent = firstName.charAt(0).toUpperCase();
      $('#user-email').textContent = session.user.email;
    }
  };

  const userChip = $('#user-chip');
  const userDropdown = $('#user-dropdown');
  userChip?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = userDropdown.hidden;
    userDropdown.hidden = !open;
    userChip.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', () => {
    if (userDropdown && !userDropdown.hidden) userDropdown.hidden = true;
  });

  /* ---------- Fluxos de autenticação ---------- */
  const setLoading = (form, loading) => {
    const btn = form.querySelector('button[type="submit"]');
    if (!btn) return;
    btn.disabled = loading;
    if (loading) {
      btn.dataset.label = btn.textContent;
      btn.textContent = 'Aguarde…';
    } else if (btn.dataset.label) {
      btn.textContent = btn.dataset.label;
    }
  };

  // LOGIN
  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!requireBackend()) return;
    const email = $('#login-email').value.trim();
    const password = $('#login-password').value;
    if (!email || !password) return toast('Preencha e-mail e senha.', 'error');

    setLoading(formLogin, true);
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setLoading(formLogin, false);

    if (error) return toast(translateError(error.message), 'error');
    formLogin.reset();
    // entra direto no sistema (área do aluno / painel da equipe)
    window.location.href = 'app.html';
  });

  // REGISTRO
  formRegister.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!requireBackend()) return;
    const fullName = $('#reg-name').value.trim();
    const email = $('#reg-email').value.trim();
    const phone = $('#reg-phone').value.trim();
    const plan = $('#reg-plan').value;
    const password = $('#reg-password').value;

    if (fullName.length < 2) return toast('Digite seu nome completo.', 'error');
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Digite um e-mail válido.', 'error');
    if (password.length < 8) return toast('A senha precisa ter pelo menos 8 caracteres.', 'error');
    if (!/[a-zA-Z]/.test(password) || !/\d/.test(password))
      return toast('Use letras e números na senha.', 'error');

    setLoading(formRegister, true);
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, phone, plan },
        emailRedirectTo: window.location.origin + window.location.pathname,
      },
    });
    setLoading(formRegister, false);

    if (error) return toast(translateError(error.message), 'error');

    formRegister.reset();
    strengthBar.className = 'password-strength';

    if (data.session) {
      // confirmação de e-mail desativada no projeto: já entra direto
      window.location.href = 'app.html';
    } else {
      showSuccess(
        'Confira seu e-mail 📬',
        `Enviamos um link de confirmação para ${email}. Clique nele para ativar sua conta e depois faça login.`
      );
    }
  });

  // RECUPERAR SENHA / DEFINIR NOVA SENHA
  const forgotInput = $('#forgot-email');
  const forgotLabel = formForgot.querySelector('label');
  const forgotButton = formForgot.querySelector('button[type="submit"]');

  const resetForgotForm = () => {
    forgotLabel.textContent = 'E-mail cadastrado';
    forgotInput.type = 'email';
    forgotInput.placeholder = 'voce@email.com';
    forgotButton.textContent = 'Enviar link de recuperação';
    formForgot.reset();
  };

  const enterRecoveryMode = () => {
    recoveryMode = true;
    forgotLabel.textContent = 'Nova senha';
    forgotInput.type = 'password';
    forgotInput.placeholder = 'Mínimo 8 caracteres';
    forgotButton.textContent = 'Salvar nova senha';
    openModal(formForgot);
  };

  formForgot.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!requireBackend()) return;

    if (recoveryMode) {
      const newPassword = forgotInput.value;
      if (newPassword.length < 8) return toast('A senha precisa ter pelo menos 8 caracteres.', 'error');
      setLoading(formForgot, true);
      const { error } = await sb.auth.updateUser({ password: newPassword });
      setLoading(formForgot, false);
      if (error) return toast(translateError(error.message), 'error');
      recoveryMode = false;
      resetForgotForm();
      showSuccess('Senha atualizada ✓', 'Sua nova senha já está valendo. Bons treinos!');
      return;
    }

    const email = forgotInput.value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Digite um e-mail válido.', 'error');
    setLoading(formForgot, true);
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname,
    });
    setLoading(formForgot, false);
    if (error) return toast(translateError(error.message), 'error');
    showSuccess(
      'Link enviado 📬',
      `Se ${email} estiver cadastrado, você receberá um link para redefinir a senha.`
    );
  });

  // LOGOUT
  $('#btn-logout')?.addEventListener('click', async () => {
    if (!sb) return;
    await sb.auth.signOut();
    toast('Você saiu da conta. Até a próxima aula! 👋', 'success');
  });

  /* ---------- Sessão: estado inicial + mudanças ---------- */
  if (sb) {
    sb.auth.getSession().then(({ data }) => updateUserUI(data.session));
    sb.auth.onAuthStateChange((event, session) => {
      updateUserUI(session);
      if (event === 'SIGNED_IN' && session && !modal.classList.contains('open')) {
        const name = session.user.user_metadata?.full_name || '';
        // evita toast duplicado em cada refresh: só saúda logins "novos"
        if (sessionStorage.getItem('renovar-greeted') !== session.user.id) {
          sessionStorage.setItem('renovar-greeted', session.user.id);
          toast(`Olá${name ? ', ' + name.split(' ')[0] : ''}! Login realizado.`, 'success');
        }
      }
      if (event === 'PASSWORD_RECOVERY') enterRecoveryMode();
      if (event === 'SIGNED_OUT') sessionStorage.removeItem('renovar-greeted');
    });
  }

  // vindo de "Trocar de conta" no sistema interno: abre o login direto
  if (new URLSearchParams(location.search).get('login') === '1') {
    openModal(formLogin);
    history.replaceState(null, '', location.pathname);
  }

  /* ---------- Formulário de contato → tabela contact_messages ---------- */
  const formContact = $('#form-contact');
  formContact?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#contact-name').value.trim();
    const email = $('#contact-email').value.trim();
    const phone = $('#contact-phone').value.trim();
    const interest = $('#contact-interest').value;
    const message = $('#contact-message').value.trim();

    if (name.length < 2) return toast('Digite seu nome.', 'error');
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Digite um e-mail válido.', 'error');
    if (!interest) return toast('Selecione o serviço de interesse.', 'error');

    if (!requireBackend()) return;
    setLoading(formContact, true);
    const { error } = await sb.from('contact_messages').insert({
      name,
      email,
      phone: phone || null,
      interest,
      message: message || null,
    });
    setLoading(formContact, false);

    if (error) {
      console.error('[Renovar] contato:', error);
      return toast('Não foi possível enviar agora. Chame a gente no WhatsApp!', 'error');
    }
    formContact.reset();
    toast('Mensagem enviada! Retornamos em até 1 dia útil. 🧡', 'success', 6000);
  });
})();
