// Écran 3 : Codex — des feuilles (fichiers) de code, avec 3 animations pour changer de feuille
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { C, F } from '../theme';
import { Dots, FireTitle, GlowButton } from '../components/Anim';
import SheetStage, { TransitionMode } from '../components/SheetStage';
import { discuter, useEngine } from '../engine';

type Feuille = { id: string; nom: string; code: string };

const SAUVEGARDE = new File(Paths.document, 'codex.json');
const DEPART: Feuille[] = [
  { id: '1', nom: 'main.py', code: '# Ton premier fichier\nprint("Salut du Lac-Saint-Jean!")\n' },
  { id: '2', nom: 'index.html', code: '<!doctype html>\n<h1>TI-LEX</h1>\n' },
  { id: '3', nom: 'notes.md', code: '# Notes\n- \n' },
];

const MODES: { id: TransitionMode; label: string }[] = [
  { id: 'zoom', label: 'Zoom' },
  { id: 'horizontal', label: '↔ Côté' },
  { id: 'vertical', label: '↕ Haut' },
];

function extraireCode(txt: string): string | null {
  const m = txt.match(/```[\w+-]*\n([\s\S]*?)```/);
  return m ? m[1] : null;
}

export default function Codex() {
  const eng = useEngine();
  const [feuilles, setFeuilles] = useState<Feuille[]>(DEPART);
  const [idx, setIdx] = useState(0);
  const [mode, setMode] = useState<TransitionMode>('zoom');
  const [demande, setDemande] = useState('');
  const [reponse, setReponse] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const tabs = useRef<any>(null);

  // Charger / sauvegarder les feuilles dans le téléphone (seulement ton code, pas l'IA)
  useEffect(() => {
    (async () => {
      try {
        if (SAUVEGARDE.exists) setFeuilles(JSON.parse(await SAUVEGARDE.text()));
      } catch {}
    })();
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (!SAUVEGARDE.exists) SAUVEGARDE.create();
        SAUVEGARDE.write(JSON.stringify(feuilles));
      } catch {}
    }, 600);
    return () => clearTimeout(t);
  }, [feuilles]);

  const aller = (i: number) => {
    if (i < 0 || i >= feuilles.length) return;
    setIdx(i);
    setReponse(null);
  };

  const ajouter = () => {
    const n = feuilles.length + 1;
    const f = { id: String(Date.now()), nom: `fichier${n}.txt`, code: '' };
    setFeuilles((fs) => [...fs, f]);
    setTimeout(() => {
      aller(feuilles.length);
      tabs.current?.scrollToEnd({ animated: true });
    }, 50);
  };

  const modifier = (i: number, p: Partial<Feuille>) => setFeuilles((fs) => fs.map((f, j) => (j === i ? { ...f, ...p } : f)));

  const supprimer = () => {
    if (feuilles.length <= 1) return;
    Alert.alert('Supprimer la feuille?', feuilles[idx].nom, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () => {
          setFeuilles((fs) => fs.filter((_, j) => j !== idx));
          setIdx((i) => Math.max(0, i - 1));
        },
      },
    ]);
  };

  const demanderIA = async () => {
    const q = demande.trim();
    if (!q || enCours) return;
    const f = feuilles[idx];
    setEnCours(true);
    setReponse('');
    try {
      const prompt = `Fichier « ${f.nom} » :\n\`\`\`\n${f.code}\n\`\`\`\n\nDemande : ${q}\n\nSi tu modifies le code, renvoie le fichier complet dans un seul bloc \`\`\`.`;
      const r = await discuter([{ role: 'user', content: prompt }], setReponse);
      setReponse(r);
    } catch (e: any) {
      setReponse('⚠ ' + (e?.message ?? e));
    } finally {
      setEnCours(false);
    }
  };

  const codeIA = reponse ? extraireCode(reponse) : null;

  const renderFeuille = (i: number, active: boolean) => {
    const f = feuilles[i];
    if (!f) return null;
    const lignes = f.code.split('\n').length;
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: C.panel, borderBottomWidth: 1, borderColor: C.borderSoft }}>
          <TextInput
            value={f.nom}
            editable={active}
            onChangeText={(t) => modifier(i, { nom: t })}
            accessibilityLabel="Nom du fichier"
            style={{ flex: 1, color: C.cyan, fontFamily: F.monoMed, fontSize: 14, padding: 0 }}
          />
          <Text style={{ color: C.violet, fontFamily: F.mono, fontSize: 12 }}>{lignes} lignes</Text>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexDirection: 'row', padding: 12 }}>
          <Text style={{ color: '#5A3A1E', fontFamily: F.mono, fontSize: 13, lineHeight: 20, textAlign: 'right', marginRight: 10 }}>
            {Array.from({ length: lignes }, (_, k) => k + 1).join('\n')}
          </Text>
          <TextInput
            value={f.code}
            editable={active}
            onChangeText={(t) => modifier(i, { code: t })}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            accessibilityLabel="Code"
            style={{ flex: 1, color: C.text, fontFamily: F.mono, fontSize: 13, lineHeight: 20, padding: 0, textAlignVertical: 'top' }}
          />
        </ScrollView>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <FireTitle size={20}>CODEX</FireTitle>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {MODES.map((m) => (
              <Pressable
                key={m.id}
                onPress={() => setMode(m.id)}
                accessibilityRole="button"
                accessibilityLabel={`Animation ${m.label}`}
                style={{
                  minHeight: 36, paddingHorizontal: 10, borderRadius: 999, justifyContent: 'center',
                  borderWidth: 1, borderColor: mode === m.id ? C.orange : C.border, backgroundColor: mode === m.id ? C.panel2 : C.panel,
                }}
              >
                <Text style={{ color: mode === m.id ? C.orangeLight : C.muted, fontSize: 12, fontFamily: F.titleSemi }}>{m.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <ScrollView ref={tabs} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 10 }}>
          {feuilles.map((f, i) => (
            <Pressable
              key={f.id}
              onPress={() => aller(i)}
              onLongPress={i === idx ? supprimer : undefined}
              accessibilityRole="tab"
              accessibilityState={{ selected: i === idx }}
              style={{
                minHeight: 40, paddingHorizontal: 12, borderRadius: 10, justifyContent: 'center',
                backgroundColor: i === idx ? C.orange : C.panel, borderWidth: 1, borderColor: i === idx ? C.orange : C.border,
              }}
            >
              <Text style={{ color: i === idx ? C.onOrange : C.text, fontFamily: F.monoMed, fontSize: 13 }}>{f.nom}</Text>
            </Pressable>
          ))}
          <Pressable onPress={ajouter} accessibilityLabel="Nouvelle feuille" style={{ minHeight: 40, minWidth: 44, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: C.orange, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: C.orange, fontSize: 20 }}>+</Text>
          </Pressable>
        </ScrollView>
      </View>

      <SheetStage index={idx} mode={mode} renderSheet={renderFeuille} onSwipe={(d) => aller(idx + d)} />

      {reponse !== null && (
        <View style={{ maxHeight: 220, borderTopWidth: 1, borderColor: C.orange, backgroundColor: C.panel }}>
          <ScrollView contentContainerStyle={{ padding: 12 }}>
            {reponse === '' ? <Dots /> : <Text selectable style={{ color: C.text, fontSize: 13, fontFamily: F.mono, lineHeight: 19 }}>{reponse}</Text>}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: 8, padding: 8 }}>
            {codeIA && !enCours && (
              <GlowButton small label="Remplacer la feuille" onPress={() => { modifier(idx, { code: codeIA }); setReponse(null); }} style={{ flex: 1 }} />
            )}
            <Pressable onPress={() => setReponse(null)} style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: 'center' }}>
              <Text style={{ color: C.muted }}>Fermer</Text>
            </Pressable>
          </View>
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: 8, padding: 12, borderTopWidth: 1, borderColor: C.borderSoft }}>
        <TextInput
          value={demande}
          onChangeText={setDemande}
          placeholder={eng.status === 'pret' ? "Demande à l'IA de coder…" : 'Charge un modèle dans « Clé »'}
          placeholderTextColor={C.muted}
          accessibilityLabel="Demande au Codex"
          style={{ flex: 1, minHeight: 44, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: C.panel, color: C.text, paddingHorizontal: 14, fontSize: 14 }}
        />
        <GlowButton small label="IA" onPress={demanderIA} disabled={!demande.trim() || enCours || eng.status !== 'pret'} />
      </View>
    </View>
  );
}
