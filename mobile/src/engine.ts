// Moteur IA local : llama.cpp (via llama.rn) qui lit le .gguf directement sur la clé USB-C
import { useSyncExternalStore } from 'react';
import { initLlama, LlamaContext } from 'llama.rn';
import type { ModelFile } from './usb';

export type Msg = { role: 'system' | 'user' | 'assistant'; content: string };

type State = {
  status: 'aucun' | 'chargement' | 'pret' | 'erreur';
  progress: number;
  model: ModelFile | null;
  error: string | null;
  tokPerSec: number | null;
  gpu: boolean;
};

let ctx: LlamaContext | null = null;
let state: State = { status: 'aucun', progress: 0, model: null, error: null, tokPerSec: null, gpu: false };
const listeners = new Set<() => void>();

function set(p: Partial<State>) {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}

export function useEngine() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export async function chargerModele(model: ModelFile) {
  if (state.status === 'chargement') return;
  set({ status: 'chargement', progress: 0, model, error: null });
  try {
    if (ctx) {
      await ctx.release();
      ctx = null;
    }
    ctx = await initLlama(
      {
        model: model.path,
        use_mmap: true, // lit le modèle sur la clé au lieu de tout copier en RAM
        use_mlock: false,
        n_ctx: 4096,
        n_gpu_layers: 99, // utilise le GPU si le téléphone le supporte (OpenCL / Adreno)
      },
      (p) => set({ progress: Math.round(p) }),
    );
    set({ status: 'pret', progress: 100, gpu: !!ctx.gpu });
  } catch (e: any) {
    ctx = null;
    set({ status: 'erreur', error: String(e?.message ?? e) });
  }
}

export const SYSTEM_PROMPT =
  "Tu es TI-LEX, une IA locale québécoise qui roule direct sur une clé USB-C. Tu réponds en français québécois, clair et direct.";

export async function discuter(messages: Msg[], onToken: (texteComplet: string) => void): Promise<string> {
  if (!ctx) throw new Error('Aucun modèle chargé. Branche ta clé pis choisis un modèle.');
  let texte = '';
  const debut = Date.now();
  let n = 0;
  const res = await ctx.completion(
    {
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      n_predict: 1024,
      temperature: 0.7,
      top_p: 0.9,
      enable_thinking: false,
      stop: ['<|im_end|>', '</s>', '<|eot_id|>'],
    } as any,
    (data) => {
      n++;
      texte += data.token;
      onToken(texte);
    },
  );
  const sec = (Date.now() - debut) / 1000;
  if (sec > 0) set({ tokPerSec: Math.round((n / sec) * 10) / 10 });
  return (res as any).content ?? (res as any).text ?? texte;
}

export async function arreter() {
  try {
    await ctx?.stopCompletion();
  } catch {}
}
