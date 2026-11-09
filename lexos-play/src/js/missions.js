/* Missions, XP et niveaux */
(function () {
  const L = window.LexOS;
  const HOME = '/home/alex';

  const LEVELS = [
    { name: 'Curieux', xp: 0 },
    { name: 'Explorateur', xp: 100 },
    { name: 'Bâtisseur', xp: 250 },
    { name: 'Maître', xp: 600 }
  ];

  const LIST = [
    { id: 'pwd', title: 'Où suis-je ?', xp: 50,
      desc: 'Demande au système dans quel dossier tu es. Tape : pwd',
      check: e => e.cmd === 'pwd' && e.ok },
    { id: 'ls', title: 'Regarde autour', xp: 50,
      desc: 'Liste ce qu\'il y a dans ton dossier. Tape : ls',
      check: e => e.cmd === 'ls' && e.ok },
    { id: 'cat', title: 'Lis le mot de bienvenue', xp: 100,
      desc: 'Lis le fichier de bienvenue (il contient un indice). Tape : cat bienvenue.txt',
      check: e => e.cmd === 'cat' && e.ok && e.paths.indexOf(HOME + '/bienvenue.txt') >= 0 },
    { id: 'mkdir', title: 'Bâtisseur', xp: 100,
      desc: 'Crée un dossier qui s\'appelle projets. Tape : mkdir projets',
      check: () => L.fs.isDir(HOME + '/projets') },
    { id: 'echo', title: 'Premier fichier', xp: 100,
      desc: 'Écris « salut » dans un fichier. Tape : echo "salut" > projets/salut.txt',
      check: () => { const n = L.fs.get(HOME + '/projets/salut.txt'); return !!n && n.t === 'f' && /salut/i.test(n.c); } },
    { id: 'hidden', title: 'Rien de caché', xp: 100,
      desc: 'Montre les fichiers cachés avec ls -a, puis lis le fichier .secret avec cat .secret',
      check: () => !!(L.state.flags.lsa && L.state.flags.secret) },
    { id: 'theme', title: 'Maître de ta machine', xp: 150,
      desc: 'Change le thème de ton système. Tape : lexos theme halloween',
      check: e => e.cmd === 'lexos' && e.ok && e.args[0] === 'theme' && e.args[1] === 'halloween' }
  ];

  function levelFor(xp) {
    let l = LEVELS[0];
    LEVELS.forEach(x => { if (xp >= x.xp) l = x; });
    return l;
  }
  function nextLevel(xp) { return LEVELS.find(x => x.xp > xp) || null; }
  function allDone() { return LIST.every(m => L.state.done[m.id]); }

  function toast(html) {
    const box = document.getElementById('toasts');
    if (!box) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = html;
    box.appendChild(t);
    setTimeout(() => t.remove(), 4200);
  }

  function complete(m) {
    const before = levelFor(L.state.xp).name;
    L.state.done[m.id] = true;
    L.state.xp += m.xp;
    const after = levelFor(L.state.xp).name;
    L.save();
    toast('Mission réussie : <b>' + m.title + '</b> · +' + m.xp + ' XP');
    if (after !== before) setTimeout(() => toast('Nouveau niveau : <b>' + after + '</b>'), 900);
    L.bus.emit('missions');
    if (allDone()) setTimeout(() => L.bus.emit('final'), 2200);
  }

  L.missions = {
    LIST, LEVELS, levelFor, nextLevel, allDone, toast,
    // Appelé après chaque commande du terminal
    onCommand(e) {
      e.paths = e.paths || [];
      if (e.cmd === 'ls' && e.ok && e.flagA) L.state.flags.lsa = true;
      if (e.cmd === 'cat' && e.ok && e.paths.indexOf(HOME + '/.secret') >= 0) L.state.flags.secret = true;
      LIST.forEach(m => { if (!L.state.done[m.id] && m.check(e)) complete(m); });
      L.save();
    }
  };
})();
