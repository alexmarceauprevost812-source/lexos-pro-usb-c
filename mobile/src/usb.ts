// Trouver les modèles .gguf sur la clé USB-C (OTG)
// Android monte une clé USB sous /storage/XXXX-XXXX. Pour lire directement le fichier
// (sans le copier dans le téléphone), l'app a besoin de « Accès à tous les fichiers ».
import { Directory, File } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import * as DocumentPicker from 'expo-document-picker';

export type ModelFile = { name: string; path: string; sizeGo: number | null };

const PACKAGE = 'com.tilex.local';

export async function demanderAccesFichiers() {
  try {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
      { data: `package:${PACKAGE}` },
    );
  } catch {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.MANAGE_ALL_FILES_ACCESS_PERMISSION,
    );
  }
}

function toGo(bytes: number | null | undefined) {
  if (!bytes) return null;
  return Math.round((bytes / 1024 ** 3) * 10) / 10;
}

// Cherche les .gguf jusqu'à 3 niveaux de profondeur
function scan(dir: Directory, depth: number, out: ModelFile[]) {
  if (depth < 0 || out.length > 50) return;
  let items: (Directory | File)[] = [];
  try {
    items = dir.list();
  } catch {
    return;
  }
  for (const it of items) {
    if (it instanceof File) {
      if (it.name.toLowerCase().endsWith('.gguf') && !it.name.toLowerCase().includes('mmproj')) {
        out.push({ name: it.name, path: decodeURI(it.uri.replace('file://', '')), sizeGo: toGo(it.size) });
      }
    } else if (it instanceof Directory) {
      if (it.name.startsWith('.') || it.name === 'Android') continue;
      scan(it, depth - 1, out);
    }
  }
}

// Les clés USB sont sous /storage/<UUID> (pas « emulated » ni « self », qui sont la mémoire interne)
export function trouverCles(): Directory[] {
  const roots: Directory[] = [];
  try {
    const storage = new Directory('file:///storage');
    for (const it of storage.list()) {
      if (it instanceof Directory && it.name !== 'emulated' && it.name !== 'self') roots.push(it);
    }
  } catch {
    // /storage pas listable sur certains téléphones : on ne trouve rien, l'utilisateur choisira à la main
  }
  return roots;
}

export function chercherModeles(): ModelFile[] {
  const out: ModelFile[] = [];
  for (const root of trouverCles()) scan(root, 3, out);
  return out.sort((a, b) => (a.sizeGo ?? 0) - (b.sizeGo ?? 0));
}

// content://com.android.externalstorage.documents/document/1234-ABCD%3Amodeles%2Fqwen3-4b.gguf
//   -> /storage/1234-ABCD/modeles/qwen3-4b.gguf
export function contentUriVersChemin(uri: string): string | null {
  const m = uri.match(/externalstorage\.documents\/document\/([^/]+)$/);
  if (!m) return null;
  const doc = decodeURIComponent(m[1]); // "1234-ABCD:modeles/qwen3-4b.gguf"
  const [vol, rel] = doc.split(':');
  if (!vol || rel === undefined) return null;
  if (vol === 'primary') return `/storage/emulated/0/${rel}`;
  return `/storage/${vol}/${rel}`;
}

export async function choisirModeleALaMain(): Promise<ModelFile | null> {
  const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: false, type: '*/*' });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  const path = contentUriVersChemin(a.uri);
  if (!path) throw new Error("Impossible de lire ce fichier directement. Choisis-le dans la clé USB (pas dans « Récents »).");
  return { name: a.name, path, sizeGo: toGo(a.size) };
}
