/* Página de login + questionário pós-cadastro.
   Flow: login/cadastro -> se novo usuário -> questionário -> dashboard.
   Usuário existente (flag no localStorage) pula o questionário.
   Nenhum backend real: usa localStorage para simular estado. */
(function () {
  'use strict';

  var svg = function (cls, inner) { return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-' + cls + '" aria-hidden="true">' + inner + '</svg>'; };
  var ICON = {
    arrowRight: svg('arrow-right', '<path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path>'),
    arrowLeft: svg('arrow-left', '<path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path>'),
    mail: svg('mail', '<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"></path><rect x="2" y="4" width="20" height="16" rx="2"></rect>'),
    user: svg('user-round', '<circle cx="12" cy="8" r="5"></circle><path d="M20 21a8 8 0 0 0-16 0"></path>'),
    eye: svg('eye', '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"></path><circle cx="12" cy="12" r="3"></circle>'),
    eyeOff: svg('eye-off', '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"></path><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"></path><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"></path><path d="m2 2 20 20"></path>'),
    check: svg('check', '<path d="M20 6 9 17l-5-5"></path>'),
    chevronDown: svg('chevron-down', '<path d="m6 9 6 6 6-6"></path>'),
    loader: svg('loader', '<path d="M12 2v4"></path><path d="M12 18v4"></path><path d="M4.93 4.93l2.83 2.83"></path><path d="M16.24 16.24l2.83 2.83"></path><path d="M2 12h4"></path><path d="M18 12h4"></path><path d="M4.93 19.07l2.83-2.83"></path><path d="M16.24 7.76l2.83-2.83"></path>')
  };

  var STORAGE_KEYS = {
    USER_DATA: 'sideral_user_data',
    HAS_SEEN_QUESTIONNAIRE: 'sideral_questionnaire_done'
  };

  function getUserData() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.USER_DATA) || 'null'); } catch { return null; }
  }
  function setUserData(data) { localStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify(data)); }
  function hasCompletedQuestionnaire() { return localStorage.getItem(STORAGE_KEYS.HAS_SEEN_QUESTIONNAIRE) === 'true'; }
  function markQuestionnaireDone() { localStorage.setItem(STORAGE_KEYS.HAS_SEEN_QUESTIONNAIRE, 'true'); }

  var words = ['WRF', 'SKEW T', 'MODELOS NUMERICOS', 'PREVISÃO', 'METEOROLOGIA'];
  var wordEl = document.getElementById('typing-word');
  var cursorEl = document.querySelector('.typing-cursor');
  var state = { wordIndex: 0, length: 3, deleting: false };
  var timer = null;
  var motion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function render() { wordEl.textContent = words[state.wordIndex].slice(0, state.length); }
  function tick() {
    var word = words[state.wordIndex];
    var complete = state.length === word.length;
    var delay = !state.deleting && complete ? 1800 : state.deleting ? 55 : 110;
    timer = setTimeout(function () {
      if (!state.deleting && complete) state.deleting = true;
      else if (state.deleting && state.length === 0) { state.wordIndex = (state.wordIndex + 1) % words.length; state.deleting = false; }
      else state.length += state.deleting ? -1 : 1;
      render(); tick();
    }, delay);
  }
  function applyMotion() {
    clearTimeout(timer);
    if (motion.matches) { wordEl.textContent = 'METEOROLOGIA'; cursorEl.style.display = 'none'; }
    else { cursorEl.style.display = ''; render(); tick(); }
  }
  applyMotion();
  if (motion.addEventListener) motion.addEventListener('change', applyMotion);

  var mode = 'signup';
  var dialog = null;
  var questionnaireDialog = null;

  function openPanel(next) {
    mode = next;
    if (dialog) return;
    dialog = SideralDialog.open({
      className: 'login-panel',
      overlayClassName: 'login-overlay',
      onClose: function () { dialog = null; },
      content: '' +
        '<div class="dialog-header"><div class="login-panel-brand"><img class="brand-mark" alt="" width="64" height="64" src="assets/sideral-symbol.png"></div>' +
        '<h2 class="dialog-title"></h2><p class="dialog-description"></p></div>' +
        '<div class="login-providers">' +
          '<button class="btn btn-quiet btn-md login-provider" type="button" data-act="google"><span class="google-letter" aria-hidden="true">G</span>Continuar com Google' + ICON.arrowRight + '</button>' +
          '<button class="btn btn-quiet btn-md login-provider" type="button" data-act="account">' + ICON.mail + 'Conta Sideral' + ICON.arrowRight + '</button>' +
          '<button class="btn btn-navigation btn-md login-provider login-guest" type="button" data-act="guest">' + ICON.user + 'Continuar como convidado' + ICON.arrowRight + '</button>' +
        '</div>' +
        '<form class="login-form" hidden>' +
          '<button class="btn btn-navigation btn-md login-other" type="button" data-act="back">' + ICON.arrowLeft + 'Outras opções</button>' +
          '<label data-field="name">Nome<input autocomplete="name" placeholder="Seu nome" required name="name"></label>' +
          '<label>E-mail<input autocomplete="email" placeholder="voce@exemplo.com" required type="email" name="email"></label>' +
          '<label>Senha<span class="login-password"><input placeholder="Sua senha" minlength="6" required type="password" name="password">' +
            '<button class="btn btn-navigation btn-icon" type="button" data-act="toggle-password" aria-label="Mostrar senha">' + ICON.eye + '</button></span></label>' +
          '<button class="btn btn-sideral btn-md login-submit" type="submit"><span data-submit-label></span>' + ICON.arrowRight + '</button>' +
        '</form>' +
        '<p class="login-feedback" role="status" hidden></p>' +
        '<p class="login-switch"><span data-switch-text></span> <button class="btn btn-link btn-md" type="button" data-act="switch"></button></p>'
    });
    paint();
  }

  function q(sel, root) { return (root || dialog.el).querySelector(sel); }
  function feedback(text) { var p = q('.login-feedback'); p.textContent = text; p.hidden = !text; }

  function paint() {
    var signup = mode === 'signup';
    q('.dialog-title').textContent = signup ? 'Comece pela Sideral.' : 'Bem-vindo de volta.';
    q('.dialog-description').textContent = signup ? 'Crie sua conta ou continue como convidado.' : 'Entre na sua conta ou continue como convidado.';
    q('[data-field=name]').hidden = !signup;
    q('[data-field=name] input').required = signup;
    q('input[name=password]').autocomplete = signup ? 'new-password' : 'current-password';
    q('[data-submit-label]').textContent = signup ? 'Cadastrar-se' : 'Entrar';
    q('[data-switch-text]').textContent = signup ? 'Já tem uma conta?' : 'Não tem uma conta?';
    q('[data-act=switch]').textContent = signup ? 'Entre' : 'Cadastre-se';
  }

  function simulateAuth(email, name, isSignup) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        var userData = {
          email: email,
          name: name || email.split('@')[0],
          isNewUser: isSignup,
          timestamp: Date.now()
        };
        setUserData(userData);
        resolve(userData);
      }, 800);
    });
  }

  function showLoading(submitBtn, label) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = ICON.loader + '<span>' + label + '</span>';
    submitBtn.querySelector('svg').style.animation = 'spin 1s linear infinite';
  }
  function hideLoading(submitBtn, label, icon) {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>' + label + '</span>' + icon;
  }

  function onClick(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn || !dialog || !dialog.el.contains(btn)) return;
    var act = btn.getAttribute('data-act');
    if (act === 'google') {
      feedback('O acesso com Google ainda não está conectado.');
    } else if (act === 'guest') {
      var userData = { email: 'guest@sideral', name: 'Convidado', isNewUser: true, isGuest: true, timestamp: Date.now() };
      setUserData(userData);
      dialog.close();
      if (!hasCompletedQuestionnaire() && !userData.isGuest) {
        openQuestionnaire(userData);
      } else {
        redirectToDashboard();
      }
    } else if (act === 'account') {
      q('.login-providers').hidden = true;
      q('.login-form').hidden = false;
      feedback('');
    } else if (act === 'back') {
      q('.login-form').hidden = true;
      q('.login-providers').hidden = false;
      feedback('');
    } else if (act === 'switch') {
      mode = mode === 'signin' ? 'signup' : 'signin';
      feedback(''); paint();
    } else if (act === 'toggle-password') {
      var input = q('input[name=password]');
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
      btn.innerHTML = show ? ICON.eyeOff : ICON.eye;
    }
  }

  document.addEventListener('click', onClick);

  document.addEventListener('submit', function (e) {
    if (!dialog || !dialog.el.contains(e.target)) return;
    e.preventDefault();
    var form = e.target;
    var submitBtn = q('.login-submit', form);
    var nameInput = q('input[name=name]', form);
    var emailInput = q('input[name=email]', form);
    var passwordInput = q('input[name=password]', form);

    if (!emailInput.value || (mode === 'signup' && !nameInput.value)) {
      feedback('Preencha todos os campos obrigatórios.');
      return;
    }

    showLoading(submitBtn, mode === 'signup' ? 'Cadastrando...' : 'Entrando...');

    simulateAuth(emailInput.value, nameInput.value || null, mode === 'signup')
      .then(function (userData) {
        dialog.close();
        if (userData.isGuest) {
          redirectToDashboard();
        } else if (!hasCompletedQuestionnaire() && userData.isNewUser) {
          openQuestionnaire(userData);
        } else {
          redirectToDashboard();
        }
      })
      .catch(function () {
        hideLoading(submitBtn, mode === 'signup' ? 'Cadastrar-se' : 'Entrar', ICON.arrowRight);
        feedback('Erro ao processar. Tente novamente.');
      });
  });

  function openQuestionnaire(userData) {
    if (questionnaireDialog) return;
    var step = 1;
    var answers = { source: '', age: '', role: '' };

    function buildStep1() {
      return '' +
        '<div class="dialog-header"><h2 class="dialog-title">Antes de começar...</h2><p class="dialog-description">Responda rápido para personalizarmos sua experiência.</p></div>' +
        '<form class="questionnaire-form" data-step="1">' +
          '<div class="question-group">' +
            '<label class="question-label">Como conheceu a Sideral?</label>' +
            '<select name="source" required>' +
              '<option value="">Selecione</option>' +
              '<option value="google">Busca no Google</option>' +
              '<option value="indicacao">Indicação de colega/amigo</option>' +
              '<option value="redes_sociais">Redes sociais (Instagram, Twitter, LinkedIn)</option>' +
              '<option value="youtube">YouTube</option>' +
              '<option value="evento">Evento/Curso/Universidade</option>' +
              '<option value="outro">Outro</option>' +
            '</select>' +
          '</div>' +
          '<button class="btn btn-sideral btn-md questionnaire-next" type="submit">' + ICON.arrowRight + '</button>' +
        '</form>';
    }

    function buildStep2() {
      return '' +
        '<div class="dialog-header"><h2 class="dialog-title">Quase lá...</h2><p class="dialog-description">Mais duas perguntinhas.</p></div>' +
        '<form class="questionnaire-form" data-step="2">' +
          '<div class="question-group">' +
            '<label class="question-label">Qual sua idade?</label>' +
            '<input type="number" name="age" min="13" max="100" placeholder="Ex: 28" required>' +
          '</div>' +
          '<button class="btn btn-sideral btn-md questionnaire-next" type="submit">' + ICON.arrowRight + '</button>' +
        '</form>';
    }

    function buildStep3() {
      return '' +
        '<div class="dialog-header"><h2 class="dialog-title">Última pergunta</h2><p class="dialog-description">Qual seu perfil?</p></div>' +
        '<form class="questionnaire-form" data-step="3">' +
          '<div class="question-group">' +
            '<label class="question-label">Qual seu cargo/perfil?</label>' +
            '<select name="role" required>' +
              '<option value="">Selecione</option>' +
              '<option value="entusiasta">Entusiasta da meteorologia</option>' +
              '<option value="estudante">Estudante de meteorologia/ciências atmosféricas</option>' +
              '<option value="meteorologista">Meteorologista formado</option>' +
              '<option value="pesquisador">Pesquisador/Acadêmico</option>' +
              '<option value="profissional_correlato">Profissional de área correlata (Defesa Civil, Aviação, Agronomia, etc.)</option>' +
              '<option value="outro">Outro</option>' +
            '</select>' +
          '</div>' +
          '<button class="btn btn-sideral btn-md questionnaire-submit" type="submit">Finalizar ' + ICON.arrowRight + '</button>' +
        '</form>';
    }

    function openStep(stepNum) {
      var content = stepNum === 1 ? buildStep1() : stepNum === 2 ? buildStep2() : buildStep3();
      if (questionnaireDialog) {
        questionnaireDialog.el.innerHTML = content;
        var firstFocus = questionnaireDialog.el.querySelector('input, select, button');
        if (firstFocus) firstFocus.focus({ preventScroll: true });
        return;
      }
      questionnaireDialog = SideralDialog.open({
        className: 'login-panel questionnaire-panel',
        overlayClassName: 'login-overlay',
        onClose: function () { questionnaireDialog = null; },
        content: content
      });
    }

    function onQuestionnaireClick(e) {
      if (!questionnaireDialog) return;
      var btn = e.target.closest('[type=submit]');
      if (!btn || !questionnaireDialog.el.contains(btn)) return;
      e.preventDefault();
      var form = questionnaireDialog.el.querySelector('.questionnaire-form');
      var stepNum = parseInt(form.getAttribute('data-step'), 10);
      var inputs = form.querySelectorAll('input[required], select[required]');
      var valid = true;
      inputs.forEach(function (input) {
        if (!input.value) { input.style.borderColor = 'var(--brand-red)'; valid = false; }
        else input.style.borderColor = '';
      });
      if (!valid) return;

      if (stepNum === 1) {
        answers.source = form.querySelector('select[name=source]').value;
        openStep(2);
      } else if (stepNum === 2) {
        answers.age = form.querySelector('input[name=age]').value;
        openStep(3);
      } else if (stepNum === 3) {
        answers.role = form.querySelector('select[name=role]').value;
        finishQuestionnaire(userData, answers);
      }
    }

    function finishQuestionnaire(userData, answers) {
      userData.profile = answers;
      setUserData(userData);
      markQuestionnaireDone();
      questionnaireDialog.close();
      redirectToDashboard();
    }

    document.addEventListener('click', onQuestionnaireClick);
    openStep(1);
  }

  function redirectToDashboard() {
    showLoadingScreen();
    setTimeout(function () {
      window.location.href = 'dashboard.html';
    }, 1200);
  }

  function showLoadingScreen() {
    var overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.innerHTML = '' +
      '<div class="loading-content">' +
        '<div class="loading-spinner" aria-hidden="true"></div>' +
        '<p class="loading-text">Carregando sua experiência...</p>' +
      '</div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('visible'); });
  }

  document.getElementById('start-btn').addEventListener('click', function () { openPanel('signup'); });
  document.getElementById('signin-btn').addEventListener('click', function () { openPanel('signin'); });
})();

if (!document.getElementById('spin-style')) {
  var style = document.createElement('style');
  style.id = 'spin-style';
  style.textContent = '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
}