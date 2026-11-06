import {RadarManagerV2} from './RadarManagerV2.js?v=4-20261022-img-direct';

const interfaceTheme = document.getElementById('interfaceTheme');
const savedTheme = localStorage.getItem('sideralBrazilScopeLegacyInterface') || 'white';
document.documentElement.dataset.interfaceTheme = savedTheme;
if (interfaceTheme) {
  interfaceTheme.value = savedTheme;
  interfaceTheme.addEventListener('change', event => {
    const value = event.target.value;
    document.documentElement.dataset.interfaceTheme = value;
    localStorage.setItem('sideralBrazilScopeLegacyInterface', value);
  });
}

const appElement = document.getElementById('radarApp');
const drawerButton = document.getElementById('drawerButton');
const closeDrawer = document.getElementById('closeDrawer');
const setDrawer = open => {
  appElement?.classList.toggle('drawer-open', open);
  drawerButton?.setAttribute('aria-expanded', String(open));
  setTimeout(() => window.dispatchEvent(new Event('resize')), 220);
};
drawerButton?.addEventListener('click', () => setDrawer(!appElement.classList.contains('drawer-open')));
closeDrawer?.addEventListener('click', () => setDrawer(false));
document.getElementById('settingsButton')?.addEventListener('click', () => setDrawer(true));
document.querySelectorAll('[data-open-tab]').forEach(button => button.addEventListener('click', () => {
  setDrawer(true);
  document.querySelector(`[data-panel-tab="${button.dataset.openTab}"]`)?.click();
}));
if (matchMedia('(min-width: 1050px)').matches) setDrawer(true);

const app = new RadarManagerV2();
app.init().catch(error => {
  console.error('Falha fatal no BrazilScope:', error);
  document.getElementById('loadingScreen')?.classList.add('hidden');
  const title = document.getElementById('statusTitle');
  const detail = document.getElementById('statusDetail');
  if (title) title.textContent = 'Não foi possível iniciar o BrazilScope';
  if (detail) detail.textContent = error.message;
});

window.addEventListener('beforeunload', () => app.destroy());
