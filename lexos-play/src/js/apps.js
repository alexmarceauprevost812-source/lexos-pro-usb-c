/* Fenêtres déplaçables + les 5 applis */
(function () {
  const L = window.LexOS;
  const wins = {};
  let z = 10, cascade = 0;

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ---------- Applis ----------
  const APPS = {
    terminal: { title: 'Terminal', icon: '>_', w: 660, h: 430, render(body) { return { focus: L.createTerminal(body).focus }; } },
    files: { title: 'Fichiers', icon: '▤', w: 560, h: 420, render: renderFiles },
    settings: { title: 'Paramètres', icon: '⚙', w: 420, h: 380, render: renderSettings },
    eyes: { title: 'Yeux', icon: '◉', w: 400, h: 300, render: renderEyes },
    missions: { title: 'Missions', icon: '★', w: 480, h: 520, render: renderMissions }
  };

  // ---------- Gestionnaire de fenêtres ----------
  function open(id) {
    if (wins[id]) { focus(wins[id].node); return; }
    const app = APPS[id];
    const w = Math.min(app.w, window.innerWidth - 90), h = Math.min(app.h, window.innerHeight - 40);
    const node = el('div', 'win');
    const x = Math.max(8, 60 + cascade * 28), y = Math.max(8, 50 + cascade * 28);
    cascade = (cascade + 1) % 6;
    node.style.cssText = 'left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px';

    const tb = el('div', 'tb', '<span class="ti">' + app.title + '</span>');
    const close = el('button', 'x', '×');
    close.title = 'Fermer';
    tb.appendChild(close);
    const body = el('div', 'body');
    node.appendChild(tb); node.appendChild(body);
    document.getElementById('windows').appendChild(node);

    const rec = { node, cleanup: [], api: null };
    wins[id] = rec;
    rec.api = app.render(body, rec) || {};
    focus(node);
    setDockOpen(id, true);

    close.addEventListener('click', () => {
      rec.cleanup.forEach(f => f());
      node.remove(); delete wins[id]; setDockOpen(id, false);
    });
    node.addEventListener('pointerdown', () => focus(node));
    drag(node, tb);
  }

  function focus(node) {
    node.style.zIndex = ++z;
    for (const id in wins) if (wins[id].node === node && wins[id].api && wins[id].api.onFocus) wins[id].api.onFocus();
  }

  function drag(node, handle) {
    handle.addEventListener('pointerdown', ev => {
      if (ev.target.closest('.x')) return;
      const sx = ev.clientX, sy = ev.clientY, ox = node.offsetLeft, oy = node.offsetTop;
      handle.setPointerCapture(ev.pointerId);
      const move = e => {
        const nx = Math.min(window.innerWidth - 120, Math.max(-node.offsetWidth + 120, ox + e.clientX - sx));
        const ny = Math.min(window.innerHeight - 34, Math.max(0, oy + e.clientY - sy));
        node.style.left = nx + 'px'; node.style.top = ny + 'px';
      };
      const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  function setDockOpen(id, on) {
    const d = document.querySelector('.dock-item[data-app="' + id + '"]');
    if (d) d.classList.toggle('open', on);
  }

  function buildDock() {
    const dock = document.getElementById('dock');
    dock.innerHTML = '';
    Object.keys(APPS).forEach(id => {
      const b = el('button', 'dock-item', APPS[id].icon + '<span>' + APPS[id].title + '</span>');
      b.dataset.app = id;
      b.addEventListener('click', () => open(id));
      dock.appendChild(b);
    });
  }

  // ---------- Fichiers ----------
  function renderFiles(body, rec) {
    let cwd = L.fs.HOME, showHidden = false, viewing = null;
    const wrap = el('div', 'files');
    const bar = el('div', 'bar');
    const up = el('button', '', '↑ Monter');
    const path = el('code', '');
    const hid = el('button', '', 'Cachés : non');
    bar.appendChild(up); bar.appendChild(hid); bar.appendChild(path);
    const list = el('div', 'list');
    const view = el('div', 'view hidden');
    wrap.appendChild(bar); wrap.appendChild(list); wrap.appendChild(view);
    body.appendChild(wrap);

    function draw() {
      if (!L.fs.isDir(cwd)) cwd = L.fs.HOME;
      path.textContent = cwd;
      list.innerHTML = '';
      (L.fs.list(cwd, showHidden) || []).forEach(name => {
        const abs = L.fs.resolve(cwd, name);
        const n = L.fs.get(abs);
        const it = el('div', 'it', '<span class="ic">' + (n.t === 'd' ? '📁' : '📄') + '</span>' + esc(name));
        it.addEventListener('click', () => {
          if (n.t === 'd') { cwd = abs; view.classList.add('hidden'); draw(); }
          else {
            view.textContent = '— ' + name + ' —\n\n' + n.c;
            view.classList.remove('hidden');
            if (abs === L.fs.HOME + '/.secret') { L.state.flags.secret = true; L.missions.onCommand({ cmd: 'files', ok: true, args: [], paths: [] }); }
          }
        });
        list.appendChild(it);
      });
      if (!list.children.length) list.innerHTML = '<small style="color:#666;padding:6px">Dossier vide</small>';
    }
    up.addEventListener('click', () => { cwd = L.fs.resolve(cwd, '..'); view.classList.add('hidden'); draw(); });
    hid.addEventListener('click', () => { showHidden = !showHidden; hid.textContent = 'Cachés : ' + (showHidden ? 'oui' : 'non'); draw(); });
    rec.cleanup.push(L.bus.on('fs', draw));
    draw();
    return {};
  }

  // ---------- Paramètres ----------
  function renderSettings(body, rec) {
    const wrap = el('div', 'pad');
    wrap.innerHTML =
      '<h3>Apparence</h3>' +
      '<div class="seg"><button class="btn" data-t="pro">Pro (noir/orange)</button>' +
      '<button class="btn" data-t="halloween">Halloween (démon)</button></div>' +
      '<small>Tu peux aussi changer le thème dans le terminal.</small>' +
      '<h3>Progression</h3>' +
      '<button class="btn ghost" id="reset">Tout recommencer à zéro</button>' +
      '<h3>À propos</h3>' +
      '<small>LexOS Play ' + L.config.VERSION + ' · une simulation 100 % sûre.<br>' +
      'Elle ne touche pas à tes vrais fichiers.<br>Play. Build. Own your machine.</small>';
    body.appendChild(wrap);
    function sync() { wrap.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('off', b.dataset.t !== L.state.theme)); }
    wrap.querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', () => { L.setTheme(b.dataset.t); sync(); }));
    wrap.querySelector('#reset').addEventListener('click', () => {
      if (confirm('Effacer toute ta progression (missions, XP, fichiers) ?')) L.resetAll();
    });
    rec.cleanup.push(L.bus.on('theme', sync));
    sync();
    return {};
  }

  // ---------- Yeux ----------
  function renderEyes(body) {
    const E = L.state.eyes;
    const wrap = el('div', 'pad');
    wrap.innerHTML =
      '<h3>Les yeux de TI-LEX-AL</h3>' +
      '<label>Couleur <input type="color" id="ec" value="' + (E.color || '#ff1a1a') + '"></label>' +
      '<label>Taille <input type="range" id="es" min="0.5" max="1.5" step="0.1" value="' + E.size + '"></label>' +
      '<label>Suivre le curseur <input type="checkbox" id="ef"' + (E.follow ? ' checked' : '') + '></label>' +
      '<div class="seg"><button class="btn ghost" id="er">Remettre par défaut</button></div>';
    body.appendChild(wrap);
    const ec = wrap.querySelector('#ec'), es = wrap.querySelector('#es'), ef = wrap.querySelector('#ef');
    ec.addEventListener('input', () => { E.color = ec.value; L.eyes.apply(); L.save(); });
    es.addEventListener('input', () => { E.size = parseFloat(es.value); L.eyes.apply(); L.save(); });
    ef.addEventListener('change', () => { E.follow = ef.checked; L.eyes.apply(); L.save(); });
    wrap.querySelector('#er').addEventListener('click', () => {
      E.color = null; E.size = 1; E.follow = true;
      ec.value = '#ff1a1a'; es.value = 1; ef.checked = true;
      L.eyes.apply(); L.save();
    });
    return {};
  }

  // ---------- Missions ----------
  function renderMissions(body, rec) {
    const wrap = el('div', 'pad');
    body.appendChild(wrap);
    function draw() {
      const xp = L.state.xp, lv = L.missions.levelFor(xp), nx = L.missions.nextLevel(xp);
      const pct = nx ? Math.round((xp - lv.xp) / (nx.xp - lv.xp) * 100) : 100;
      const done = L.missions.LIST.filter(m => L.state.done[m.id]).length;
      let h = '<div><h3>Niveau : ' + lv.name + '</h3><div class="lvl"><div class="bar"><i style="width:' + pct + '%"></i></div>' +
        '<small>' + xp + ' XP' + (nx ? ' / ' + nx.xp : '') + '</small></div>' +
        '<small>' + done + ' / ' + L.missions.LIST.length + ' missions</small></div>';
      L.missions.LIST.forEach(m => {
        const ok = L.state.done[m.id];
        h += '<div class="mi' + (ok ? ' done' : '') + '"><div class="t"><span>' + (ok ? '✔ ' : '') + esc(m.title) + '</span><em>+' + m.xp + ' XP</em></div><p>' + esc(m.desc) + '</p></div>';
      });
      if (L.missions.allDone()) h += '<button class="btn" id="inst">Installer le vrai LexOS</button>';
      wrap.innerHTML = h;
      const b = wrap.querySelector('#inst');
      if (b) b.addEventListener('click', L.openInstall);
    }
    rec.cleanup.push(L.bus.on('missions', draw));
    draw();
    return {};
  }

  L.wm = { open };
  L.buildDock = buildDock;
})();
