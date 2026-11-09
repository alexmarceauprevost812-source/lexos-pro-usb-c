/* Terminal simulé. Tout se passe en mémoire. */
(function () {
  const L = window.LexOS;

  const LOGO = [
    '██╗     ███████╗██╗  ██╗ ██████╗ ███████╗',
    '██║     ██╔════╝╚██╗██╔╝██╔═══██╗██╔════╝',
    '██║     █████╗   ╚███╔╝ ██║   ██║███████╗',
    '██║     ██╔══╝   ██╔██╗ ██║   ██║╚════██║',
    '███████╗███████╗██╔╝ ██╗╚██████╔╝███████║',
    '╚══════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝'
  ].join('\n');

  const COMMANDS = ['cat', 'cd', 'clear', 'date', 'echo', 'help', 'history', 'lexfetch', 'lexos', 'ls', 'mkdir', 'pwd', 'rm', 'sudo', 'touch', 'uname', 'whoami'];

  // Découpe une ligne en mots (guillemets permis) et repère > et >>
  function tokenize(line) {
    const toks = [];
    let cur = '', q = null, has = false;
    const push = () => { if (has) { toks.push({ v: cur, op: false }); } cur = ''; has = false; };
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === q) q = null; else cur += c; has = true; }
      else if (c === '"' || c === "'") { q = c; has = true; }
      else if (c === ' ' || c === '\t') push();
      else if (c === '>') {
        push();
        if (line[i + 1] === '>') { toks.push({ v: '>>', op: true }); i++; } else toks.push({ v: '>', op: true });
      } else { cur += c; has = true; }
    }
    if (q) return { error: 'guillemet pas fermé' };
    push();
    return { toks };
  }

  function createTerminal(body) {
    const S = L.state;
    let cwd = L.fs.HOME;
    let busy = false;
    let histIdx = null;

    const root = document.createElement('div');
    root.className = 'term';
    body.appendChild(root);

    const out = document.createElement('div');
    root.appendChild(out);

    const row = document.createElement('div');
    row.className = 'row';
    const prompt = document.createElement('span');
    prompt.className = 'pr';
    const input = document.createElement('input');
    input.type = 'text';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    row.appendChild(prompt);
    row.appendChild(input);
    root.appendChild(row);

    function setPrompt() { prompt.textContent = 'alex@lexos:' + L.fs.pretty(cwd) + '$'; }
    function scroll() { root.scrollTop = root.scrollHeight; }
    function line(text, cls) {
      const d = document.createElement('div');
      d.className = 'l ' + (cls || 'out');
      d.textContent = text;
      out.appendChild(d);
      scroll();
      return d;
    }
    const say = t => line(t, 'out');
    const err = t => line(t, 'err');

    // ---------- Commandes ----------
    const cmds = {
      help() {
        say('Commandes disponibles :\n' +
          '  help          cette aide\n' +
          '  ls [-a]       liste les fichiers (-a : avec les cachés)\n' +
          '  cd <dossier>  change de dossier\n' +
          '  pwd           montre où tu es\n' +
          '  cat <fichier> lit un fichier\n' +
          '  mkdir <nom>   crée un dossier\n' +
          '  touch <nom>   crée un fichier vide\n' +
          '  echo <texte>  affiche du texte (echo "a" > f.txt écrit dans un fichier)\n' +
          '  rm [-r] <x>   supprime\n' +
          '  clear         nettoie l\'écran\n' +
          '  whoami, date, uname, history\n' +
          '  lexfetch      infos du système\n' +
          '  lexos help    commandes spéciales LexOS\n' +
          '\nAstuces : flèche haut = historique, Tab = compléter.');
        return true;
      },

      pwd() { say(cwd); return true; },

      ls(args, info) {
        let all = false; const paths = [];
        args.forEach(a => {
          if (a[0] === '-' && a.length > 1) { if (a.indexOf('a') >= 0) all = true; }
          else paths.push(a);
        });
        info.flagA = all;
        const target = paths.length ? paths : ['.'];
        let ok = true;
        target.forEach((p, i) => {
          const abs = L.fs.resolve(cwd, p);
          const n = L.fs.get(abs);
          if (!n) { err('ls: impossible d\'accéder à \'' + p + '\': aucun fichier ou dossier de ce nom'); ok = false; return; }
          if (n.t === 'f') { say(p); return; }
          if (target.length > 1) say((i ? '\n' : '') + p + ':');
          let names = L.fs.list(abs, all);
          if (all) names = ['.', '..'].concat(names);
          const shown = names.map(nm => {
            const c = (nm === '.' || nm === '..') ? { t: 'd' } : n.c[nm];
            return c.t === 'd' ? nm + '/' : nm;
          });
          say(shown.length ? shown.join('   ') : '(vide)');
        });
        return ok;
      },

      cd(args) {
        const p = args[0] || '~';
        const abs = L.fs.resolve(cwd, p);
        const n = L.fs.get(abs);
        if (!n) { err('cd: ' + p + ': aucun fichier ou dossier de ce nom'); return false; }
        if (n.t !== 'd') { err('cd: ' + p + ': n\'est pas un dossier'); return false; }
        cwd = abs; setPrompt(); return true;
      },

      cat(args, info) {
        if (!args.length) { err('cat: il faut un nom de fichier. Exemple : cat bienvenue.txt'); return false; }
        let ok = true;
        args.forEach(p => {
          const abs = L.fs.resolve(cwd, p);
          const n = L.fs.get(abs);
          if (!n) { err('cat: ' + p + ': aucun fichier ou dossier de ce nom'); ok = false; }
          else if (n.t === 'd') { err('cat: ' + p + ': est un dossier'); ok = false; }
          else { say(n.c); info.paths.push(abs); }
        });
        return ok;
      },

      mkdir(args) {
        if (!args.length) { err('mkdir: il faut un nom. Exemple : mkdir projets'); return false; }
        let ok = true;
        args.filter(a => a[0] !== '-').forEach(p => {
          const abs = L.fs.resolve(cwd, p);
          const { dir, name } = L.fs.parentOf(abs);
          if (!name) { err('mkdir: nom invalide'); ok = false; }
          else if (L.fs.get(abs)) { err('mkdir: impossible de créer \'' + p + '\': existe déjà'); ok = false; }
          else if (!dir || dir.t !== 'd') { err('mkdir: impossible de créer \'' + p + '\': le dossier parent n\'existe pas'); ok = false; }
          else { dir.c[name] = { t: 'd', c: {} }; }
        });
        return ok;
      },

      touch(args) {
        if (!args.length) { err('touch: il faut un nom de fichier'); return false; }
        let ok = true;
        args.forEach(p => {
          const abs = L.fs.resolve(cwd, p);
          const { dir, name } = L.fs.parentOf(abs);
          if (!dir || dir.t !== 'd' || !name) { err('touch: impossible de créer \'' + p + '\''); ok = false; }
          else if (!dir.c[name]) dir.c[name] = { t: 'f', c: '' };
        });
        return ok;
      },

      rm(args) {
        const rec = args.some(a => /^-[a-z]*[rR]/.test(a));
        const files = args.filter(a => a[0] !== '-');
        if (!files.length) { err('rm: il faut dire quoi supprimer'); return false; }
        let ok = true;
        files.forEach(p => {
          const abs = L.fs.resolve(cwd, p);
          const depth = abs.split('/').filter(Boolean).length;
          if (depth < 3) {
            err('rm: bien essayé 😈 mais le système est protégé (c\'est une simulation, tu ne peux rien casser de grave).');
            ok = false; return;
          }
          const n = L.fs.get(abs);
          if (!n) { err('rm: impossible de supprimer \'' + p + '\': aucun fichier ou dossier de ce nom'); ok = false; return; }
          if (n.t === 'd' && !rec) { err('rm: \'' + p + '\' est un dossier. Utilise rm -r ' + p); ok = false; return; }
          if (cwd === abs || cwd.startsWith(abs + '/')) { err('rm: tu es dedans! Sors-en d\'abord avec cd ..'); ok = false; return; }
          const { dir, name } = L.fs.parentOf(abs);
          delete dir.c[name];
        });
        return ok;
      },

      echo() { return true; }, // géré dans run() (à cause de la redirection >)
      clear() { out.innerHTML = ''; return true; },
      whoami() { say('alex'); return true; },
      date() { say(new Date().toLocaleString('fr-CA', { dateStyle: 'full', timeStyle: 'medium' })); return true; },

      uname(args) {
        say(args.indexOf('-a') >= 0
          ? 'Linux lexos 6.12.0-lexos #1 SMP LexOS 2.0.3 Nomad x86_64 GNU/Linux'
          : 'Linux');
        return true;
      },

      history() {
        const h = S.history;
        say(h.length ? h.map((c, i) => String(i + 1).padStart(4) + '  ' + c).join('\n') : '(historique vide)');
        return true;
      },

      lexfetch() {
        const d = line(LOGO, 'logo'); d.style.fontSize = '11px';
        say('  alex@lexos\n' +
          '  ---------------------\n' +
          '  OS        : LexOS 2.0.3 Nomad\n' +
          '  Base      : Debian trixie 13.7\n' +
          '  Noyau     : 6.12.0-lexos\n' +
          '  Shell     : lexsh (simulé)\n' +
          '  Thème     : ' + (S.theme === 'halloween' ? 'Halloween (démon)' : 'Pro (noir/orange)') + '\n' +
          '  Gardien   : TI-LEX-AL');
        return true;
      },

      sudo(args) {
        const jokes = [
          'alex n\'est pas dans le fichier sudoers. Cet incident sera rapporté... à TI-LEX-AL. 😈',
          'sudo ? Ici, c\'est TOI le patron de ta machine. Pas besoin de demander la permission.',
          'Le démon a bien vu ta tentative. Il hausse un sourcil rouge.',
          'Permission refusée. Mais l\'intention était belle.'
        ];
        say(jokes[Math.floor(Math.random() * jokes.length)]);
        return args.length > 0;
      },

      lexos(args, info) {
        const sub = args[0];
        if (!sub) {
          line(LOGO, 'logo');
          say('\n  Play. Build. Own your machine.\n  Tape « lexos help » pour voir les commandes LexOS.');
          return true;
        }
        if (sub === 'help') {
          say('Commandes LexOS :\n' +
            '  lexos              affiche le logo\n' +
            '  lexos help         cette aide\n' +
            '  lexos update       cherche des mises à jour (simulé)\n' +
            '  lexos theme        montre le thème actuel\n' +
            '  lexos theme pro        thème noir/orange\n' +
            '  lexos theme halloween  thème démon\n' +
            '  lexos reset        remet tes fichiers à zéro');
          return true;
        }
        if (sub === 'update') {
          busy = true; input.disabled = true;
          const steps = [
            'Connexion au dépôt LexOS... (simulé)',
            'Lecture de la liste des paquets... fait',
            'Calcul des mises à jour... fait',
            'Tout est à jour : LexOS 2.0.3 Nomad. Rien à installer.'
          ];
          let i = 0;
          const next = () => {
            if (i < steps.length) { say(steps[i++]); setTimeout(next, 550); }
            else { busy = false; input.disabled = false; input.focus(); }
          };
          next();
          return true;
        }
        if (sub === 'theme') {
          const t = args[1];
          if (!t) { say('Thème actuel : ' + S.theme + '\nChoix : pro, halloween'); return true; }
          if (t !== 'pro' && t !== 'halloween') { err('lexos theme: thème inconnu « ' + t + ' ». Choix : pro, halloween'); return false; }
          L.setTheme(t);
          say(t === 'halloween' ? 'Thème Halloween activé. Le démon se réveille... 🎃' : 'Thème Pro activé. Retour au noir et orange.');
          return true;
        }
        if (sub === 'reset') {
          L.fs.root = null; L.state.fs = null; L.fs.init();
          cwd = L.fs.HOME; setPrompt();
          say('Fichiers remis à zéro. (Tes missions réussies restent sauvegardées.)');
          return true;
        }
        err('lexos: sous-commande inconnue « ' + sub + ' ». Essaie : lexos help');
        return false;
      }
    };

    // ---------- Exécution ----------
    function run(raw) {
      const text = raw.trim();
      line(prompt.textContent + ' ' + raw, 'in');
      if (!text) return;
      S.history.push(text);
      histIdx = null;

      const parsed = tokenize(text);
      if (parsed.error) { err('erreur : ' + parsed.error); return; }
      const toks = parsed.toks;
      if (!toks.length) return;

      // Redirection : cmd ... > fichier
      let redirect = null, words = toks;
      const opAt = toks.findIndex(t => t.op);
      if (opAt >= 0) {
        const target = toks[opAt + 1];
        if (!target || target.op) { err('erreur : il manque le nom du fichier après ' + toks[opAt].v); return; }
        redirect = { mode: toks[opAt].v, path: target.v };
        words = toks.slice(0, opAt);
      }
      if (!words.length) return;

      const cmd = words[0].v;
      const args = words.slice(1).map(t => t.v);
      const info = { cmd, args, paths: [], ok: false, flagA: false };

      if (!Object.prototype.hasOwnProperty.call(cmds, cmd)) {
        err(cmd + ': commande introuvable. Tape « help » pour voir ce qui existe.');
        L.missions.onCommand(info);
        return;
      }

      if (redirect) {
        if (cmd !== 'echo') { err('Dans ce jeu, « > » marche seulement avec echo. Exemple : echo "salut" > fichier.txt'); return; }
        const abs = L.fs.resolve(cwd, redirect.path);
        const { dir, name } = L.fs.parentOf(abs);
        if (!dir || dir.t !== 'd' || !name) { err('erreur : ' + redirect.path + ': le dossier n\'existe pas (crée-le avec mkdir)'); return; }
        if (dir.c[name] && dir.c[name].t === 'd') { err('erreur : ' + redirect.path + ' est un dossier'); return; }
        const txt = args.join(' ') + '\n';
        if (redirect.mode === '>>' && dir.c[name]) dir.c[name].c += txt;
        else dir.c[name] = { t: 'f', c: txt };
        info.ok = true;
      } else if (cmd === 'echo') {
        say(args.join(' '));
        info.ok = true;
      } else {
        info.ok = !!cmds[cmd](args, info);
      }

      L.bus.emit('fs');
      L.missions.onCommand(info);
    }

    // ---------- Tab ----------
    function complete() {
      const v = input.value;
      const caret = input.selectionStart;
      const before = v.slice(0, caret);
      const m = before.match(/(^|\s)([^\s]*)$/);
      const word = m[2];
      const first = before.slice(0, before.length - word.length).trim() === '';
      let cands = [];
      let prefix = '';
      if (first) {
        cands = COMMANDS.filter(c => c.startsWith(word));
      } else {
        const slash = word.lastIndexOf('/');
        const dpart = slash >= 0 ? word.slice(0, slash + 1) : '';
        const base = slash >= 0 ? word.slice(slash + 1) : word;
        prefix = dpart;
        const names = L.fs.list(L.fs.resolve(cwd, dpart || '.'), base.startsWith('.')) || [];
        cands = names.filter(n => n.startsWith(base)).map(n => {
          const node = L.fs.get(L.fs.resolve(cwd, dpart + n));
          return n + (node && node.t === 'd' ? '/' : '');
        });
      }
      if (!cands.length) return;
      let common = cands[0];
      cands.forEach(c => { while (!c.startsWith(common)) common = common.slice(0, -1); });
      const base = first ? word : word.slice(prefix.length);
      let done = common;
      if (cands.length === 1 && !done.endsWith('/')) done += ' ';
      if (cands.length > 1 && common.length === base.length) line(prompt.textContent + ' ' + v + '\n' + cands.join('   '), 'out');
      const newWord = prefix + done;
      input.value = before.slice(0, before.length - word.length) + newWord + v.slice(caret);
      const pos = before.length - word.length + newWord.length;
      input.setSelectionRange(pos, pos);
    }

    input.addEventListener('keydown', ev => {
      if (busy) { ev.preventDefault(); return; }
      if (ev.key === 'Enter') { const v = input.value; input.value = ''; run(v); setPrompt(); }
      else if (ev.key === 'Tab') { ev.preventDefault(); complete(); }
      else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        const h = S.history; if (!h.length) return;
        histIdx = histIdx === null ? h.length - 1 : Math.max(0, histIdx - 1);
        input.value = h[histIdx];
      } else if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        const h = S.history; if (histIdx === null) return;
        histIdx++;
        if (histIdx >= h.length) { histIdx = null; input.value = ''; } else input.value = h[histIdx];
      } else if (ev.key === 'l' && ev.ctrlKey) { ev.preventDefault(); out.innerHTML = ''; }
    });
    root.addEventListener('mouseup', () => { if (!String(window.getSelection())) input.focus(); });

    setPrompt();
    say('LexOS 2.0.3 Nomad — terminal simulé.\nTape « help » pour commencer. Ouvre aussi l\'appli Missions dans le dock.');
    setTimeout(() => input.focus(), 30);
    return { focus: () => input.focus() };
  }

  L.createTerminal = createTerminal;
})();
