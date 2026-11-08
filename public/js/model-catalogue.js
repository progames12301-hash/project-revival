(() => {
  const cards = [...document.querySelectorAll('.spec-card')];
  const search = document.getElementById('modelSearch');
  let group = 'all';
  function update() {
    const term = (search?.value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    cards.forEach(card => {
      const text = card.textContent.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      card.hidden = (group !== 'all' && card.dataset.modelGroup !== group) || !text.includes(term);
    });
    ['global', 'regional'].forEach(name => {
      const visible = cards.some(card => card.dataset.modelGroup === name && !card.hidden);
      document.querySelector(`[data-grid="${name}"]`).hidden = !visible;
      document.querySelector(`[data-group-title="${name}"]`).hidden = !visible;
    });
    document.getElementById('modelEmpty').hidden = cards.some(card => !card.hidden);
  }
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
    group = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    update();
  }));
  search?.addEventListener('input', update);
})();