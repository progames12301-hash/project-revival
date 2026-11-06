/* Página inicial — interações: menu mobile, animação de entrada, diálogos e leitor de dBZ. */
(function () {
  'use strict';

  var ICON = {
    arrowUpRight: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-up-right" aria-hidden="true"><path d="M7 7h10v10"></path><path d="M7 17 17 7"></path></svg>',
    arrowRight: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>',
    menu: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-menu" aria-hidden="true"><path d="M4 5h16"></path><path d="M4 12h16"></path><path d="M4 19h16"></path></svg>',
    x: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>'
  };

  /* Ferramentas (mesmo conteúdo e ordem dos cartões da página) */
  var TOOLS = [
    { title: 'Modelos numéricos WRF', tone: 'violet', detail: 'Os materiais da Sideral apresentam WRF regional de 7 km, CIM de 8 km, METBR de 4 km e BrasilScope de 21 km. Os domínios regionais complementam a leitura dos modelos globais.' },
    { title: 'Skew-T / Sounding', tone: 'cyan', detail: 'O visualizador Skew-T descrito no HTML reúne 27 capitais brasileiras, com ECMWF IFS 0,25°, ciclos 06Z, 12Z e 18Z e previsões até 48 horas em intervalos de 3 horas.' },
    { title: 'Radar meteorológico', tone: 'gold', detail: 'A apresentação de radar reúne refletividade e monitoramento meteorológico, com fontes NEXRAD e Simepar citadas no material enviado. As imagens desta página são demonstrativas.' },
    { title: 'Satélite & atmosfera', tone: 'blue', detail: 'A visualização de satélite complementa modelos e radar na análise de nebulosidade e sistemas atmosféricos. NASA e NOAA aparecem entre as fontes citadas no HTML.' },
    { title: 'Modelos Globais', tone: 'red', detail: 'ECMWF IFS, NOAA/GFS, ICON/DWD e COSMO/Isóbaras são os modelos e produtos globais citados no dashboard de referência.' },
    { title: 'Meteorologia para todos.', tone: 'green', detail: 'INMET e OpenWeather são fontes complementares citadas no HTML. Esta apresentação não consulta dados atuais nem disponibiliza a plataforma operacional.' }
  ];

  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  /* Prévia ilustrativa dentro do diálogo de ferramenta */
  function preview(tone, label) {
    var inner;
    if (tone === 'cyan') {
      inner = '<svg viewBox="0 0 320 150" class="science-plot" aria-label="Gráfico meteorológico demonstrativo" role="img">' +
        '<g class="plot-grid"><path d="M25 30H300"></path><path d="M25 55H300"></path><path d="M25 80H300"></path><path d="M25 105H300"></path><path d="M25 130H300"></path><path d="M30 15V135"></path><path d="M75 15V135"></path><path d="M120 15V135"></path><path d="M165 15V135"></path><path d="M210 15V135"></path><path d="M255 15V135"></path><path d="M300 15V135"></path></g>' +
        '<g class="plot-grid"><path d="M0 135L80 15"></path><path d="M40 135L120 15"></path><path d="M80 135L160 15"></path><path d="M120 135L200 15"></path><path d="M160 135L240 15"></path><path d="M200 135L280 15"></path><path d="M240 135L320 15"></path></g>' +
        '<path d="M170 135L164 116L142 102L145 88L129 70L138 54L122 37L132 17" class="plot-red"></path>' +
        '<path d="M122 135L119 117L108 99L115 85L94 70L106 52L89 36L101 17" class="plot-cyan"></path></svg>';
    } else if (tone === 'blue') {
      inner = '<img alt="Imagem ilustrativa de nuvens sobre a América do Sul" width="1024" height="1024" loading="lazy" src="assets/satellite-map.jpg">';
    } else {
      inner = '<img alt="Mapa meteorológico ilustrativo da América do Sul" width="1024" height="1024" loading="lazy" src="assets/forecast-map.jpg"><div class="radar-ring"></div><div class="radar-sweep"></div>';
    }
    var kind = tone === 'cyan' ? 'sounding' : tone === 'blue' ? 'satellite' : 'radar';
    return '<div class="detail-preview"><div class="product-preview preview-' + kind + '">' + inner +
      '<span class="preview-label">' + label + '</span><span class="preview-demo">VISUAL DEMONSTRATIVO</span></div></div>';
  }

  var BRAND = '<div class="brand"><img class="brand-logo" alt="Sideral Meteorologia" width="380" height="213" src="assets/sideral-logo.png"></div>';

  function openAccess() {
    var dlg = SideralDialog.open({
      className: 'access-dialog',
      content: '<div class="dialog-header">' + BRAND +
        '<h2 class="dialog-title">Seu próximo olhar sobre a atmosfera.</h2>' +
        '<p class="dialog-description">Esta é a apresentação da Sideral Meteorologia. O acesso à plataforma operacional não está conectado nesta página.</p></div>' +
        '<button class="btn btn-sideral btn-md" type="button">Explorar as ferramentas ' + ICON.arrowRight + '</button>'
    });
    dlg.el.querySelector('.btn').addEventListener('click', function () {
      dlg.close();
      var target = document.getElementById('ferramentas');
      if (target) target.scrollIntoView({ behavior: 'smooth' });
    });
  }

  function openTool(tool) {
    var dlg = SideralDialog.open({
      className: 'access-dialog',
      content: '<div class="dialog-header"><span class="micro-label">UNIVERSO SIDERAL</span>' +
        '<h2 class="dialog-title">' + esc(tool.title) + '</h2>' +
        '<p class="dialog-description">' + esc(tool.detail) + '</p></div>' +
        preview(tool.tone, 'PRÉVIA ILUSTRATIVA') +
        '<button class="btn btn-sideral btn-md" type="button">Acessar plataforma ' + ICON.arrowUpRight + '</button>'
    });
    dlg.el.querySelector('.btn').addEventListener('click', function () {
      dlg.close();
      openAccess();
    });
  }

  /* Botões que abrem diálogos */
  document.querySelectorAll('.tool-link').forEach(function (btn, i) {
    btn.addEventListener('click', function () { openTool(TOOLS[i]); });
  });
  var heroPlatform = document.querySelector('.hero-actions button');
  if (heroPlatform) heroPlatform.addEventListener('click', openAccess);
  var aboutCta = document.querySelector('.about-section .btn');
  if (aboutCta) aboutCta.addEventListener('click', openAccess);
  var modelsCta = document.querySelector('.model-text > .btn');
  if (modelsCta) modelsCta.addEventListener('click', function () { openTool(TOOLS[0]); });

  /* Menu mobile */
  var menuBtn = document.querySelector('.mobile-menu-button');
  var mobileNav = document.getElementById('mobile-nav');
  function setMenu(open) {
    mobileNav.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
    menuBtn.innerHTML = open ? ICON.x : ICON.menu;
  }
  if (menuBtn && mobileNav) {
    menuBtn.addEventListener('click', function () { setMenu(mobileNav.hidden); });
    mobileNav.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
  }

  /* Animação de entrada (.reveal) */
  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
      });
    }, { threshold: 0.08 });
    document.querySelectorAll('.reveal').forEach(function (el) { observer.observe(el); });
  } else {
    document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('is-visible'); });
  }

  /* Leitor de dBZ sobre a imagem de refletividade */
  var SCALE = [
    { min: 5, max: 10, color: [45, 230, 229] }, { min: 10, max: 15, color: [30, 155, 240] },
    { min: 15, max: 20, color: [11, 10, 225] }, { min: 20, max: 25, color: [166, 209, 0] },
    { min: 25, max: 30, color: [46, 157, 20] }, { min: 30, max: 35, color: [245, 246, 61] },
    { min: 35, max: 40, color: [245, 198, 25] }, { min: 40, max: 45, color: [245, 138, 13] },
    { min: 45, max: 50, color: [237, 28, 12] }, { min: 50, max: 55, color: [163, 8, 8] },
    { min: 55, max: 60, color: [255, 201, 245] }, { min: 60, max: 65, color: [239, 0, 240] },
    { min: 65, max: 70, color: [160, 77, 196] }
  ];

  function bandFor(r, g, b) {
    if (Math.max(r, g, b) - Math.min(r, g, b) < 40) return null;
    var best = null, distance = Infinity;
    SCALE.forEach(function (band) {
      var d = Math.pow(band.color[0] - r, 2) + Math.pow(band.color[1] - g, 2) + Math.pow(band.color[2] - b, 2);
      if (d < distance) { distance = d; best = band; }
    });
    return best;
  }

  // Mediana 5x5: estabiliza a leitura em pixels com ruído sem inventar valores.
  function medianColor(found, sx, sy) {
    var r = [], g = [], b = [];
    for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) {
      var x = Math.min(found.width - 1, Math.max(0, sx + dx));
      var y = Math.min(found.height - 1, Math.max(0, sy + dy));
      var at = (y * found.width + x) * 4;
      r.push(found.data[at] || 0); g.push(found.data[at + 1] || 0); b.push(found.data[at + 2] || 0);
    }
    function middle(v) { v.sort(function (p, q) { return p - q; }); return v[Math.floor(v.length / 2)] || 0; }
    return [middle(r), middle(g), middle(b)];
  }

  var stage = document.querySelector('.reflectivity-stage');
  if (stage) {
    var image = stage.querySelector('img');
    var status = document.querySelector('.reflectivity-viewer .sr-only');
    var sample = null;
    var cursor = null, label = null;

    var read = function (node) {
      if (!node.naturalWidth) return;
      var ratio = Math.min(1, 2400 / node.naturalWidth);
      var width = Math.max(1, Math.round(node.naturalWidth * ratio));
      var height = Math.max(1, Math.round(node.naturalHeight * ratio));
      var canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(node, 0, 0, width, height);
      try { sample = { width: width, height: height, data: ctx.getImageData(0, 0, width, height).data }; }
      catch (e) { sample = null; }
    };
    // Cópia separada da imagem, carregada com CORS, usada apenas para ler os pixels
    // (a imagem exibida não é afetada). Requer servir a página por http(s).
    var probe = new Image();
    if (/^https?:$/.test(location.protocol)) probe.crossOrigin = 'anonymous';
    probe.onload = function () { read(probe); };
    probe.src = image.getAttribute('src');

    var hide = function () {
      if (cursor) { cursor.remove(); label.remove(); cursor = label = null; }
      status.textContent = 'Nenhum ponto em leitura.';
    };
    image.addEventListener('pointerleave', hide);
    image.addEventListener('pointermove', function (event) {
      if (!sample) return;
      var box = image.getBoundingClientRect();
      var fx = (event.clientX - box.left) / box.width;
      var fy = (event.clientY - box.top) / box.height;
      if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
      var sx = Math.min(sample.width - 1, Math.floor(fx * sample.width));
      var sy = Math.min(sample.height - 1, Math.floor(fy * sample.height));
      var rgb = medianColor(sample, sx, sy);
      var band = bandFor(rgb[0], rgb[1], rgb[2]);
      var x = Math.min(Math.max(fx * box.width, 74), box.width - 74);
      var y = fy * box.height;
      var text = band ? band.min + '–' + band.max + ' dBZ' : 'Sem eco';
      var color = band ? 'rgb(' + band.color.join(', ') + ')' : 'var(--muted-foreground)';
      if (!cursor) {
        cursor = document.createElement('span'); cursor.className = 'reflectivity-cursor'; cursor.setAttribute('aria-hidden', 'true');
        label = document.createElement('span'); label.setAttribute('aria-hidden', 'true');
        label.innerHTML = '<span class="reflectivity-chip"></span><span class="reflectivity-text"></span>';
        stage.appendChild(cursor); stage.appendChild(label);
      }
      cursor.style.left = x + 'px'; cursor.style.top = y + 'px';
      label.className = 'reflectivity-label' + (y < 46 ? ' is-below' : '');
      label.style.left = x + 'px'; label.style.top = y + 'px';
      label.firstChild.style.background = color;
      label.lastChild.textContent = text;
      status.textContent = text;
    });
  }
})();
