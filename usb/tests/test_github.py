"""Jeton GitHub : gardé sur le PC (0600), jamais renvoyé à l'app, utilisé par git sans être écrit dans le projet."""
import http.client
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

USB = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(USB / "lexos-ia"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import lexos_ia_app as app  # noqa: E402
from faux_ollama import FauxOllama  # noqa: E402

JETON = "github_pat_" + "A1b2C3d4E5" * 5


@unittest.skipUnless(shutil.which("git"), "git absent")
class TestJetonGithub(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.patchs = [mock.patch.object(app, "FICHIER_JETON", cls.tmp / "config" / "github.json"),
                      mock.patch.object(app, "DOSSIER_PROJETS", cls.tmp / "projets")]
        for p in cls.patchs:
            p.start()
        cls.faux = FauxOllama()
        os.environ["LEXOS_IA_HOTE"] = cls.faux.hote
        cls.serveur = ThreadingHTTPServer(("127.0.0.1", 0), app.App)
        cls.serveur.adresse = f"127.0.0.1:{cls.serveur.server_address[1]}"
        threading.Thread(target=cls.serveur.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.serveur.shutdown()
        cls.faux.arreter()
        for p in cls.patchs:
            p.stop()
        os.environ.pop("LEXOS_IA_HOTE", None)
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def requete(self, methode, chemin, corps=None):
        c = http.client.HTTPConnection(*self.serveur.server_address, timeout=60)
        c.request(methode, chemin, body=json.dumps(corps).encode() if corps is not None else None,
                  headers={"Host": self.serveur.adresse, "X-LexOS-Jeton": app.JETON, "Content-Type": "application/json"})
        r = c.getresponse()
        donnees = r.read()
        c.close()
        return r.status, donnees

    def faux_github(self, depot_local):
        def api(methode, chemin, jeton, corps=None):
            self.assertEqual(jeton, JETON)
            if chemin == "/user":
                return 200, {"login": "alex-test"}, {"X-OAuth-Scopes": ""}
            if chemin == "/user/repos":
                self.appels.append(corps)
                return 201, {"clone_url": str(depot_local)}, {}
            return 404, {}, {}
        return api

    def test_1_jeton_refuse_ou_garde(self):
        code, corps = self.requete("POST", "/api/github/jeton", {"jeton": "mot-de-passe"})
        self.assertEqual(code, 400)
        with mock.patch.object(app, "api_github", lambda *a, **k: (401, {}, {})):
            code, corps = self.requete("POST", "/api/github/jeton", {"jeton": JETON})
        self.assertEqual(code, 400)
        self.assertIn("refuse", json.loads(corps)["erreur"])
        self.appels = []
        with mock.patch.object(app, "api_github", self.faux_github(None)):
            code, corps = self.requete("POST", "/api/github/jeton", {"jeton": JETON})
        self.assertEqual(code, 200, corps)
        self.assertEqual(json.loads(corps)["login"], "alex-test")
        self.assertEqual(stat.S_IMODE(app.FICHIER_JETON.stat().st_mode), 0o600)   # lisible par toi seul
        code, corps = self.requete("GET", "/api/github")
        self.assertEqual(json.loads(corps), {"connecte": True, "login": "alex-test"})
        self.assertNotIn(JETON.encode(), corps)                                     # jamais renvoyé à l'app

    def test_2_creer_depot_et_envoyer(self):
        app.sauver_jeton(JETON, "alex-test")
        nu = self.tmp / "github" / "mon-site.git"
        subprocess.run(["git", "init", "-q", "--bare", str(nu)], check=True)
        projet = self.tmp / "projets" / "mon-site"
        projet.mkdir(parents=True)
        (projet / "index.html").write_text("<h1>Salut</h1>")
        self.appels = []
        with mock.patch.object(app, "api_github", self.faux_github(nu)):
            code, corps = self.requete("POST", "/api/projet/github/creer", {"nom": "mon-site", "prive": True})
        self.assertEqual(code, 200, corps)
        lignes = [json.loads(l) for l in corps.splitlines()]
        self.assertEqual(lignes[-1], {"fin": 0}, lignes)
        self.assertEqual(self.appels, [{"name": "mon-site", "private": True, "description": "Créé avec LexOS IA (clé USB-C)"}])
        log = subprocess.run(["git", "--git-dir", str(nu), "log", "--format=%an|%s", "main"], capture_output=True, text=True).stdout
        self.assertIn("|Premier envoi depuis LexOS IA", log)                        # commit arrivé sur le dépôt
        self.assertNotIn(JETON, (projet / ".git" / "config").read_text())           # jeton jamais écrit dans le projet
        self.assertNotIn(JETON, corps.decode())

    def test_3_git_utilise_le_jeton_pour_github(self):
        app.sauver_jeton(JETON, "alex-test")
        r = subprocess.run(["git", "config", "--get", "http.https://github.com/.extraheader"],
                           capture_output=True, text=True, env=app.env_git())
        self.assertTrue(r.stdout.startswith("AUTHORIZATION: basic "))
        self.assertEqual(app.cacher_jeton(f"erreur {JETON} ici"), "erreur *** ici")
        code, _ = self.requete("POST", "/api/github/oublier", {})
        self.assertEqual(code, 200)
        self.assertFalse(app.FICHIER_JETON.exists())
        valeurs = [v for k, v in app.env_git().items() if k.startswith("GIT_CONFIG_VALUE_")]
        self.assertFalse(any("AUTHORIZATION" in v for v in valeurs))               # plus de jeton


if __name__ == "__main__":
    unittest.main()
