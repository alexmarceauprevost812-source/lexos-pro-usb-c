// Scène du Codex : anime le passage d'une feuille (fichier) à une autre.
// 3 animations :
//   - zoom       : dézoom -> glisse horizontalement vers l'autre fenêtre -> zoom
//   - horizontal : la nouvelle feuille glisse de côté et pousse l'autre
//   - vertical   : la nouvelle feuille monte par en bas et pousse l'autre vers le haut
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, PanResponder, StyleSheet, View } from 'react-native';
import { C } from '../theme';
import { useReglages } from '../reglages';

export type TransitionMode = 'zoom' | 'horizontal' | 'vertical';

type Props = {
  index: number; // feuille demandée
  mode: TransitionMode;
  renderSheet: (index: number, active: boolean) => React.ReactNode;
  onSwipe?: (dir: 1 | -1) => void; // glisser le doigt pour changer de feuille
};

const ZOOM_SCALE = 0.78;
const GAP = 24;

export default function SheetStage({ index, mode, renderSheet, onSwipe }: Props) {
  const { animations } = useReglages();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [shown, setShown] = useState(index); // feuille affichée au repos
  const [anim, setAnim] = useState<{ from: number; to: number; dir: 1 | -1; mode: TransitionMode } | null>(null);
  const p = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (index === shown && !anim) return;
    const from = anim ? anim.to : shown;
    if (index === from) return;
    const dir: 1 | -1 = index > from ? 1 : -1;
    p.stopAnimation();
    p.setValue(0);
    setAnim({ from, to: index, dir, mode });
    const duration = !animations ? 0 : mode === 'zoom' ? 720 : 380;
    Animated.timing(p, {
      toValue: 1,
      duration,
      easing: mode === 'zoom' ? Easing.inOut(Easing.cubic) : Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setShown(index);
        setAnim(null);
      }
    });
  }, [index]);

  const swipeRef = useRef(onSwipe);
  swipeRef.current = onSwipe;
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 40 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderRelease: (_, g) => {
        if (g.dx < -60) swipeRef.current?.(1);
        else if (g.dx > 60) swipeRef.current?.(-1);
      },
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  const { w: W, h: H } = size;

  // Styles animés de la feuille qui part (out) et de celle qui arrive (in)
  function styles(a: NonNullable<typeof anim>) {
    const d = a.dir;
    if (a.mode === 'horizontal') {
      return {
        out: { transform: [{ translateX: p.interpolate({ inputRange: [0, 1], outputRange: [0, -d * W] }) }] },
        in: { transform: [{ translateX: p.interpolate({ inputRange: [0, 1], outputRange: [d * W, 0] }) }] },
      };
    }
    if (a.mode === 'vertical') {
      return {
        out: {
          opacity: p.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }),
          transform: [
            { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [0, -d * H * 0.35] }) },
            { scale: p.interpolate({ inputRange: [0, 1], outputRange: [1, 0.92] }) },
          ],
        },
        in: { transform: [{ translateY: p.interpolate({ inputRange: [0, 1], outputRange: [d * H, 0] }) }] },
      };
    }
    // zoom : 0 -> 0.3 dézoom, 0.3 -> 0.7 glisse horizontale, 0.7 -> 1 zoom
    const step = W * ZOOM_SCALE + GAP;
    return {
      out: {
        opacity: p.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }),
        transform: [
          { translateX: p.interpolate({ inputRange: [0, 0.3, 0.7, 1], outputRange: [0, 0, -d * step, -d * step] }) },
          { scale: p.interpolate({ inputRange: [0, 0.3, 1], outputRange: [1, ZOOM_SCALE, ZOOM_SCALE] }) },
        ],
      },
      in: {
        transform: [
          { translateX: p.interpolate({ inputRange: [0, 0.3, 0.7, 1], outputRange: [d * step, d * step, 0, 0] }) },
          { scale: p.interpolate({ inputRange: [0, 0.7, 1], outputRange: [ZOOM_SCALE, ZOOM_SCALE, 1] }) },
        ],
      },
    };
  }

  // Bordure de feu visible seulement quand on est dézoomé
  const frameOpacity = anim?.mode === 'zoom' ? p.interpolate({ inputRange: [0, 0.3, 0.7, 1], outputRange: [0, 1, 1, 0] }) : 0;

  return (
    <View style={s.stage} onLayout={onLayout} {...pan.panHandlers}>
      {W > 0 && !anim && <View style={StyleSheet.absoluteFill}>{renderSheet(shown, true)}</View>}
      {W > 0 && anim && (
        <>
          <Animated.View style={[StyleSheet.absoluteFill, s.sheet, styles(anim).out]}>
            {renderSheet(anim.from, false)}
            <Animated.View pointerEvents="none" style={[s.frame, { opacity: frameOpacity }]} />
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, s.sheet, styles(anim).in]}>
            {renderSheet(anim.to, false)}
            <Animated.View pointerEvents="none" style={[s.frame, { opacity: frameOpacity }]} />
          </Animated.View>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  stage: { flex: 1, overflow: 'hidden', backgroundColor: C.bg },
  sheet: { backgroundColor: C.bg, borderRadius: 16, overflow: 'hidden' },
  frame: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, borderRadius: 16, borderWidth: 2, borderColor: C.orange },
});
