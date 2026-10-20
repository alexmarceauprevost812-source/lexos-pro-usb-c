// TI-LEX Local — IA locale sur clé USB-C (Android)
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Orbitron_600SemiBold, Orbitron_800ExtraBold } from '@expo-google-fonts/orbitron';
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { C, F } from './src/theme';
import { useReglages } from './src/reglages';
import Cle from './src/screens/Cle';
import Chat from './src/screens/Chat';
import Codex from './src/screens/Codex';

type Onglet = 'cle' | 'chat' | 'codex';
const ONGLETS: { id: Onglet; label: string }[] = [
  { id: 'cle', label: 'Clé' },
  { id: 'chat', label: 'Chat' },
  { id: 'codex', label: 'Codex' },
];

// Chaque écran reste monté (on garde la conversation) ; celui qui devient actif apparaît en glissant
function Ecran({ actif, children }: { actif: boolean; children: React.ReactNode }) {
  const { animations } = useReglages();
  const v = useRef(new Animated.Value(actif ? 1 : 0)).current;
  useEffect(() => {
    if (actif) {
      if (!animations) { v.setValue(1); return; }
      v.setValue(0);
      Animated.timing(v, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
  }, [actif, animations]);
  return (
    <Animated.View
      style={{
        flex: 1, display: actif ? 'flex' : 'none', opacity: v,
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

export default function App() {
  const [polices] = useFonts({ Orbitron_600SemiBold, Orbitron_800ExtraBold, JetBrainsMono_400Regular, JetBrainsMono_500Medium });
  const [onglet, setOnglet] = useState<Onglet>('cle');
  const [largeur, setLargeur] = useState(0);
  const barre = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const i = ONGLETS.findIndex((o) => o.id === onglet);
    Animated.spring(barre, { toValue: i, useNativeDriver: true, friction: 8 }).start();
  }, [onglet]);

  if (!polices) return <View style={{ flex: 1, backgroundColor: C.bg }} />;

  const w = largeur / ONGLETS.length;

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'bottom']}>
        <Ecran actif={onglet === 'cle'}>
          <Cle onOuvrirChat={() => setOnglet('chat')} />
        </Ecran>
        <Ecran actif={onglet === 'chat'}>
          <Chat />
        </Ecran>
        <Ecran actif={onglet === 'codex'}>
          <Codex />
        </Ecran>

        <View
          onLayout={(e) => setLargeur(e.nativeEvent.layout.width)}
          style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: C.borderSoft, backgroundColor: '#0A0A0A' }}
        >
          {largeur > 0 && (
            <Animated.View
              style={{
                position: 'absolute', top: 0, left: 0, width: w, height: 3, alignItems: 'center',
                transform: [{ translateX: Animated.multiply(barre, w) }],
              }}
            >
              <View style={{ width: 48, height: 3, borderRadius: 2, backgroundColor: C.orange, shadowColor: C.orange, shadowOpacity: 1, shadowRadius: 8, elevation: 6 }} />
            </Animated.View>
          )}
          {ONGLETS.map((o) => {
            const actif = o.id === onglet;
            return (
              <Pressable
                key={o.id}
                onPress={() => setOnglet(o.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: actif }}
                style={{ flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ fontFamily: actif ? F.title : F.titleSemi, fontSize: 13, letterSpacing: 1, color: actif ? C.orange : C.muted }}>
                  {o.label.toUpperCase()}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
