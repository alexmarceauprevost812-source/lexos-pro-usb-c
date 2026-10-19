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
