// Barra lateral de conta: adiciona botão no cabeçalho e painel com perfil.
import { auth } from '/js/sideral-auth.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = (n) => (n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const avatar = (p, cls = '') =>
  p ? `<span class="sa-avatar ${cls}">${p.avatar ? `<img src="${esc(p.avatar)}" alt="">` : esc(initials(p.name))}</span>`
    : `<span class="sa-avatar off ${cls}" aria-hidden="true">?</span>`;

const back = encodeURIComponent(location.pathname + location.search);
const btn = document.createElement('button');
btn.type = 'button';
btn.className = 'sa-account-btn';
btn.setAttribute('aria-controls', 'saSidebar');
btn.setAttribute('aria-expanded', 'false');
(document.querySelector('.header-actions') || document.body).appendChild(btn);

const overlay = document.createElement('div');
overlay.className = 'sa-overlay';
const side = document.createElement('aside');
side.id = 'saSidebar';
side.className = 'sa-sidebar';
side.setAttribute('aria-label', 'Conta');
document.body.append(overlay, side);

const open = (v) => { document.body.classList.toggle('sa-open', v); btn.setAttribute('aria-expanded', String(v)); };
btn.onclick = () => open(true);
overlay.onclick = () => open(false);
document.addEventListener('keydown', (e) => e.key === 'Escape' && open(false));

function render(p) {
  btn.innerHTML = `${avatar(p)}<span class="sa-btn-label">${p ? esc(p.name) : 'Entrar'}</span>`;
  btn.setAttribute('aria-label', p ? `Conta de ${p.name}` : 'Você não está conectado');
  side.innerHTML = `
    <div class="sa-side-head"><span>Sua conta</span><button class="sa-close" type="button" aria-label="Fechar">×</button></div>
    <div class="sa-profile">
      ${avatar(p, 'lg')}
      ${p
        ? `<p class="sa-name">${esc(p.name)}</p><p class="sa-email">${esc(p.email)}</p><span class="sa-status"><i class="sa-dot on"></i>Conectado</span>`
        : `<p class="sa-name">Você não está conectado</p><p class="sa-email">Entre para salvar preferências e acessar recursos da sua conta.</p><span class="sa-status"><i class="sa-dot"></i>Desconectado</span>`}
    </div>
    <nav class="sa-links"><a href="index.html">Início</a><a href="radar.html">Radar</a><a href="dashboard.html">Painel</a></nav>
    <div class="sa-foot">${p
      ? `<button class="sa-ghost" type="button" data-signout>Sair</button>`
      : `<a class="sa-primary" href="/entrar.html?next=${back}">Entrar ou criar conta</a>`}</div>`;
  side.querySelector('.sa-close').onclick = () => open(false);
  const so = side.querySelector('[data-signout]');
  if (so) so.onclick = async () => { await auth.signOut(); open(false); };
}

render(null);
auth.onChange(render);
