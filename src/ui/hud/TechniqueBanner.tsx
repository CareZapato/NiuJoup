import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { Txt } from '../components/primitives';
import { useServices } from '../GameContext';
import { COLORS } from '../theme';

interface Banner {
  id: number;
  name: string;
  limit: boolean;
  enemy: boolean;
}

const NATIVE = Platform.OS !== 'web';
const LIFE_MS = 1400;

function BannerItem({ b, onDone }: { b: Banner; onDone: (id: number) => void }) {
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const anim = Animated.sequence([
      Animated.timing(t, { toValue: 1, duration: 160, easing: Easing.out(Easing.back(2)), useNativeDriver: NATIVE }),
      Animated.delay(LIFE_MS - 420),
      Animated.timing(t, { toValue: 2, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: NATIVE }),
    ]);
    anim.start(() => onDone(b.id));
    return () => anim.stop();
  }, [t, b.id, onDone]);
  const color = b.enemy ? COLORS.enemy : b.limit ? COLORS.gold : '#ffffff';
  return (
    <Animated.View
      style={{
        opacity: t.interpolate({ inputRange: [0, 0.4, 1.6, 2], outputRange: [0, 1, 1, 0] }),
        transform: [
          { translateX: t.interpolate({ inputRange: [0, 1, 2], outputRange: [b.enemy ? 60 : -60, 0, 0] }) },
          { scale: t.interpolate({ inputRange: [0, 1, 2], outputRange: [1.6, 1, 1.08] }) },
        ],
      }}
    >
      <View style={[styles.plate, { borderColor: color }]}>
        <Txt size={b.limit ? 18 : 15} title color={color}>
          {b.name.toUpperCase()}
        </Txt>
      </View>
    </Animated.View>
  );
}

/**
 * Animated technique name, shown only when a technique actually executes
 * (`techniqueUsed` is emitted after costs are paid). Purely decorative: no
 * pointer events, never pauses or blocks input.
 */
export function TechniqueBanner() {
  const { game } = useServices();
  const [items, setItems] = useState<Banner[]>([]);
  const seq = useRef(1);
  useEffect(
    () =>
      game.events.on('techniqueUsed', (e) => {
        const enemy = game.world.get(e.entityId)?.combatant?.team === 'enemy';
        setItems((prev) => [...prev.slice(-2), { id: seq.current++, name: e.name, limit: e.limit, enemy }]);
      }),
    [game],
  );
  const onDone = useCallback((id: number) => setItems((prev) => prev.filter((b) => b.id !== id)), []);
  if (!items.length) return null;
  return (
    <View style={styles.wrap} pointerEvents="none">
      {items.map((b) => (
        <BannerItem key={b.id} b={b} onDone={onDone} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: '22%', left: 0, right: 0, alignItems: 'center', gap: 6 },
  plate: { backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 2, paddingHorizontal: 14, paddingVertical: 6 },
});
