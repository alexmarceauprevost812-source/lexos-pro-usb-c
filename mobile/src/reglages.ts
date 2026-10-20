// Réglages de l'app, gardés dans le téléphone. Surtout : « animations » pour
// alléger sur les téléphones moins puissants (moins de 8 Go de RAM).
import { useSyncExternalStore } from 'react';
import { File, Paths } from 'expo-file-system';

export type Reglages = { animations: boolean };

const FICHIER = new File(Paths.document, 'reglages.json');
let etat: Reglages = { animations: true };
const listeners = new Set<() => void>();

function notifier() {
  for (const l of listeners) l();
}

// Chargé au démarrage (même façon que Codex : lecture async)
(async () => {
  try {
    if (FICHIER.exists) {
      const d = JSON.parse(await FICHIER.text());
      if (typeof d?.animations === 'boolean' && d.animations !== etat.animations) {
        etat = { animations: d.animations };
        notifier();
      }
    }
  } catch {}
})();

export function setAnimations(on: boolean) {
  if (etat.animations === on) return;
  etat = { ...etat, animations: on };
  notifier();
  try {
    if (!FICHIER.exists) FICHIER.create();
    FICHIER.write(JSON.stringify(etat));
  } catch {}
}

export function animationsActives(): boolean {
  return etat.animations;
}

export function useReglages(): Reglages {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => etat,
  );
}
