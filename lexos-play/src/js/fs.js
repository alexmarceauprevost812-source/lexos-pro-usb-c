/* Faux système de fichiers en mémoire. Aucun accès aux vrais fichiers. */
(function () {
  const L = window.LexOS;
  const HOME = '/home/alex';

  const dir = (children) => ({ t: 'd', c: children || {} });
  const file = (content) => ({ t: 'f', c: content });

  function fresh() {
    return dir({
      home: dir({
        alex: dir({
          'bienvenue.txt': file(
            'Bienvenue dans LexOS, Alex!\n\n' +
            'Ici, tu apprends à contrôler ta machine avec des mots.\n' +
            'Tu es dans ton dossier personnel : /home/alex.\n\n' +
            'INDICE : tout n\'est pas visible du premier coup. Un nom qui\n' +
            'commence par un point est caché. Essaie « ls -a » et regarde\n' +
            'ce que tu trouves... puis lis-le avec « cat ».\n\n' +
            '— TI-LEX-AL'),
          'notes.txt': file('Idées pour plus tard :\n- apprendre à créer des dossiers\n- personnaliser les yeux du démon\n'),
          'Documents': dir({ 'recette-poutine.txt': file('Frites, fromage en grains, sauce. Le reste est secondaire.\n') }),
          'Images': dir({ 'demon.txt': file('(imagine un démon qui te regarde avec ses yeux rouges)\n') }),
          '.secret': file(
            'Tu as trouvé le fichier caché!\n\n' +
            'Le secret de LexOS : ce système t\'appartient.\n' +
            'Rien n\'est caché pour celui qui sait regarder.\n\n' +
            'Code du démon : TI-LEX-AL-666'),
          '.config': dir({ 'lexos.conf': file('theme=pro\nlangue=fr-CA\n') })
        })
      }),
      etc: dir({ 'os-release': file('NAME="LexOS"\nVERSION="2.0.3 Nomad"\nBASE="Debian trixie 13.7"\n') }),
      tmp: dir({})
    });
  }

  const fsys = {
    HOME,
    root: null,

    init() {
      const saved = L.state.fs;
      this.root = (saved && saved.t === 'd') ? saved : fresh();
    },

    // Transforme un chemin (relatif ou absolu, avec ~ . ..) en chemin absolu normalisé
    resolve(cwd, p) {
      p = p || '';
      if (p === '~') p = HOME;
      else if (p.startsWith('~/')) p = HOME + p.slice(1);
      const parts = (p.startsWith('/') ? p : cwd + '/' + p).split('/');
      const out = [];
      for (const s of parts) {
        if (!s || s === '.') continue;
        if (s === '..') out.pop(); else out.push(s);
      }
      return '/' + out.join('/');
    },

    get(abs) {
      let n = this.root;
      for (const s of abs.split('/').filter(Boolean)) {
        if (!n || n.t !== 'd' || !Object.prototype.hasOwnProperty.call(n.c, s)) return null;
        n = n.c[s];
      }
      return n;
    },

    parentOf(abs) {
      const i = abs.lastIndexOf('/');
      return { dir: this.get(abs.slice(0, i) || '/'), name: abs.slice(i + 1) };
    },

    isDir(abs) { const n = this.get(abs); return !!n && n.t === 'd'; },

    list(abs, all) {
      const n = this.get(abs);
      if (!n || n.t !== 'd') return null;
      return Object.keys(n.c).filter(k => all || !k.startsWith('.')).sort((a, b) => a.localeCompare(b, 'fr'));
    },

    // Chemin joli pour le prompt : ~ au lieu de /home/alex
    pretty(abs) {
      if (abs === HOME) return '~';
      if (abs.startsWith(HOME + '/')) return '~' + abs.slice(HOME.length);
      return abs;
    }
  };

  L.fs = fsys;
})();
