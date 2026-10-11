import { useMemo, useState } from 'react';
import { PanResponder, Platform, Pressable, StyleSheet, View } from 'react-native';
import type { BindAction } from '../../game/settings';
import { useGameUi, useServices } from '../GameContext';
import { Txt } from '../components/primitives';
import { COLORS } from '../theme';

// react-native-web delays press start by 50 ms and drops quicker taps on Pressables without onPress.
const NO_PRESS_DELAY = Platform.OS === 'web' ? ({ delayPressIn: 0 } as object) : { unstable_pressDelay: 0 };

function HoldButton({ action, label, size, color, cooldown }: { action: BindAction; label: string; size: number; color: string; cooldown?: number }) {
  const { game } = useServices();
  return (
    <Pressable
      {...NO_PRESS_DELAY}
      accessibilityLabel={label}
      onPressIn={() => {
        game.input.setTouch(action, true);
        game.input.pulse(action);
      }}
      onPressOut={() => game.input.setTouch(action, false)}
      style={({ pressed }) => [styles.btn, { width: size, height: size, borderRadius: size / 2, borderColor: color, backgroundColor: pressed ? 'rgba(255,255,255,0.35)' : 'rgba(10,10,30,0.45)' }]}
    >
      <Txt size={Math.max(14, size * 0.32)}>{label}</Txt>
      {cooldown !== undefined && cooldown > 0 && <View style={[styles.cd, { borderRadius: size / 2 }]} />}
    </Pressable>
  );
}

/**
 * Virtual joystick (left) and button cluster (right). Writes to the same
 * RawInput as the keyboard, so every command (including motion inputs like
 * S, D + J) works on touch screens. Sized by the buttonScale setting.
 */
export function TouchControls() {
  const { game } = useServices();
  const ui = useGameUi();
  const scale = game.settings.buttonScale;
  const R = 56 * scale;
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const input = game.input;

  const responder = useMemo(() => {
    const release = (): void => {
      input.setTouchStick(0, 0);
      setKnob({ x: 0, y: 0 });
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, g) => {
        let dx = g.dx / R;
        let dy = g.dy / R;
        const l = Math.hypot(dx, dy);
        if (l > 1) {
          dx /= l;
          dy /= l;
        }
        input.setTouchStick(dx, -dy);
        setKnob({ x: dx * R * 0.6, y: dy * R * 0.6 });
      },
      onPanResponderRelease: release,
      onPanResponderTerminate: release,
    });
  }, [input, R]);

  const inCombat = ui.state === 'ACTIVE_COMBAT' || ui.state === 'ENCOUNTER_TRANSITION';
  const b = 54 * scale;
  const cd = (id: string): number => ui.controlledMoves.find((m) => m.id === id)?.cooldown ?? 0;
  if (ui.state === 'MAIN_MENU' || ui.state === 'PAUSED' || ui.state === 'BOOT') return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View {...responder.panHandlers} style={[styles.stickArea, { width: R * 2.6, height: R * 2.6 }]}>
        <View style={[styles.stickBase, { width: R * 2, height: R * 2, borderRadius: R }]}>
          <View style={[styles.knob, { width: R * 0.9, height: R * 0.9, borderRadius: R * 0.45, transform: [{ translateX: knob.x }, { translateY: knob.y }] }]} />
        </View>
      </View>
      <View style={styles.cluster} pointerEvents="box-none">
        <View style={styles.row}>
          {inCombat && <HoldButton action="charge" label="I" size={b * 0.8} color={COLORS.ki} />}
          {inCombat && <HoldButton action="up" label="▲" size={b * 0.8} color={COLORS.dim} />}
          {!inCombat && <HoldButton action="up" label="▲" size={b * 0.9} color={COLORS.dim} />}
        </View>
        <View style={styles.row}>
          <HoldButton action="ki" label="L" size={b} color={COLORS.ki} />
          <HoldButton action="heavy" label="K" size={b} color={COLORS.enemy} />
        </View>
        <View style={styles.row}>
          <HoldButton action="guard" label="U" size={b} color={COLORS.good} />
          <HoldButton action="light" label="J" size={b * 1.15} color={COLORS.gold} />
        </View>
        <View style={styles.row}>
          {inCombat && <HoldButton action="down" label="▼" size={b * 0.8} color={COLORS.dim} />}
          <HoldButton action="dash" label="Dash" size={b * 0.9} color={COLORS.text} cooldown={cd('rush')} />
        </View>
      </View>
      <View style={styles.topRow} pointerEvents="box-none">
        <HoldButton action="nextAlly" label="Tab" size={b * 0.75} color={COLORS.player} />
        {inCombat && <HoldButton action="nextTarget" label="R" size={b * 0.75} color={COLORS.enemy} />}
        {inCombat && <HoldButton action="camLeft" label="Q" size={b * 0.7} color={COLORS.dim} />}
        {inCombat && <HoldButton action="camRight" label="E" size={b * 0.7} color={COLORS.dim} />}
        {ui.specialReady && <HoldButton action="special" label="F" size={b * 0.9} color={COLORS.gold} />}
        <HoldButton action="menu" label="≡" size={b * 0.7} color={COLORS.text} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stickArea: { position: 'absolute', left: 8, bottom: 8, alignItems: 'center', justifyContent: 'center' },
  stickBase: { borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)', backgroundColor: 'rgba(10,10,30,0.3)', alignItems: 'center', justifyContent: 'center' },
  knob: { backgroundColor: 'rgba(255,255,255,0.45)' },
  cluster: { position: 'absolute', right: 10, bottom: 10, alignItems: 'flex-end' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  topRow: { position: 'absolute', bottom: 10, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', gap: 6 },
  btn: { borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  cd: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' },
});
