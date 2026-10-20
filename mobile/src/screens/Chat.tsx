// Écran 2 : Chat avec l'IA locale
import React, { useRef, useState } from 'react';
import { FlatList, Image, KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { C, F } from '../theme';
import { Blink, Dots, FireTitle, GlowButton, Rise } from '../components/Anim';
import { arreter, discuter, Msg, useEngine } from '../engine';

const avatarIA = require('../../assets/avatar-ia.png');
const avatarMoi = require('../../assets/avatar-alex.png');

type Ligne = Msg & { id: string };

export default function Chat() {
  const eng = useEngine();
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [texte, setTexte] = useState('');
  const [enCours, setEnCours] = useState(false);
  const list = useRef<FlatList>(null);

  const envoyer = async () => {
    const q = texte.trim();
    if (!q || enCours) return;
    setTexte('');
    const moi: Ligne = { id: String(Date.now()), role: 'user', content: q };
    const ia: Ligne = { id: moi.id + '-ia', role: 'assistant', content: '' };
    const historique = [...lignes, moi];
    setLignes([...historique, ia]);
    setEnCours(true);
    try {
      const final = await discuter(
        historique.map(({ role, content }) => ({ role, content })),
        (t) => setLignes((ls) => ls.map((l) => (l.id === ia.id ? { ...l, content: t } : l))),
      );
      setLignes((ls) => ls.map((l) => (l.id === ia.id ? { ...l, content: final.trim() || l.content } : l)));
    } catch (e: any) {
      setLignes((ls) => ls.map((l) => (l.id === ia.id ? { ...l, content: '⚠ ' + (e?.message ?? e) } : l)));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, borderBottomWidth: 1, borderColor: C.borderSoft, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Image source={avatarIA} style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: C.orange, backgroundColor: '#2A2018' }} />
          <View>
            <FireTitle size={18}>TI-LEX LOCAL</FireTitle>
            <Text style={{ color: C.muted, fontSize: 12 }}>Tout roule sur ta clé, rien dans le nuage</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: eng.status === 'pret' ? '#10261A' : '#2B1606' }}>
            <Blink color={eng.status === 'pret' ? C.green : C.orange} />
            <Text style={{ color: eng.status === 'pret' ? '#7EE2A8' : C.orangeLight, fontSize: 12 }}>
              {eng.status === 'pret' ? 'Modèle prêt' + (eng.gpu ? ' · GPU' : ' · CPU') : 'Aucun modèle chargé'}
            </Text>
          </View>
          {eng.model && (
            <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: C.panel, maxWidth: 200 }}>
              <Text style={{ color: C.cyan, fontSize: 12, fontFamily: F.mono }} numberOfLines={1}>{eng.model.name.replace('.gguf', '')}</Text>
            </View>
          )}
          {eng.tokPerSec != null && (
            <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: C.panel }}>
              <Text style={{ color: C.violet, fontSize: 12, fontFamily: F.mono }}>{eng.tokPerSec} tok/s</Text>
            </View>
          )}
        </View>
      </View>

      <FlatList
        ref={list}
        data={lignes}
        keyExtractor={(l) => l.id}
        contentContainerStyle={{ padding: 16, gap: 14 }}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <Rise>
            <Text style={{ color: C.muted, textAlign: 'center', marginTop: 40 }}>Écris-moi de quoi pour commencer.</Text>
          </Rise>
        }
        renderItem={({ item }) => {
          const moi = item.role === 'user';
          return (
            <Rise style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end', alignSelf: moi ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
              {!moi && <Image source={avatarIA} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#2A2018' }} />}
              <View
                style={{
                  flexShrink: 1, paddingHorizontal: 14, paddingVertical: 12,
                  borderRadius: 18, borderBottomRightRadius: moi ? 4 : 18, borderBottomLeftRadius: moi ? 18 : 4,
                  backgroundColor: moi ? C.orange : C.panel, borderWidth: moi ? 0 : 1, borderColor: C.borderSoft,
                }}
              >
                {item.content === '' ? <Dots /> : <Text selectable style={{ color: moi ? C.onOrange : C.text, fontSize: 15, lineHeight: 22 }}>{item.content}</Text>}
              </View>
              {moi && <Image source={avatarMoi} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: C.panel }} />}
            </Rise>
          );
        }}
      />

      <View style={{ flexDirection: 'row', gap: 8, padding: 12, borderTopWidth: 1, borderColor: C.borderSoft, alignItems: 'flex-end' }}>
        <TextInput
          value={texte}
          onChangeText={setTexte}
          placeholder="Écris à ton IA…"
          placeholderTextColor={C.muted}
          multiline
          accessibilityLabel="Message"
          style={{ flex: 1, minHeight: 44, maxHeight: 140, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: C.panel, color: C.text, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15 }}
        />
        {enCours ? (
          <GlowButton small label="Stop" onPress={arreter} />
        ) : (
          <GlowButton small label="↑" onPress={envoyer} disabled={!texte.trim() || eng.status !== 'pret'} />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
