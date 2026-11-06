/* Diálogo modal acessível (substitui @radix-ui/react-dialog).
   Comportamento: foco no primeiro elemento focável, Tab preso dentro do diálogo,
   Esc e clique fora fecham, rolagem da página travada, foco devolvido ao gatilho. */
(function () {
  var ICON_X = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>';
  var uid = 0;
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';

  function visible(el) { return !el.hidden && el.offsetParent !== null || el === document.activeElement; }

  /**
   * options: { className, overlayClassName, content (HTMLElement[] | string), onClose }
   * retorna { el, overlay, close, root }
   */
  function openDialog(options) {
    var id = 'dialog-' + (++uid);
    var trigger = document.activeElement;
    var overlay = document.createElement('div');
    overlay.className = 'dialog-overlay' + (options.overlayClassName ? ' ' + options.overlayClassName : '');
    overlay.setAttribute('data-state', 'open');
    overlay.setAttribute('aria-hidden', 'true');

    var el = document.createElement('div');
    el.className = 'dialog-content' + (options.className ? ' ' + options.className : '');
    el.setAttribute('role', 'dialog');
    el.setAttribute('data-state', 'open');
    el.setAttribute('tabindex', '-1');
    el.setAttribute('aria-labelledby', id + '-title');
    el.setAttribute('aria-describedby', id + '-desc');
    if (typeof options.content === 'string') el.innerHTML = options.content;
    else options.content.forEach(function (n) { el.appendChild(n); });
    var title = el.querySelector('.dialog-title'); if (title) title.id = id + '-title';
    var desc = el.querySelector('.dialog-description'); if (desc) desc.id = id + '-desc';

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'dialog-close';
    closeBtn.innerHTML = ICON_X + '<span class="sr-only">Close</span>';
    el.appendChild(closeBtn);

    document.body.appendChild(overlay);
    document.body.appendChild(el);

    // trava a rolagem e esconde o conteúdo de fundo para leitores de tela
    var scrollbar = window.innerWidth - document.documentElement.clientWidth;
    var prev = { overflow: document.body.style.overflow, paddingRight: document.body.style.paddingRight, pe: document.body.style.pointerEvents };
    document.body.style.overflow = 'hidden';
    if (scrollbar > 0) document.body.style.paddingRight = scrollbar + 'px';
    document.body.style.pointerEvents = 'none';
    overlay.style.pointerEvents = 'auto'; el.style.pointerEvents = 'auto';
    var background = document.querySelector('.site-shell, .login-page');
    if (background) background.setAttribute('aria-hidden', 'true');

    var closed = false;
    function close() {
      if (closed) return; closed = true;
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('focusin', onFocusIn, true);
      overlay.setAttribute('data-state', 'closed'); el.setAttribute('data-state', 'closed');
      document.body.style.overflow = prev.overflow; document.body.style.paddingRight = prev.paddingRight; document.body.style.pointerEvents = prev.pe;
      if (background) background.removeAttribute('aria-hidden');
      var finish = function () {
        overlay.remove(); el.remove();
        if (trigger && trigger.focus && document.contains(trigger)) trigger.focus();
        if (options.onClose) options.onClose();
      };
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) finish(); else { var done = false; el.addEventListener('animationend', function () { if (!done) { done = true; finish(); } }); setTimeout(function () { if (!done) { done = true; finish(); } }, 300); }
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
      if (e.key !== 'Tab') return;
      var items = Array.prototype.filter.call(el.querySelectorAll(FOCUSABLE), visible);
      if (!items.length) { e.preventDefault(); return; }
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    function onPointer(e) { if (!el.contains(e.target)) close(); }
    function onFocusIn(e) { if (!el.contains(e.target)) { var f = el.querySelector(FOCUSABLE); (f || el).focus(); } }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('focusin', onFocusIn, true);
    closeBtn.addEventListener('click', close);

    var firstFocus = Array.prototype.filter.call(el.querySelectorAll(FOCUSABLE), visible)[0];
    (firstFocus || el).focus({ preventScroll: true });
    return { el: el, overlay: overlay, close: close };
  }

  window.SideralDialog = { open: openDialog };
})();
