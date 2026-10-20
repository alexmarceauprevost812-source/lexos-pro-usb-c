"""Tests de l'application TI-LEX-AL (lexos_ia_app.py) avec un faux moteur Ollama."""
import http.client
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

USB = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(USB / "lexos-ia"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import lexos_ia_app as app  # noqa: E402
from faux_ollama import FauxOllama  # noqa: E402
from http.server import ThreadingHTTPServer  # noqa: E402

PHOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRg=="


class TestApp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.faux = FauxOllama()
        os.environ["LEXOS_IA_HOTE"] = cls.faux.hote
        cls.tmp = tempfile.mkdtemp()
        app.DOSSIER_CONVS = Path(cls.tmp) / "convs"
        app.DOSSIER_PROJETS = Path(cls.tmp) / "projets"
        app.FICHIER_MEMOIRE = Path(cls.tmp) / "memoire" / "memoire.json"
        app.etat_serveur["dossier"] = cls.tmp
        cls.serveur = ThreadingHTTPServer(("127.0.0.1", 0), app.App)
        cls.serveur.adresse = f"127.0.0.1:{cls.serveur.server_address[1]}"
        threading.Thread(target=cls.serveur.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.serveur.shutdown()
        cls.faux.arreter()
        os.environ.pop("LEXOS_IA_HOTE", None)
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def appel(self, methode, chemin, corps=None, jeton=True, hote=None):
        c = http.client.HTTPConnection(*self.serveur.server_address, timeout=20)
        en_tetes = {"Host": hote or self.serveur.adresse, "Content-Type": "application/json"}
        if jeton:
            en_tetes["X-LexOS-Jeton"] = app.JETON if jeton is True else jeton
        c.request(methode, chemin, body=json.dumps(corps).encode() if corps is not None else None, headers=en_tetes)
        r = c.getresponse()
        donnees = r.read()
        c.close()
        return r.status, donnees

    def json(self, *a, **k):
        code, d = self.appel(*a, **k)
        return code, json.loads(d)

    def lignes(self, chemin, corps):
        code, d = self.appel("POST", chemin, corps)
        self.assertEqual(code, 200, d)
        return [json.loads(l) for l in d.decode().splitlines() if l.strip()]

    # ── Sécurité ──
    def test_page_servie_et_chemins_bloques(self):
        code, d = self.appel("GET", "/", jeton=False)
        self.assertEqual(code, 200)
        self.assertIn(b"TI-LEX-AL", d)
        for mauvais in ("/../lexos_ia.py", "/%2e%2e/lexos_ia.py", "/app/../../lexos_ia.py"):
            self.assertEqual(self.appel("GET", mauvais, jeton=False)[0], 404, mauvais)

    def test_api_exige_le_jeton_et_le_bon_hote(self):
        self.assertEqual(self.appel("GET", "/api/etat", jeton=False)[0], 403)
        self.assertEqual(self.appel("GET", "/api/etat", jeton="faux")[0], 403)
        self.assertEqual(self.appel("POST", "/api/exec", {"commande": "echo pirate"}, jeton=False)[0], 403)
        self.assertEqual(self.appel("GET", "/api/etat", hote="evil.example:80")[0], 403)
        code, etat = self.json("GET", "/api/etat")
        self.assertEqual(code, 200)
        self.assertTrue(etat["moteur"])

    # ── Modèles et photos ──
    def test_modeles_avec_vision(self):
        code, d = self.json("GET", "/api/modeles")
        vision = {m["nom"] for m in d["modeles"] if "vision" in m["capacites"]}
        self.assertEqual(vision, {"gemma3:4b"})
        self.assertEqual(d["codex"], "qwen2.5-coder:7b")

    def test_chat_en_flux_sans_reflexion(self):
        lignes = self.lignes("/api/chat", {"mode": "chat", "modele": "llama3.2:3b",
                                           "messages": [{"role": "user", "content": "allo"}]})
        texte = "".join(l.get("t", "") for l in lignes)
        self.assertEqual(texte, "Bonjour, ici l'IA de la clé !")
        pensee = "".join(l.get("pensee", "") for l in lignes)  # mode réflexion : les pensées arrivent à part
        self.assertTrue(pensee.startswith("L'utilisateur me salue"), pensee)
        self.assertNotIn("<think>", texte + pensee)
        self.assertTrue(lignes[-1].get("fin"))
        envoye = self.faux.requetes[-1][1]["messages"]
        self.assertIn("Agent AL", envoye[0]["content"])  # l'invite système est ajoutée

    def test_photo_envoyee_au_modele(self):
        lignes = self.lignes("/api/chat", {"mode": "chat", "modele": "gemma3:4b",
                                           "messages": [{"role": "user", "content": "c'est quoi ?", "images": [PHOTO]}]})
        self.assertIn("1 photo", "".join(l.get("t", "") for l in lignes))
        images = self.faux.requetes[-1][1]["messages"][-1]["images"]
        self.assertEqual(images, ["/9j/4AAQSkZJRg=="])  # en-tête data: retiré

    # ── CodexTerminal ──
    def test_exec_et_commande_sensible(self):
        code, d = self.json("POST", "/api/exec", {"commande": "echo bonjour > a.txt && cat a.txt"})
        self.assertEqual((code, d["code"], d["sortie"]), (200, 0, "bonjour"))
        os.makedirs(os.path.join(self.tmp, "x"), exist_ok=True)
        code, d = self.json("POST", "/api/exec", {"commande": "rm -rf ./x"})
        self.assertEqual(code, 409)
        self.assertTrue(os.path.isdir(os.path.join(self.tmp, "x")))
        code, d = self.json("POST", "/api/exec", {"commande": "rm -rf ./x", "confirme": "oui"})
        self.assertEqual(code, 409)  # il faut OUI en majuscules
        code, d = self.json("POST", "/api/exec", {"commande": "rm -rf ./x", "confirme": "OUI"})
        self.assertEqual(code, 200)
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "x")))

    # ── Équipe IA ──
    def test_equipe_roles_et_sauvegarde(self):
        sys_rev = "Tu es le Réviseur d'une équipe de développeurs IA (LexOS)."
        lignes = self.lignes("/api/chat", {"mode": "equipe", "modele": "llama3.2:3b", "messages": [
            {"role": "system", "content": sys_rev}, {"role": "user", "content": "CODE DU CODEUR : x"}]})
        self.assertTrue("".join(l.get("t", "") for l in lignes).startswith("CORRECTIONS"))
        envoye = self.faux.requetes[-1][1]["messages"]
        self.assertEqual(envoye[0]["content"], sys_rev)  # l'invite du rôle est gardée telle quelle
        code, d = self.json("POST", "/api/conversations", {"titre": "Équipe", "mode": "equipe", "messages": [
            {"role": "user", "content": "fais une moyenne"},
            {"role": "assistant", "content": "plan", "agent": "architecte", "modele": "qwen3:8b"},
            {"role": "assistant", "content": "x", "agent": "pirate"},
            {"role": "verdict", "content": "✔ approuvé", "ok": True}]})
        conv = self.json("GET", f"/api/conversation?id={d['id']}")[1]
        self.assertEqual(conv["messages"][1]["agent"], "architecte")
        self.assertNotIn("agent", conv["messages"][2])  # rôle inconnu ignoré
        self.assertTrue(conv["messages"][3]["ok"])

    # ── Mode téléphone (Wi-Fi) ──
    def test_mode_telephone(self):
        if not app.ip_locale():
            self.skipTest("pas de réseau dans cet environnement")
        ancienne_config = app.ia.FICHIER_CONFIG
        app.ia.FICHIER_CONFIG = Path(self.tmp) / "config.json"
        self.addCleanup(setattr, app.ia, "FICHIER_CONFIG", ancienne_config)
        self.addCleanup(app.desactiver_telephone)
        code, e = self.json("POST", "/api/telephone", {"actif": True})
        self.assertEqual(code, 200)
        m = re.match(r"http://([\d.]+):(\d+)/#t=([\w-]+)&m=tel$", e["url"])
        self.assertIsNotNone(m, e["url"])
        ip, port, jeton = m.group(1), int(m.group(2)), m.group(3)

        def tel(methode, chemin, jeton_=jeton, hote=None, corps=None):
            c = http.client.HTTPConnection(ip, port, timeout=10)
            c.request(methode, chemin, body=json.dumps(corps).encode() if corps is not None else None,
                      headers={"Host": hote or f"{ip}:{port}", "X-LexOS-Jeton": jeton_, "Content-Type": "application/json"})
            r = c.getresponse(); r.read(); c.close()
            return r.status

        self.assertEqual(tel("GET", "/api/modeles"), 200)                    # le téléphone voit les IA
        self.assertEqual(tel("GET", "/api/conversations"), 200)              # et les projets
        self.assertEqual(tel("POST", "/api/ouvrir", corps={"quoi": "terminal"}), 403)  # pas de fenêtres sur le PC
        self.assertEqual(tel("POST", "/api/telephone", corps={"actif": True, "nouveau": True}), 403)
        self.assertEqual(tel("GET", "/api/modeles", jeton_=app.JETON), 403)  # le jeton du PC ne sert pas au Wi-Fi
        self.assertEqual(tel("GET", "/api/modeles", hote="pirate.example:80"), 403)
        self.assertEqual(self.appel("GET", "/api/modeles", jeton=jeton)[0], 403)  # ni l'inverse
        # le code reste le même d'une fois à l'autre (raccourci du téléphone)…
        self.assertIn(jeton, self.json("GET", "/api/telephone")[1]["url"])
        # … jusqu'à « Nouveau code », qui bloque l'ancien
        nouveau = self.json("POST", "/api/telephone", {"actif": True, "nouveau": True})[1]["url"]
        self.assertNotIn(jeton, nouveau)
        self.assertEqual(tel("GET", "/api/modeles"), 403)
        # couper l'accès ferme le port
        self.assertFalse(self.json("POST", "/api/telephone", {"actif": False})[1]["actif"])
        import socket
        with socket.socket() as so:
            self.assertNotEqual(so.connect_ex((ip, port)), 0)

    # ── Projets ──
    def test_projets_fichiers_et_chemins_pieges(self):
        self.assertEqual(self.json("POST", "/api/projet/creer", {"nom": "meteo"})[0], 200)
        self.assertEqual(self.json("POST", "/api/projet/creer", {"nom": "../evil"})[0], 400)
        code, d = self.json("POST", "/api/projet/ecrire", {"nom": "meteo", "chemin": "src/app.py", "contenu": "print(1)"})
        self.assertEqual((code, d["chemin"]), (200, "src/app.py"))
        self.json("POST", "/api/projet/ecrire", {"nom": "meteo", "chemin": "src/app.py", "contenu": "print(2)"})
        self.assertEqual(self.json("GET", "/api/projet/fichier?nom=meteo&chemin=src/app.py")[1]["contenu"], "print(2)")
        hist = list((app.DOSSIER_PROJETS / "meteo" / ".lexos-historique").iterdir())
        self.assertEqual(len(hist), 1)  # l'ancienne version est gardée
        for mauvais in ("../../secret.txt", "/etc/passwd", ".git/config", "a/../../x", ".lexos-historique/x"):
            self.assertEqual(self.json("POST", "/api/projet/ecrire", {"nom": "meteo", "chemin": mauvais, "contenu": "x"})[0], 400, mauvais)
        self.assertEqual(self.json("GET", "/api/projet/fichier?nom=meteo&chemin=../../../etc/passwd")[0], 400)
        fichiers = [f["chemin"] for f in self.json("GET", "/api/projet?nom=meteo")[1]["fichiers"]]
        self.assertEqual(fichiers, ["README.md", "src/app.py"])
        self.json("POST", "/api/projet/supprimer-fichier", {"nom": "meteo", "chemin": "src/app.py"})
        self.assertFalse((app.DOSSIER_PROJETS / "meteo" / "src" / "app.py").exists())
        self.assertIn("meteo", [p["nom"] for p in self.json("GET", "/api/projets")[1]["projets"]])

    @unittest.skipUnless(shutil.which("git"), "git requis")
    def test_github_envoyer_vers_un_depot(self):
        import subprocess as sp
        distant = Path(self.tmp) / "distant.git"
        sp.run(["git", "init", "--bare", "-q", "-b", "main", str(distant)], check=True)
        self.json("POST", "/api/projet/creer", {"nom": "envoi"})
        self.assertEqual(self.json("POST", "/api/projet/github/lier", {"nom": "envoi", "url": "file:///x"})[0], 400)
        code, d = self.json("POST", "/api/projet/github/lier", {"nom": "envoi", "url": "https://github.com/alex/envoi"})
        self.assertEqual((code, d["url"]), (200, "https://github.com/alex/envoi"))
        dossier = app.DOSSIER_PROJETS / "envoi"
        sp.run(["git", "remote", "set-url", "origin", str(distant)], cwd=dossier, check=True)  # GitHub simulé
        lignes = self.lignes("/api/projet/github/envoyer", {"nom": "envoi", "message": "Premier envoi"})
        self.assertEqual(lignes[-1], {"fin": 0}, lignes)
        journal = sp.run(["git", "log", "--format=%s %ae", "main"], cwd=distant, capture_output=True, text=True).stdout
        self.assertIn("Premier envoi", journal)
        self.assertEqual(self.json("POST", "/api/projet/github/cloner", {"url": "https://evil.com/x/y"})[0], 400)

    # ── Studio ──
    def test_apercu_isole(self):
        self.json("POST", "/api/projet/creer", {"nom": "site"})
        self.json("POST", "/api/projet/ecrire", {"nom": "site", "chemin": "index.html", "contenu": "<h1>Allo</h1>"})
        code, d = self.json("POST", "/api/apercu", {"projet": "site"})
        self.assertEqual(code, 200)
        c = http.client.HTTPConnection(*self.serveur.server_address, timeout=10)
        c.request("GET", d["url"], headers={"Host": self.serveur.adresse})
        r = c.getresponse(); corps = r.read(); c.close()
        self.assertEqual((r.status, corps), (200, b"<h1>Allo</h1>"))
        self.assertIn("sandbox", r.getheader("Content-Security-Policy"))  # pas d'accès à l'app ni au jeton
        base = d["url"].rsplit("/", 1)[0]
        self.assertEqual(self.appel("GET", base + "/../../lexos_ia.py", jeton=False)[0], 404)
        self.assertEqual(self.appel("GET", "/apercu/inconnu/index.html", jeton=False)[0], 404)
        self.assertEqual(self.json("POST", "/api/apercu", {"html": "<p>x</p>"}, jeton=False)[0], 403)
        code, d = self.json("POST", "/api/apercu", {"html": "<p>bloc</p>"})
        self.assertEqual(self.appel("GET", d["url"], jeton=False), (200, b"<p>bloc</p>"))

    @unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg requis")
    def test_video_mp4(self):
        import base64, subprocess as sp
        webm = Path(self.tmp) / "essai.webm"
        sp.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10", "-t", "1",
                "-c:v", "libvpx", str(webm)], check=True)
        code, d = self.json("POST", "/api/video-mp4", {"donnees": base64.b64encode(webm.read_bytes()).decode()})
        self.assertEqual(code, 200)
        self.assertEqual(base64.b64decode(d["mp4"])[4:8], b"ftyp")  # vrai fichier MP4
        self.assertEqual(self.json("POST", "/api/video-mp4", {"donnees": "pas du base64 !"})[0], 400)
        self.assertEqual(self.json("POST", "/api/video-mp4", {"donnees": "AAAA"}, jeton=False)[0], 403)
        # assemblage image par image (méthode principale de l'app)
        img = Path(self.tmp) / "img.jpg"
        sp.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=orange:s=320x240", "-frames:v", "1", str(img)], check=True)
        b64 = base64.b64encode(img.read_bytes()).decode()
        code, d = self.json("POST", "/api/video-images", {"images": [b64] * 24, "ips": 24})
        self.assertEqual(code, 200)
        mp4 = Path(self.tmp) / "v.mp4"; mp4.write_bytes(base64.b64decode(d["mp4"]))
        duree = sp.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(mp4)],
                       capture_output=True, text=True).stdout.strip()
        self.assertAlmostEqual(float(duree), 1.0, delta=0.1)  # 24 images à 24 i/s = 1 seconde
        self.assertEqual(self.json("POST", "/api/video-images", {"images": ["iVBORw0KGgo="]})[0], 400)  # pas un JPEG

    # ── Mémoire ──
    def test_memoire_retenir_rappeler_oublier(self):
        self.json("POST", "/api/memoire/supprimer", {"tout": True})
        code, d = self.json("POST", "/api/memoire/ajouter", {"texte": "Utiliser python3 au lieu de python sur ce PC.", "type": "lecon", "source": "terminal"})
        self.assertTrue(d["nouveau"])
        self.assertFalse(self.json("POST", "/api/memoire/ajouter", {"texte": "utiliser python3 au lieu de python sur ce PC."})[1]["nouveau"])  # pas de doublon
        self.json("POST", "/api/memoire/ajouter", {"texte": "Réponds-moi en joual.", "type": "preference"})
        self.json("POST", "/api/memoire/ajouter", {"texte": "Le serveur Apache est sur le port 8080.", "type": "lecon", "source": "codex"})
        self.lignes("/api/chat", {"mode": "chat", "modele": "llama3.2:3b", "messages": [{"role": "user", "content": "comment lancer mon script avec python3 ?"}]})
        consignes = self.faux.requetes[-1][1]["messages"][0]["content"]
        self.assertIn("MÉMOIRE", consignes)
        self.assertIn("python3 au lieu de python", consignes)   # leçon liée à la demande
        self.assertIn("joual", consignes)                       # préférence toujours rappelée
        self.assertNotIn("Apache", consignes)                   # leçon sans rapport : pas rappelée
        entrees = self.json("GET", "/api/memoire")[1]["entrees"]
        self.assertEqual(next(e for e in entrees if "python3" in e["texte"])["utilisations"], 1)
        ident = entrees[0]["id"]
        self.json("POST", "/api/memoire/supprimer", {"id": ident})
        self.assertNotIn(ident, [e["id"] for e in self.json("GET", "/api/memoire")[1]["entrees"]])
        self.assertEqual(self.json("POST", "/api/memoire/ajouter", {"texte": "x"})[0], 400)

    def test_memoire_apprendre_d_une_erreur(self):
        self.json("POST", "/api/memoire/supprimer", {"tout": True})
        contexte = "TÂCHE : version de python\nCOMMANDES QUI ONT ÉCHOUÉ :\n$ pyhton --version\nnot found\nCE QUI A FONCTIONNÉ ENSUITE :\n$ python3 --version"
        d = self.json("POST", "/api/memoire/apprendre", {"source": "terminal", "modele": "qwen2.5-coder:7b", "contexte": contexte})[1]
        self.assertIn("python3", d["lecon"])
        self.assertIsNone(self.json("POST", "/api/memoire/apprendre", {"modele": "m", "contexte": "tout va bien"})[1]["lecon"])
        self.json("POST", "/api/memoire/reglage", {"apprendre": False})
        self.assertIsNone(self.json("POST", "/api/memoire/apprendre", {"modele": "m", "contexte": contexte})[1]["lecon"])
        self.json("POST", "/api/memoire/reglage", {"apprendre": True})
        self.assertEqual(len(self.json("GET", "/api/memoire")[1]["entrees"]), 1)

    # ── Conversations sur la clé ──
    def test_conversations(self):
        code, d = self.json("POST", "/api/conversations", {"titre": "Essai", "mode": "codex", "messages": [
            {"role": "user", "content": "allo", "images": [PHOTO]}, {"role": "assistant", "content": "salut"}]})
        ident = d["id"]
        liste = self.json("GET", "/api/conversations")[1]
        self.assertIn(ident, [c["id"] for c in liste])
        conv = self.json("GET", f"/api/conversation?id={ident}")[1]
        self.assertEqual(conv["messages"][0], {"role": "user", "content": "allo", "photos": 1})
        self.assertEqual(self.json("GET", "/api/conversation?id=../../secret")[0], 400)
        self.json("POST", "/api/supprimer-conversation", {"id": ident})
        self.assertNotIn(ident, [c["id"] for c in self.json("GET", "/api/conversations")[1]])


