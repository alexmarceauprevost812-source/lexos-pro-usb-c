#!/usr/bin/env python3
"""Faux moteur Ollama pour les tests (aucun vrai modèle requis).

- Comme module : FauxOllama(reponses=[...]) démarre un serveur dans un thread.
- Comme programme : imite la commande `ollama` (serve, pull, --version) pour
  tester ACTIVER-IA.sh sans télécharger le vrai moteur.
"""
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODELES = [{"name": "llama3.2:3b", "size": 2_000_000_000},
           {"name": "qwen2.5-coder:7b", "size": 4_700_000_000},
           {"name": "gemma3:4b", "size": 3_300_000_000}]
VISION = {"gemma3:4b"}
REPONSE_DEFAUT = "<think>je réfléchis</think>Bonjour, ici l'IA de la clé !"


def morceaux(texte, n=4):
    """Découpe en petits morceaux, même au milieu des balises <think>."""
    return [texte[i:i + n] for i in range(0, len(texte), n)]


def reponse_auto(messages):
    """Réponses réalistes selon le mode (pour les démos et captures)."""
    systeme = messages[0]["content"] if messages and messages[0]["role"] == "system" else ""
    dernier = messages[-1]["content"] if messages else ""
    if "l'Architecte d'une équipe" in systeme:
        return ("**Plan**\n1. Créer `compteur.py` avec une fonction `moyenne(notes)`.\n"
                "2. Afficher la moyenne des notes.\n3. Piège : une liste vide ferait une division par zéro.")
    if "le Codeur d'une équipe" in systeme:
        if "CORRECTIONS DEMANDÉES" in dernier:
            return ("Version corrigée :\n\nFichier: compteur.py\n```python\ndef moyenne(notes):\n"
                    "    # corrigé : liste vide gérée\n    if not notes:\n        return 0.0\n"
                    "    return sum(notes) / len(notes)\n\nprint(moyenne([82, 91, 77]))\n```")
        return ("Fichier: compteur.py\n```python\ndef moyenne(notes):\n    return sum(notes) / len(notes)\n\n"
                "print(moyenne([82, 91, 77]))\n```")
    if "le Réviseur d'une équipe" in systeme:
        if "corrigé" in dernier:
            return "APPROUVÉ : la liste vide est gérée et le code est correct."
        return "CORRECTIONS :\n1. `moyenne([])` plante (division par zéro) : retourne 0.0 si la liste est vide."
    if "CodexTerminal" in systeme:
        if dernier.startswith("TÂCHE"):
            return ("Je crée le fichier puis j'affiche son contenu.\n```bash\n"
                    "echo \"Bonjour de LexOS\" > bonjour.txt && cat bonjour.txt\n```")
        return "FINI: bonjour.txt est créé et contient « Bonjour de LexOS »."
    if "Codex de LexOS" in systeme and "html" in dernier.lower():
        return ("Voici ta page météo :\n\nFichier: index.html\n```html\n<!doctype html>\n<html lang=\"fr-CA\">\n"
                "<head><meta charset=\"utf-8\"><title>Météo</title>\n<style>\n"
                "  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0A0A0A;color:#fff;font-family:sans-serif}\n"
                "  .carte{padding:32px 40px;border:2px solid #FF7A00;border-radius:24px;text-align:center}\n"
                "  h1{color:#FF7A00;margin:0}\n  .temp{font-size:64px;font-weight:800}\n</style></head>\n<body>\n"
                "  <div class=\"carte\"><h1>Normandin</h1><div class=\"temp\" id=\"t\">-12 °C</div><p>Neige légère ❄</p>"
                "<button onclick=\"document.getElementById('t').textContent='-15 °C'\">Actualiser</button></div>\n"
                "</body>\n</html>\n```")
    if "Codex de LexOS" in systeme:
        return ("Voici un petit programme qui salue en orange :\n\nFichier: bonjour.py\n```python\n"
                "ORANGE = \"\\033[38;2;255;122;0m\"\n\ndef main():\n    print(ORANGE + \"Bonjour de LexOS !\")\n\n"
                "if __name__ == \"__main__\":\n    main()\n```\n\nLance-le avec `python3 bonjour.py`.")
    return REPONSE_DEFAUT


