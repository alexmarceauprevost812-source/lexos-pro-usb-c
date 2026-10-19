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
           {"name": "qwen2.5-coder:7b", "size": 4_700_000_000}]
REPONSE_DEFAUT = "<think>je réfléchis</think>Bonjour, ici l'IA de la clé !"


def morceaux(texte, n=4):
    """Découpe en petits morceaux, même au milieu des balises <think>."""
    return [texte[i:i + n] for i in range(0, len(texte), n)]


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
        if self.path == "/api/chat":
            texte = self.server.reponses.pop(0) if self.server.reponses else REPONSE_DEFAUT
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
        serveur.reponses, serveur.requetes = [], []
        serveur.modeles = [dict(m) for m in MODELES]
        serveur.serve_forever()
    elif commande == "pull":
        print(f"pulling {sys.argv[2]}… success")
