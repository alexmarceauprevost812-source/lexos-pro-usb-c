# LexOS Textes : Android et PC

Le développement se poursuit sur la branche `chatgpt`. La branche `claude` ajoute **LexOS IA** : des IA locales sur la clé USB-C (voir [`usb/`](usb/README.md)).

| Version | Sources | IA hors ligne |
| --- | --- | --- |
| Android / Samsung | `android/` | Moteur à intégrer |
| Linux | `desktop/` | Ollama local avec modèle préinstallé |
| Windows | `desktop/` | Ollama local avec modèle préinstallé |
| macOS | `desktop/` | Ollama local avec modèle préinstallé |
| Clé USB-C (Linux + Windows) | `usb/` | Ollama **et plusieurs modèles sur la clé**, un clic : Chat, Codex, CodexTerminal |

Les deux workflows dans Actions construisent l’APK et les exécutables PC. Télécharger les artefacts d’une exécution réussie. Ils ne contiennent pas de modèle d’IA. Les versions compilées doivent encore être testées sur appareil. Les projets exportés utilisent des fichiers Markdown UTF-8 dans `nom-projet/textes/`, avec un README.

La branche par défaut reste `supabase`. Sélectionner `chatgpt` dans GitHub pour voir les ajouts PC.
