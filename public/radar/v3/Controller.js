// Compatibilidade legada: Brasil Scope V3 agora é um modo visual do RadarManager.
// Este módulo não cria um catálogo CPTEC paralelo nem força uma fonte específica.
const $ = id => document.getElementById(id);

export class ScopeV3 {
  constructor(app) {
    this.app = app;
    this.mode = $('renderMode');
    this.onChange = event => {
      if (event.target !== this.mode) return;
      const selected = this.mode.value;
      if (!['brasil_scope_v3', 'brasil_scope_v4', 'brasil_scope_v5'].includes(selected)) return;
      // Deixa o RadarManager usar a fonte e a imagem que já estão selecionadas.
      event.stopImmediatePropagation();
      this.app.setRenderMode(selected);
    };
    this.mode?.addEventListener('change', this.onChange, true);
  }

  destroy() {
    this.mode?.removeEventListener('change', this.onChange, true);
  }
}
