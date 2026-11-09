/* Démarrage, connexion, bureau, yeux, barre du haut, écran final */
(function () {
  const L = window.LexOS;
  const $ = id => document.getElementById(id);

  L.load();
  L.fs.init();

  // ---------- Thème ----------
  function applyTheme() { document.body.classList.toggle('halloween', L.state.theme === 'halloween'); }
  L.setTheme = function (t) { L.state.theme = t; applyTheme(); L.save(); L.bus.emit('theme'); };
  applyTheme();

  // ---------- Lien externe (seul bouton qui sort du jeu) ----------
  L.openInstall = function () { window.open(L.config.INSTALL_URL, '_blank', 'noopener'); };

  // ---------- Yeux du démon ----------
  const pupils = [document.querySelector('#eyeL .pupil'), document.querySelector('#eyeR .pupil')];
  const eyeNodes = [$('eyeL'), $('eyeR')];
  let mouse = null;
  function aim() {
    const E = L.state.eyes;
    eyeNodes.forEach((g, i) => {
      let x = 0, y = 0;
      if (E.follow && mouse) {
        const r = g.getBoundingClientRect();
        const dx = mouse.x - (r.left + r.width / 2), dy = mouse.y - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.min(d / 12, 1);
        x = dx / d * 17 * k * (1.4 - E.size * 0.4);
        y = dy / d * 7 * k;
      }
      pupils[i].setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ')');
    });
  }
  L.eyes = {
    apply() {
      const E = L.state.eyes;
      pupils.forEach(p => { p.setAttribute('r', (9 * E.size).toFixed(1)); p.style.fill = E.color || ''; });
      aim();
    }
  };
  document.addEventListener('mousemove', e => { mouse = { x: e.clientX, y: e.clientY }; aim(); });
  L.eyes.apply();

  // ---------- Barre du haut : apparaît après 0,3 s au survol du haut ----------
  const bar = $('topbar'), zone = $('topzone');
  let showTimer = null;
  zone.addEventListener('mouseenter', () => { showTimer = setTimeout(() => bar.classList.add('show'), 300); });
  zone.addEventListener('mouseleave', () => clearTimeout(showTimer));
  bar.addEventListener('mouseleave', () => bar.classList.remove('show'));

  function tick() {
    const d = new Date(); $('clock').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  setInterval(tick, 1000); tick();

  function updateXP() {
    const xp = L.state.xp, lv = L.missions.levelFor(xp), nx = L.missions.nextLevel(xp);
    $('lvlname').textContent = lv.name;
    $('xptxt').textContent = xp + ' XP';
    $('xpbar').firstElementChild.style.width = (nx ? Math.round((xp - lv.xp) / (nx.xp - lv.xp) * 100) : 100) + '%';
  }
  L.bus.on('missions', updateXP);
  updateXP();

  // ---------- Écran final ----------
  L.bus.on('final', () => $('final').classList.remove('hidden'));
  $('install').addEventListener('click', L.openInstall);
  $('keep').addEventListener('click', () => $('final').classList.add('hidden'));

  // ---------- Démarrage -> connexion -> bureau ----------
  const boot = $('boot'), login = $('login'), desktop = $('desktop');
  let stage = 'boot';

  function toLogin() {
    if (stage !== 'boot') return;
    stage = 'login';
    boot.classList.add('hidden');
    login.classList.remove('hidden');
    $('pw').focus();
  }
  function toDesktop() {
    if (stage !== 'login') return;
    stage = 'desktop';
    login.classList.add('hidden');
    desktop.classList.remove('hidden');
    bar.classList.remove('hidden');
    $('dock').classList.remove('hidden');
    L.buildDock();
    L.wm.open('terminal');
    L.missions.toast('Bienvenue Alex! Ouvre <b>Missions</b> dans le dock à droite.');
  }

  const bootTimer = setTimeout(toLogin, 3500);
  boot.addEventListener('click', () => { clearTimeout(bootTimer); toLogin(); });
  document.addEventListener('keydown', () => { if (stage === 'boot') { clearTimeout(bootTimer); toLogin(); } });
  $('pw').addEventListener('keydown', e => { if (e.key === 'Enter') toDesktop(); });
  login.addEventListener('click', () => { if (stage === 'login') $('pw').focus(); });
})();
