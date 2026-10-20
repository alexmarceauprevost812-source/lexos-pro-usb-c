"""Images avec Z-Image Turbo : moteur sd-cli imité par tests/faux_sd.py (aucun vrai modèle requis)."""
import http.client
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

ICI = Path(__file__).resolve().parent
USB = ICI.parent
sys.path.insert(0, str(USB / "lexos-ia"))
sys.path.insert(0, str(ICI))
import images_ia  # noqa: E402
from faux_ollama import FauxOllama  # noqa: E402


def installer_faux_moteur(racine, variantes=("linux", "linux-cpu")):
    """Une clé avec le faux moteur et trois faux fichiers de modèle."""
    for v in variantes:
        (racine / v).mkdir(parents=True)
        sd = racine / v / "sd-cli"
        sd.write_text(f'#!/bin/sh\nFAUX_SD_DOSSIER="{v}" exec "{sys.executable}" "{ICI / "faux_sd.py"}" "$@"\n')
        sd.chmod(0o755)
    (racine / "modeles").mkdir(parents=True)
    for nom in ("z_image_turbo-Q6_K.gguf", "Qwen3-4B-Instruct-2507-Q4_K_M.gguf", "ae.safetensors"):
        (racine / "modeles" / nom).write_bytes(b"x")


@unittest.skipIf(os.name == "nt", "le faux moteur est un script shell")
class TestImages(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.patchs = [mock.patch.object(images_ia, "DOSSIER_MOTEUR", self.tmp / "images-ia"),
                       mock.patch.object(images_ia, "DOSSIER_IMAGES", self.tmp / "images"),
                       mock.patch.object(images_ia, "CACHE", self.tmp / "cache")]
        for p in self.patchs:
            p.start()
        images_ia._choix["moteur"] = None
        images_ia._lancables.clear()

    def tearDown(self):
        for p in self.patchs:
            p.stop()
        os.environ.pop("FAUX_SD_ECHEC", None)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_rien_sur_la_cle(self):
        e = images_ia.etat()
        self.assertFalse(e["pret"])
        self.assertIn("moteur", e["manque"])
        with self.assertRaisesRegex(images_ia.ErreurImage, "--images"):
            images_ia.creer("un chat")

    def test_creer_une_image(self):
        installer_faux_moteur(self.tmp / "images-ia")
        self.assertTrue(images_ia.etat()["pret"])
        suivi = []
        info = images_ia.creer("un loup orange, logo néon", "paysage", graine=42, rappel=suivi.append)
        png = self.tmp / "images" / info["nom"]
        self.assertTrue(png.read_bytes().startswith(b"\x89PNG"))
        self.assertEqual((info["largeur"], info["hauteur"], info["graine"]), (1152, 768, 42))
        self.assertTrue(info["nom"].startswith("un-loup-orange-logo-neon-"))
        progres = [o["progres"] for o in suivi if "progres" in o]
        self.assertIn({"etape": 8, "total": 8, "phase": "dessin"}, progres)
        self.assertEqual(progres[-1]["phase"], "finition")          # tuiles du VAE après le dessin
        self.assertEqual(images_ia.lister()[0]["texte"], "un loup orange, logo néon")
        images_ia.supprimer(info["nom"])
        self.assertEqual(images_ia.lister(), [])

    def test_sans_vulkan_on_passe_au_processeur(self):
        installer_faux_moteur(self.tmp / "images-ia")
        os.environ["FAUX_SD_ECHEC"] = "vulkan"
        suivi = []
        info = images_ia.creer("un chat", "rapide", rappel=suivi.append)
        self.assertTrue((self.tmp / "images" / info["nom"]).is_file())
        self.assertTrue(any("processeur" in o.get("info", "") for o in suivi))
        self.assertEqual(images_ia._choix["moteur"].parent.name, "linux-cpu")  # retenu pour la prochaine fois

    def test_cle_sans_droit_execution(self):
        installer_faux_moteur(self.tmp / "images-ia", ("linux",))
        sd = self.tmp / "images-ia" / "linux" / "sd-cli"
        sd.chmod(0o644)                                  # comme une clé exFAT montée « noexec »
        lanceur = images_ia.executable(sd)
        self.assertEqual(lanceur, self.tmp / "cache" / "images-linux" / "sd-cli")
        self.assertTrue(os.access(lanceur, os.X_OK))

    def test_nom_et_texte_verifies(self):
        for mauvais in ("../x.png", "a/b.png", "x.jpg", ""):
            with self.assertRaises(images_ia.ErreurImage):
                images_ia.chemin_image(mauvais)
        installer_faux_moteur(self.tmp / "images-ia")
        with self.assertRaises(images_ia.ErreurImage):
            images_ia.creer("   ")


@unittest.skipIf(os.name == "nt", "le faux moteur est un script shell")
class TestImagesDansLApp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import lexos_ia_app as app
        cls.app = app
        cls.tmp = Path(tempfile.mkdtemp())
        installer_faux_moteur(cls.tmp / "images-ia")
        cls.patchs = [mock.patch.object(images_ia, "DOSSIER_MOTEUR", cls.tmp / "images-ia"),
                      mock.patch.object(images_ia, "DOSSIER_IMAGES", cls.tmp / "images"),
                      mock.patch.object(app, "DOSSIER_PROJETS", cls.tmp / "projets")]
        for p in cls.patchs:
            p.start()
        (cls.tmp / "projets" / "site").mkdir(parents=True)
        cls.faux = FauxOllama()
        cls.faux.serveur.charges = ["qwen3:8b"]
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
                  headers={"Host": self.serveur.adresse, "X-LexOS-Jeton": self.app.JETON,
                           "Content-Type": "application/json"})
        r = c.getresponse()
        donnees = r.read()
        c.close()
        return r.status, r.getheader("Content-Type"), donnees

    def test_creer_voir_et_mettre_dans_un_projet(self):
        code, _, corps = self.requete("POST", "/api/image/creer", {"texte": "une clé USB-C lumineuse", "format": "carre"})
        self.assertEqual(code, 200)
        lignes = [json.loads(l) for l in corps.splitlines()]
        self.assertEqual(self.faux.serveur.charges, [])     # Ollama a libéré la carte graphique
        info = lignes[-1]["image"]
        self.assertTrue(any("progres" in l for l in lignes))
        code, type_, png = self.requete("GET", "/api/image?nom=" + info["nom"])
        self.assertEqual((code, type_), (200, "image/png"))
        self.assertTrue(png.startswith(b"\x89PNG"))
        code, _, corps = self.requete("GET", "/api/images")
        self.assertTrue(json.loads(corps)["etat"]["pret"])
        code, _, corps = self.requete("POST", "/api/image/projet", {"nom": info["nom"], "projet": "site"})
        self.assertEqual(code, 200, corps)
        self.assertTrue((self.tmp / "projets" / "site" / "images" / info["nom"]).is_file())

    def test_jeton_obligatoire(self):
        c = http.client.HTTPConnection(*self.serveur.server_address, timeout=10)
        c.request("GET", "/api/image?nom=x.png", headers={"Host": self.serveur.adresse})
        self.assertEqual(c.getresponse().status, 403)
        c.close()


if __name__ == "__main__":
    unittest.main()
