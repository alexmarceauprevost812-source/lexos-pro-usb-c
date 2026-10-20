#!/usr/bin/env python3
"""Faux moteur d'images (imite sd-cli de stable-diffusion.cpp) pour les tests et les démos.

Écrit une vraie image PNG (dégradé orange) là où -o le demande, en affichant
l'avancement comme le vrai : chargement (MB/s), étapes (s/it), puis tuiles du VAE.
FAUX_SD_ECHEC=vulkan : échoue comme un PC sans pilote Vulkan.  FAUX_SD_DELAI : pause par étape.
"""
import os
import struct
import sys
import time
import zlib


def png(chemin, largeur, hauteur, graine):
    lignes = bytearray()
    for y in range(hauteur):
        lignes.append(0)
        for x in range(largeur):
            v = (x * 255 // max(largeur - 1, 1) + graine) % 256
            lignes += bytes((255, 60 + v * 62 // 255, y * 40 // max(hauteur - 1, 1)))

    def bloc(type_, donnees):
        return struct.pack(">I", len(donnees)) + type_ + donnees + struct.pack(">I", zlib.crc32(type_ + donnees))
    with open(chemin, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + bloc(b"IHDR", struct.pack(">IIBBBBB", largeur, hauteur, 8, 2, 0, 0, 0))
                + bloc(b"IDAT", zlib.compress(bytes(lignes))) + bloc(b"IEND", b""))


def main(args):
    if "--help" in args:
        print("usage: sd-cli [options]")
        return 0
    if os.environ.get("FAUX_SD_ECHEC") == "vulkan" and "cpu" not in os.environ.get("FAUX_SD_DOSSIER", ""):
        print("ggml_vulkan: No devices found.\nerror while loading shared libraries: libvulkan.so.1")
        return 1
    opt = {a: args[i + 1] for i, a in enumerate(args[:-1]) if a.startswith("-")}
    for requis in ("--diffusion-model", "--llm", "--vae", "-p", "-o"):
        if requis not in opt:
            print(f"error: missing {requis}")
            return 2
    pause = float(os.environ.get("FAUX_SD_DELAI", "0"))
    for i in range(1, 6):
        sys.stdout.write(f"\r|{'#' * i * 10:<50}| {i * 200}/1000 - 850.00MB/s\033[K")
        sys.stdout.flush()
    print()
    etapes = int(opt.get("--steps", 8))
    for i in range(1, etapes + 1):
        time.sleep(pause)
        sys.stdout.write(f"\r|{'=' * (i * 50 // etapes)}>| {i}/{etapes} - 1.25s/it\033[K" + ("\n" if i == etapes else ""))
        sys.stdout.flush()
    for i in range(1, 5):
        sys.stdout.write(f"\r|{'=' * i * 12}>| {i}/4 - 3.10it/s\033[K" + ("\n" if i == 4 else ""))
    print("decode_first_stage completed")
    l, h = int(opt.get("-W", 512)) // 8, int(opt.get("-H", 512)) // 8   # petite image : test rapide
    png(opt["-o"], l, h, int(opt.get("-s", 0)) % 256)
    print(f"save result image to '{opt['-o']}'")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
