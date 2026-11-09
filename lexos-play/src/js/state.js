/* État du jeu + sauvegarde (localStorage dans un try/catch) */
(function () {
  const L = window.LexOS;

  // Petit système d'événements
  const handlers = {};
  L.bus = {
    on(n, f) { (handlers[n] = handlers[n] || []).push(f); return () => { handlers[n] = handlers[n].filter(x => x !== f); }; },
    emit(n, d) { (handlers[n] || []).slice().forEach(f => { try { f(d); } catch (e) { console.error(e); } }); }
  };

  function defaults() {
    return { xp: 0, done: {}, flags: {}, theme: 'pro', eyes: { color: null, size: 1, follow: true }, fs: null, history: [] };
  }

  L.state = defaults();

  L.load = function () {
    try {
      const raw = localStorage.getItem(L.config.STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        L.state = Object.assign(defaults(), saved);
        L.state.eyes = Object.assign(defaults().eyes, saved.eyes || {});
      }
    } catch (e) { /* pas de stockage : le jeu marche quand même, sans sauvegarde */ }
  };

  L.save = function () {
    try {
      L.state.fs = L.fs ? L.fs.root : null;
      L.state.history = (L.state.history || []).slice(-100);
      localStorage.setItem(L.config.STORAGE_KEY, JSON.stringify(L.state));
    } catch (e) { /* ignoré */ }
  };

  L.resetAll = function () {
    try { localStorage.removeItem(L.config.STORAGE_KEY); } catch (e) { /* ignoré */ }
    location.reload();
  };
})();