class Gestionnaire(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _json(self, obj, code=200):
        corps = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(corps)))
        self.end_headers()
        self.wfile.write(corps)

    def _lire(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        if self.path == "/api/version":
            self._json({"version": "0.0.0-faux"})
        elif self.path == "/api/tags":
            self._json({"models": self.server.modeles})
        else:
            self._json({"error": "inconnu"}, 404)

    def do_DELETE(self):
        nom = self._lire().get("model")
        self.server.modeles[:] = [m for m in self.server.modeles if m["name"] != nom]
        self._json({})

    def do_POST(self):
        donnees = self._lire()
        self.server.requetes.append((self.path, donnees))
        if self.path == "/api/show":
            nom = donnees.get("model")
            return self._json({"capabilities": ["completion"] + (["vision"] if nom in VISION else [])})
        if self.path == "/api/chat":
            photos = sum(len(m.get("images") or []) for m in donnees.get("messages", []))
            if self.server.reponses:
                texte = self.server.reponses.pop(0)
            elif photos:
                texte = f"Je vois {photos} photo(s) : un logo orange sur fond noir."
            else:
                texte = reponse_auto(donnees.get("messages", []))
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.end_headers()
            for m in morceaux(texte):
                ligne = {"model": donnees.get("model"), "message": {"role": "assistant", "content": m}, "done": False}
                self.wfile.write((json.dumps(ligne) + "\n").encode())
            self.wfile.write((json.dumps({"message": {"role": "assistant", "content": ""}, "done": True}) + "\n").encode())
        elif self.path == "/api/pull":
            self.send_response(200)
            self.end_headers()
            for o in ({"status": "pulling", "total": 100, "completed": 50}, {"status": "success"}):
                self.wfile.write((json.dumps(o) + "\n").encode())
            self.server.modeles.append({"name": donnees.get("model"), "size": 1_000_000})
        else:
            self._json({"error": "inconnu"}, 404)


class FauxOllama:
    def __init__(self, reponses=None, port=0):
        self.serveur = ThreadingHTTPServer(("127.0.0.1", port), Gestionnaire)
        self.serveur.reponses = list(reponses or [])
        self.serveur.requetes = []
        self.serveur.modeles = [dict(m) for m in MODELES]
        self.hote = f"127.0.0.1:{self.serveur.server_address[1]}"
        threading.Thread(target=self.serveur.serve_forever, daemon=True).start()

    @property
    def requetes(self):
        return self.serveur.requetes

    def arreter(self):
        self.serveur.shutdown()
        self.serveur.server_close()


if __name__ == "__main__":  # imite la commande `ollama`
    commande = sys.argv[1] if len(sys.argv) > 1 else ""
    if commande in ("--version", "-v"):
        print("ollama version is 0.0.0-faux")
    elif commande == "serve":
        hote, _, port = os.environ.get("OLLAMA_HOST", "127.0.0.1:11434").rpartition(":")
        trace = os.environ.get("FAUX_OLLAMA_TRACE")
        if trace:
            with open(trace, "a") as f:
                f.write(f"serve {port} {os.environ.get('OLLAMA_MODELS')}\n")
        serveur = ThreadingHTTPServer((hote or "127.0.0.1", int(port)), Gestionnaire)
        # Le vrai Ollama ouvre son port puis détecte la carte graphique avant de répondre.
        import time
        time.sleep(float(os.environ.get("FAUX_OLLAMA_DELAI", "0")))
        serveur.reponses, serveur.requetes = [], []
        serveur.modeles = [dict(m) for m in MODELES]
        serveur.serve_forever()
    elif commande == "pull":
        print(f"pulling {sys.argv[2]}… success")