@unittest.skipUnless(sys.platform.startswith("linux"), "lanceur Linux")
class TestAppUnClic(unittest.TestCase):
    def test_app_ia_demarre_puis_quitter_arrete_tout(self):
        with tempfile.TemporaryDirectory() as d:
            cle = Path(d) / "cle" / "lexos-ia"
            shutil.copytree(USB / "lexos-ia", cle)
            moteur = cle / "ia" / "ollama-linux-amd64" / "bin"
            moteur.mkdir(parents=True)
            (moteur / "ollama").write_text(f"#!{sys.executable}\n" +
                                           (Path(__file__).parent / "faux_ollama.py").read_text())
            (moteur / "ollama").chmod(0o755)
            trace = Path(d) / "trace.txt"
            env = dict(os.environ, HOME=d, NO_COLOR="1", LEXOS_IA_SANS_NAVIGATEUR="1", FAUX_OLLAMA_TRACE=str(trace))
            env.pop("LEXOS_IA_HOTE", None)
            p = subprocess.Popen(["bash", str(cle / "ACTIVER-IA.sh"), "app"], stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, text=True, env=env)
            url = None
            fin = time.time() + 40
            while time.time() < fin and url is None:
                ligne = p.stdout.readline()
                m = re.search(r"http://(127\.0\.0\.1:\d+)/#t=([\w-]+)", ligne)
                if m:
                    url = m
            self.assertIsNotNone(url, "l'app n'a pas affiché son lien")
            hote, jeton = url.group(1), url.group(2)
            c = http.client.HTTPConnection(hote, timeout=10)
            c.request("GET", "/api/modeles", headers={"Host": hote, "X-LexOS-Jeton": jeton})
            self.assertEqual(c.getresponse().status, 200)
            c.close()
            c = http.client.HTTPConnection(hote, timeout=10)
            c.request("POST", "/api/quitter", body=b"{}", headers={"Host": hote, "X-LexOS-Jeton": jeton,
                                                                     "Content-Type": "application/json"})
            self.assertEqual(c.getresponse().status, 200)
            c.close()
            self.assertEqual(p.wait(timeout=20), 0)
            port = int(trace.read_text().split()[1])
            time.sleep(0.5)
            import socket
            with socket.socket() as s:
                self.assertNotEqual(s.connect_ex(("127.0.0.1", port)), 0, "le moteur doit être arrêté")


if __name__ == "__main__":
    unittest.main()
