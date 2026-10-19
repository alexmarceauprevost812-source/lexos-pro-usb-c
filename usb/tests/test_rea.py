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


if __name__ == "__main__":
    unittest.main()
