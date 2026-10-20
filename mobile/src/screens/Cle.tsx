// Écran 1 : Branche ta clé — détection de la clé, choix du modèle, chargement
import React, { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing, Image, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { C, F } from '../theme';
import { Dots, FireTitle, GhostButton, GlowButton, Rise, Spinner } from '../components/Anim';
import { chercherModeles, choisirModeleALaMain, demanderAccesFichiers, ModelFile, trouverCles } from '../usb';
import { chargerModele, useEngine } from '../engine';
import { setAnimations, useReglages } from '../reglages';

function Logo() {
  const { animations } = useReglages();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animations) { v.setValue(0); return; }
    const a = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    a.start();
    return () => a.stop();
  }, [animations]);
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', height: 230 }}>
      <Animated.View
        style={{
          position: 'absolute', width: 190, height: 190, borderRadius: 95, backgroundColor: C.fire1,
          opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.32] }),
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.15] }) }],
        }}
      />
      <Animated.Image
        source={require('../../assets/logo-tilex.png')}
        accessibilityLabel="TI-LEX-AI"
        style={{ width: 230, height: 223, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] }) }] }}
        resizeMode="contain"
      />
    </View>
  );
}

function Etape({ ok, actif, titre, detail, droite }: { ok: boolean; actif?: boolean; titre: string; detail: string; droite?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
      {ok ? (
        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: '#10261A', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: C.green, fontWeight: '700' }}>✓</Text>
        </View>
      ) : actif ? (
        <Spinner size={26} />
      ) : (
        <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: C.border }} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.text, fontSize: 15, fontWeight: '500' }}>{titre}</Text>
        <Text style={{ color: C.cyan, fontSize: 12, fontFamily: F.mono }} numberOfLines={1}>{detail}</Text>
      </View>
      {droite}
    </View>
  );
}

export default function Cle({ onOuvrirChat }: { onOuvrirChat: () => void }) {
  const eng = useEngine();
  const reg = useReglages();
  const [cles, setCles] = useState<string[]>([]);
  const [modeles, setModeles] = useState<ModelFile[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const bar = useRef(new Animated.Value(0)).current;

  const rafraichir = () => {
    setCles(trouverCles().map((d) => d.name));
    setModeles(chercherModeles());
  };

  useEffect(() => {
    rafraichir();
    // quand on revient des réglages Android (accès aux fichiers), on rescanne
    const sub = AppState.addEventListener('change', (s) => s === 'active' && rafraichir());
    const t = setInterval(rafraichir, 4000); // détecte la clé quand on la branche
    return () => {
      sub.remove();
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    Animated.timing(bar, { toValue: eng.progress, duration: 300, useNativeDriver: false }).start();
  }, [eng.progress]);

  const choisir = async () => {
    try {
      const m = await choisirModeleALaMain();
      if (m) chargerModele(m);
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  const cleOk = cles.length > 0;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 18 }}>
      <Logo />
      <Text style={{ color: C.muted, fontSize: 15, lineHeight: 22, textAlign: 'center' }}>
        Branche ta clé USB-C LEXOS. Ton IA roule direct dessus, sans internet, sans compte.
      </Text>

      <View style={{ backgroundColor: C.panel, borderColor: C.borderSoft, borderWidth: 1, borderRadius: 18, paddingHorizontal: 16 }}>
        <Rise>
          <Etape ok={cleOk} titre={cleOk ? 'Clé détectée' : 'En attente de la clé…'} detail={cleOk ? cles.join(', ') : 'Branche-la dans le port USB-C'} />
        </Rise>
        <Rise delay={200}>
          <Etape ok titre="Moteur IA prêt" detail="llama.cpp · dans l'app" />
        </Rise>
        <Rise delay={400}>
          <Etape
            ok={eng.status === 'pret'}
            actif={eng.status === 'chargement'}
            titre={
              eng.status === 'pret' ? 'Modèle chargé' : eng.status === 'chargement' ? 'Chargement du modèle…' : eng.status === 'erreur' ? 'Erreur de chargement' : 'Aucun modèle choisi'
            }
            detail={eng.model?.name ?? 'Choisis un .gguf plus bas'}
            droite={eng.status === 'chargement' ? <Text style={{ color: C.orange, fontFamily: F.monoMed }}>{eng.progress} %</Text> : null}
          />
          {eng.status === 'chargement' && (
            <View style={{ height: 6, borderRadius: 3, backgroundColor: C.border, overflow: 'hidden', marginBottom: 12 }}>
              <Animated.View style={{ height: 6, backgroundColor: C.orange, width: bar.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }} />
            </View>
          )}
        </Rise>
      </View>

      {eng.status === 'erreur' && <Text style={{ color: '#FF6B6B', fontSize: 13 }}>{eng.error}</Text>}
      {msg && <Text style={{ color: '#FF6B6B', fontSize: 13 }}>{msg}</Text>}

      {eng.status === 'pret' && <GlowButton label="Ouvrir le chat" onPress={onOuvrirChat} />}

      <View style={{ gap: 10 }}>
        <FireTitle size={14}>MODÈLES SUR LA CLÉ</FireTitle>
        {modeles.length === 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ color: C.muted, fontSize: 13, flex: 1 }}>
              Aucun .gguf trouvé. Donne l'accès aux fichiers, ou choisis le modèle à la main.
            </Text>
            {cleOk && <Dots />}
          </View>
        )}
        {modeles.map((m, i) => {
          const actif = eng.model?.path === m.path;
          const lourd = (m.sizeGo ?? 0) > 6;
          return (
            <Rise key={m.path} delay={i * 80}>
              <Pressable
                onPress={() => chargerModele(m)}
                accessibilityRole="button"
                style={{
                  padding: 14, borderRadius: 16, borderWidth: actif ? 1.5 : 1, borderColor: actif ? C.orange : C.border,
                  backgroundColor: actif ? C.panel2 : C.panel, gap: 4,
                }}
              >
                <Text style={{ color: C.cyan, fontFamily: F.monoMed, fontSize: 14 }} numberOfLines={1}>{m.name}</Text>
                <Text style={{ color: lourd ? C.orangeLight : C.muted, fontSize: 12 }}>
                  {m.sizeGo ? `${m.sizeGo} Go` : '? Go'}
                  {lourd ? ' · probablement trop lourd pour un téléphone' : ' · correct pour un téléphone'}
                </Text>
              </Pressable>
            </Rise>
          );
        })}
      </View>

      <View style={{ gap: 10 }}>
        <GhostButton label="Donner l'accès aux fichiers de la clé" onPress={demanderAccesFichiers} />
        <GhostButton label="Choisir un .gguf à la main" onPress={choisir} />
        <GhostButton label="Rechercher encore" onPress={rafraichir} />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.panel, borderColor: C.borderSoft, borderWidth: 1, borderRadius: 16, padding: 14 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text, fontSize: 15, fontWeight: '500' }}>Animations</Text>
          <Text style={{ color: C.muted, fontSize: 12 }}>Éteins-les si ton téléphone rame ou chauffe.</Text>
        </View>
        <Switch
          value={reg.animations}
          onValueChange={setAnimations}
          trackColor={{ true: C.orange, false: C.border }}
          thumbColor={C.text}
        />
      </View>
      <Text style={{ color: C.muted, fontSize: 12, textAlign: 'center' }}>
        Le modèle est lu sur la clé. Débranche la clé = l'IA s'arrête.
      </Text>
    </ScrollView>
  );
}
