"""Test de REA sur la clé : l'agent ti-lex appelle un outil puis répond, avec un faux moteur.

Il faut le code de REA : variable REA_SOURCE = dossier du dépôt ti-lex-ia-REA- (sinon le test est sauté).
"""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

USB = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from faux_ollama import FauxOllama  # noqa: E402

SOURCE = Path(os.environ.get("REA_SOURCE", "")) if os.environ.get("REA_SOURCE") else None
COEUR = ["__init__.py", "agent.py", "config.py", "memory.py", "ollama_client.py", "params.py", "tools.py"]


@unittest.skipUnless(SOURCE and (SOURCE / "ti_lex_agent" / "agent.py").exists(), "REA_SOURCE absent")
class TestREA(unittest.TestCase):
    def test_rea_appelle_un_outil_dans_le_projet(self):
        faux = FauxOllama()
        try:
            with tempfile.TemporaryDirectory() as d:
                cle = Path(d) / "lexos-ia"
                shutil.copytree(USB / "lexos-ia", cle)
                (cle / "rea" / "ti_lex_agent").mkdir(parents=True)
                for f in COEUR:
                    shutil.copy(SOURCE / "ti_lex_agent" / f, cle / "rea" / "ti_lex_agent" / f)
                projet = cle / "projets" / "meteo"
                projet.mkdir(parents=True)
                (projet / "index.html").write_text("<h1>Météo</h1>")
                env = dict(os.environ, LEXOS_IA_HOTE=faux.hote, NO_COLOR="1", HOME=d)
                r = subprocess.run([sys.executable, str(cle / "rea_lexos.py"), "meteo"],
                                   input="liste les fichiers du projet\n/quitter\n",
                                   capture_output=True, text=True, env=env, timeout=60)
                self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
                self.assertIn("list_files", r.stdout)                 # l'outil a été appelé
                self.assertIn("Voici les fichiers du projet", r.stdout)
                self.assertIn("index.html", r.stdout)                  # dans le bon projet
                self.assertIn("projet : 📁 meteo", r.stdout)
                envoye = [q for q in faux.requetes if q[0] == "/api/chat" and q[1].get("tools")]
                self.assertTrue(envoye and envoye[0][1]["model"] == "llama3.2:3b")  # modèle qui sait utiliser des outils
                self.assertFalse((cle / "rea" / "ti_lex_agent" / "modelops.py").exists())
        finally:
            faux.arreter()


@unittest.skipUnless(SOURCE and (SOURCE / "ti_lex_agent" / "agent.py").exists(), "REA_SOURCE absent")
class TestREADansLApp(unittest.TestCase):
    """REA dans l'interface TI-LEX-AL : outils en direct et permissions données dans l'app."""

    @classmethod
    def setUpClass(cls):
        import threading
        from http.server import ThreadingHTTPServer
        sys.path.insert(0, str(USB / "lexos-ia"))
        import lexos_ia_app as app
        cls.app = app
        cls.faux = FauxOllama()
        os.environ["LEXOS_IA_HOTE"] = cls.faux.hote
        cls.tmp = tempfile.mkdtemp()
        app.DOSSIER_REA = Path(cls.tmp) / "rea"
        (app.DOSSIER_REA / "ti_lex_agent").mkdir(parents=True)
        for f in COEUR:
            shutil.copy(SOURCE / "ti_lex_agent" / f, app.DOSSIER_REA / "ti_lex_agent" / f)
        app.DOSSIER_PROJETS = Path(cls.tmp) / "projets"
        (app.DOSSIER_PROJETS / "meteo").mkdir(parents=True)
        (app.DOSSIER_PROJETS / "meteo" / "index.html").write_text("<h1>Météo</h1>")
        os.environ["TILEX_MEMORY"] = str(Path(cls.tmp) / "rea-memoire.md")
        cls.serveur = ThreadingHTTPServer(("127.0.0.1", 0), app.App)
        cls.serveur.adresse = f"127.0.0.1:{cls.serveur.server_address[1]}"
        threading.Thread(target=cls.serveur.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.serveur.shutdown()
        cls.faux.arreter()
        os.environ.pop("LEXOS_IA_HOTE", None)
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def requete(self, chemin, corps):
        import http.client
        import json
        c = http.client.HTTPConnection(*self.serveur.server_address, timeout=30)
        c.request("POST", chemin, body=json.dumps(corps).encode(), headers={
            "Host": self.serveur.adresse, "X-LexOS-Jeton": self.app.JETON, "Content-Type": "application/json"})
        return c, c.getresponse()

    def demander(self, texte, repondre=None):
        """Lit le flux de REA ; `repondre` = True/False quand REA demande une permission."""
        import json
        c, r = self.requete("/api/rea/demander", {"texte": texte, "projet": "meteo"})
        self.assertEqual(r.status, 200)
        lignes = []
        while True:
            ligne = r.fp.readline()
            if not ligne:
                break
            obj = json.loads(ligne)
            lignes.append(obj)
            if "confirmer" in obj:
                c2, r2 = self.requete("/api/rea/repondre", {"id": obj["id"], "oui": repondre})
                self.assertEqual(r2.status, 200); r2.read(); c2.close()
        c.close()
        return lignes

    def test_outil_dans_le_projet(self):
        lignes = self.demander("liste les fichiers")
        self.assertEqual(lignes[0]["info"]["projet"], "meteo")
        self.assertTrue(any("list_files" in l.get("outil", "") for l in lignes))
        self.assertIn("index.html", "".join(l.get("t", "") for l in lignes))
        self.assertTrue(lignes[-1].get("fin"))

    def test_permission_oui_puis_non(self):
        lignes = self.demander("lance une commande", repondre=True)
        self.assertTrue(any("echo Bonjour de REA" in l.get("confirmer", "") for l in lignes))
        self.assertIn("Bonjour de REA", "".join(l.get("t", "") for l in lignes))  # la commande a tourné
        lignes = self.demander("lance une commande", repondre=False)
        self.assertNotIn("Bonjour de REA\n", "".join(l.get("t", "") for l in lignes))  # refusée : rien exécuté


if __name__ == "__main__":
    unittest.main()
