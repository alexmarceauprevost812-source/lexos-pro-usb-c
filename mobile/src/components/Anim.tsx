// Petites animations réutilisables : bouton qui pulse, titre de feu, points qui sautillent, apparition
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleProp, Text, TextStyle, View, ViewStyle } from 'react-native';
import { C, F, glow } from '../theme';
import { useReglages } from '../reglages';

function useLoop(duration: number, native = true) {
  const { animations } = useReglages();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animations) { v.setValue(0); return; }
    const a = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: duration / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
        Animated.timing(v, { toValue: 0, duration: duration / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
      ]),
    );
    a.start();
    return () => a.stop();
  }, [animations]);
  return v;
}

// Titre en Orbitron dont la couleur passe rouge -> orange -> jaune comme du feu
export function FireTitle({ children, size = 20, style }: { children: React.ReactNode; size?: number; style?: StyleProp<TextStyle> }) {
  const v = useLoop(3000, false);
  const color = v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [C.fire1, C.fire2, C.fire3] });
  return (
    <Animated.Text style={[{ fontFamily: F.title, fontSize: size, color, letterSpacing: 1 }, glow, style]}>
      {children}
    </Animated.Text>
  );
}

// Bouton orange avec un halo qui pulse
export function GlowButton({
  label,
  onPress,
  disabled,
  style,
  small,
  icon,
}: {
  label?: string;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
  icon?: React.ReactNode;
}) {
  const v = useLoop(2400);
  const haloOpacity = v.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.75] });
  const haloScale = v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} style={style}>
      {({ pressed }) => (
        <View style={{ opacity: disabled ? 0.45 : 1 }}>
          {!disabled && (
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute', left: -4, right: -4, top: -4, bottom: -4, borderRadius: small ? 16 : 20,
                backgroundColor: C.orange, opacity: haloOpacity, transform: [{ scale: haloScale }],
              }}
            />
          )}
          <View
            style={{
              minHeight: small ? 44 : 52, minWidth: 44, paddingHorizontal: label ? 18 : 0, borderRadius: small ? 14 : 16,
              backgroundColor: pressed ? C.fire2 : C.orange, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
            }}
          >
            {icon}
            {label ? (
              <Text style={{ fontFamily: F.titleSemi, fontSize: small ? 13 : 15, color: C.onOrange, letterSpacing: 1, textTransform: 'uppercase' }}>
                {label}
              </Text>
            ) : null}
          </View>
        </View>
      )}
    </Pressable>
  );
}

// Bouton secondaire (contour)
export function GhostButton({ label, onPress, style }: { label: string; onPress?: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        { minHeight: 48, borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: pressed ? C.panel2 : 'transparent', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
        style,
      ]}
    >
      <Text style={{ color: C.text, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

// Trois points qui sautillent (l'IA réfléchit)
export function Dots({ color = C.fire2 }: { color?: string }) {
  const vals = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
  useEffect(() => {
    const anims = vals.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(v, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.delay(450 - i * 150),
        ]),
      ),
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, []);
  return (
    <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center', height: 14 }}>
      {vals.map((v, i) => (
        <Animated.View
          key={i}
          style={{
            width: 6, height: 6, borderRadius: 3, backgroundColor: color,
            opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
            transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
          }}
        />
      ))}
    </View>
  );
}

// Apparition : glisse vers le haut en fondu
export function Rise({ children, delay = 0, style }: { children: React.ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 450, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

// Pastille qui clignote
export function Blink({ color = C.green, size = 8 }: { color?: string; size?: number }) {
  const v = useLoop(1600);
  return <Animated.View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.25] }) }} />;
}

// Anneau qui tourne (chargement)
export function Spinner({ size = 24, color = C.orange }: { size?: number; color?: string }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }));
    a.start();
    return () => a.stop();
  }, []);
  return (
    <Animated.View
      style={{
        width: size, height: size, borderRadius: size / 2, borderWidth: 2.5, borderColor: color, borderTopColor: 'transparent',
        transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
      }}
    />
  );
}
