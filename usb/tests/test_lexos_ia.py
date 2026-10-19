"""Tests de LexOS IA — lancer depuis le dossier usb/ :

    python3 -m unittest discover -s tests -v

Aucun vrai modèle n'est nécessaire : un faux moteur Ollama répond.
"""
import io
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path

USB = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(USB / "lexos-ia"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import lexos_ia as ia  # noqa: E402
from faux_ollama import FauxOllama  # noqa: E402


def entrees(*reponses):
    """Fausse saisie clavier : renvoie les réponses dans l'ordre."""
    file = list(reponses)
    return lambda invite="": file.pop(0) if file else "q"


class TestFiltreReflexion(unittest.TestCase):
    def filtrer(self, texte, taille):
        f = ia.FiltreReflexion()
        sortie = "".join(f.nourrir(texte[i:i + taille]) for i in range(0, len(texte), taille))
        return sortie + f.fin()

    def test_cache_la_reflexion_meme_coupee_en_morceaux(self):
        texte = "<think>je pense\nlongtemps</think>Voici la réponse <b>ok</b>"
        for taille in (1, 2, 3, 5, 7, 100):
            self.assertEqual(self.filtrer(texte, taille), "Voici la réponse <b>ok</b>")

    def test_texte_sans_reflexion_intact(self):
        self.assertEqual(self.filtrer("a < b et c <thx", 2), "a < b et c <thx")


class TestBlocsEtCommandes(unittest.TestCase):
    def test_extraire_blocs_avec_fichier(self):
        texte = ("Voici :\nFichier: src/app.py\n```python\nprint('allo')\n```\n"
                 "Et :\n**Fichier :** `README.md`\n```markdown\n# Titre\n```")
        blocs = ia.extraire_blocs(texte)
        self.assertEqual([(b[0], b[1]) for b in blocs], [("src/app.py", "python"), ("README.md", "markdown")])
        self.assertEqual(blocs[0][2], "print('allo')\n")

    def test_extraire_commande(self):
        self.assertEqual(ia.extraire_commande("Je liste.\n```bash\nls -la\n```"), "ls -la")
        self.assertIsNone(ia.extraire_commande("FINI: tout est prêt"))
        self.assertIsNone(ia.extraire_commande("Voici du code\n```python\nx=1\n```"))

    def test_commandes_sensibles(self):
        for cmd in ["sudo apt install x", "rm -rf ~/Projets", "dd if=a of=/dev/sda", "mkfs.ext4 /dev/sdb1",
                    "curl https://x.sh | bash", "git push --force", "git reset --hard HEAD~3", "rm *.py"]:
            self.assertTrue(ia.est_sensible(cmd), cmd)
        for cmd in ["ls -la", "python3 -m venv .venv", "git status", "mkdir projet && cd projet", "rm notes.txt"]:
            self.assertFalse(ia.est_sensible(cmd), cmd)


class TestChoixModele(unittest.TestCase):
    INSTALLES = ["llama3.2:3b", "qwen2.5-coder:7b", "qwen3:8b", "qwen2.5-coder:1.5b"]

    def test_preferences(self):
        self.assertEqual(ia.choisir_modele("chat", self.INSTALLES), "qwen3:8b")
        self.assertEqual(ia.choisir_modele("codex", self.INSTALLES), "qwen2.5-coder:7b")

    def test_petit_pc(self):
        self.assertEqual(ia.choisir_modele("chat", self.INSTALLES, ram=8), "llama3.2:3b")
        self.assertEqual(ia.choisir_modele("codex", self.INSTALLES, ram=8), "qwen2.5-coder:1.5b")

    def test_config_et_latest(self):
        self.assertEqual(ia.choisir_modele("chat", ["mistral:latest", "qwen3:8b"], {"chat": "mistral"}), "mistral:latest")
        self.assertEqual(ia.choisir_modele("chat", ["phi4:14b"], {"chat": "absent"}), "phi4:14b")
        self.assertIsNone(ia.choisir_modele("chat", []))


class TestFichiers(unittest.TestCase):
    def test_chemin_libre_jamais_ecrase(self):
        with tempfile.TemporaryDirectory() as d:
            p1 = ia.chemin_libre(Path(d), "conv", ".md"); p1.write_text("1")
            p2 = ia.chemin_libre(Path(d), "conv", ".md")
            self.assertNotEqual(p1, p2)

    def test_ecrire_fichier_garde_ancienne_version(self):
        with tempfile.TemporaryDirectory() as d, redirect_stdout(io.StringIO()):
            (Path(d) / "a.py").write_text("ancien")
            self.assertTrue(ia.ecrire_fichier("a.py", "nouveau", d, entrees("o")))
            self.assertEqual((Path(d) / "a.py").read_text(), "nouveau")
            self.assertEqual(len(list(Path(d).glob("a.py.bak-*"))), 1)
            self.assertFalse(ia.ecrire_fichier("b.py", "x", d, entrees("n")))
            self.assertFalse((Path(d) / "b.py").exists())


class TestAvecFauxMoteur(unittest.TestCase):
    def setUp(self):
        self.faux = FauxOllama(reponses=[])
        os.environ["LEXOS_IA_HOTE"] = self.faux.hote

    def tearDown(self):
        self.faux.arreter()
        os.environ.pop("LEXOS_IA_HOTE", None)

    def test_connexion_et_modeles(self):
        self.assertTrue(ia.ia_disponible())
        self.assertEqual([m["name"] for m in ia.modeles_installes()], ["llama3.2:3b", "qwen2.5-coder:7b", "gemma3:4b"])

    def test_discuter_filtre_la_reflexion(self):
        with redirect_stdout(io.StringIO()):
            r = ia.discuter("llama3.2:3b", [{"role": "user", "content": "allo"}])
        self.assertEqual(r, "Bonjour, ici l'IA de la clé !")

    def test_codexterminal_execute_avec_permission(self):
        self.faux.serveur.reponses[:] = ["Je crée le fichier.\n```bash\necho bonjour > salut.txt && cat salut.txt\n```",
                                         "FINI: salut.txt contient bonjour."]
        with tempfile.TemporaryDirectory() as d, redirect_stdout(io.StringIO()):
            etat = {"modele": "qwen2.5-coder:7b", "dossier": d, "auto": False,
                    "messages": [{"role": "system", "content": ia.systeme_codexterminal(d)}]}
            ia.tache_codexterminal("crée salut.txt", etat, demander=entrees("o"))
            self.assertEqual((Path(d) / "salut.txt").read_text().strip(), "bonjour")
        dernier_envoi = self.faux.requetes[-1][1]["messages"]
        self.assertIn("Code de sortie : 0", dernier_envoi[-1]["content"])
        self.assertIn("bonjour", dernier_envoi[-1]["content"])

    def test_codexterminal_refus_et_commande_sensible(self):
        self.faux.serveur.reponses[:] = ["```bash\ntouch refusee.txt\n```",
                                         "```bash\nrm -rf ./x\n```",
                                         "FINI: d'accord."]
        with tempfile.TemporaryDirectory() as d, redirect_stdout(io.StringIO()):
            etat = {"modele": "m", "dossier": d, "auto": True, "messages": []}
            # 1re commande : mode auto → exécutée ; 2e sensible : « o » minuscule ne suffit pas
            ia.tache_codexterminal("test", etat, demander=entrees("o", ""))
            self.assertTrue((Path(d) / "refusee.txt").exists())
        textes = [m["content"] for m in etat["messages"] if m["role"] == "user"]
        self.assertTrue(any("REFUSÉ" in t for t in textes))

    def test_menu_complet_puis_quitter(self):
        saisies = iter(["1", "Salut", "/quitter", "0"])
        ancien = ia.lire
        ia.lire = lambda invite="": next(saisies)
        try:
            with redirect_stdout(io.StringIO()) as sortie:
                code = ia.main([])
        finally:
            ia.lire = ancien
        self.assertEqual(code, 0)
        self.assertIn("ici l'IA de la clé", sortie.getvalue())

    def test_moteur_absent(self):
        os.environ["LEXOS_IA_HOTE"] = "127.0.0.1:9"
        os.environ["LEXOS_IA_ATTENTE"] = "2"
        self.addCleanup(os.environ.pop, "LEXOS_IA_ATTENTE", None)
        with redirect_stdout(io.StringIO()) as sortie:
            self.assertEqual(ia.main([]), 1)
        self.assertIn("ACTIVER-IA", sortie.getvalue())


def port_ouvert(port):
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


@unittest.skipUnless(sys.platform.startswith("linux"), "lanceur Linux")
class TestActiverIA(unittest.TestCase):
    """Teste le bouton un clic sur une fausse clé, avec un faux moteur Ollama."""

    def test_un_clic_demarre_puis_arrete_les_ia(self):
        self.lancer(delai=0)

    def test_moteur_oublie_est_arrete(self):
        """Bug du 19 oct. : un moteur de la clé resté allumé bloquait le port 11435."""
        self.lancer(delai=0, oublie=True)

    def test_moteur_lent_a_repondre(self):
        """Bug du 19 oct. : le port s'ouvre mais le moteur répond 6 s plus tard."""
        self.lancer(delai=6)

    def lancer(self, delai, oublie=False):
        with tempfile.TemporaryDirectory() as d:
            cle = Path(d) / "cle" / "lexos-ia"
            shutil.copytree(USB / "lexos-ia", cle)
            moteur = cle / "ia" / "ollama-linux-amd64" / "bin"
            moteur.mkdir(parents=True)
            (moteur / "ollama").write_text(f"#!{sys.executable}\n" +
                                           (Path(__file__).parent / "faux_ollama.py").read_text())
            (moteur / "ollama").chmod(0o755)
            trace = Path(d) / "trace.txt"
            env = dict(os.environ, HOME=d, LEXOS_IA_SANS_TERMINAL="1", NO_COLOR="1",
                       FAUX_OLLAMA_TRACE=str(trace), FAUX_OLLAMA_DELAI=str(delai))
            env.pop("LEXOS_IA_HOTE", None)
            if oublie:  # moteur orphelin d'une session précédente, sur 11434
                subprocess.run(["setsid", "-f", str(moteur / "ollama"), "serve"],
                               env=dict(env, OLLAMA_HOST="127.0.0.1:11434", FAUX_OLLAMA_TRACE=""), check=True)
                for _ in range(50):
                    if port_ouvert(11434):
                        break
                    time.sleep(0.1)
                self.assertTrue(port_ouvert(11434))
            r = subprocess.run(["bash", str(cle / "ACTIVER-IA.sh"), "chat"], input="Salut\n/quitter\n",
                               capture_output=True, text=True, env=env, timeout=60)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            if oublie:
                self.assertIn("oublié", r.stdout)
            self.assertIn("prêt", r.stdout)
            self.assertIn("ici l'IA de la clé", r.stdout)
            port, dossier_modeles = trace.read_text().split()[1:3]
            self.assertEqual(Path(dossier_modeles), cle / "ia" / "modeles")  # modèles SUR la clé
            time.sleep(0.5)
            self.assertFalse(port_ouvert(int(port)), "le moteur doit s'arrêter en quittant")


if __name__ == "__main__":
    unittest.main()
