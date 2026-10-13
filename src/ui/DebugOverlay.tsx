import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { PixelButton, Txt } from './components/primitives';
import { useGameUi, useServices } from './GameContext';
import { COLORS } from './theme';

/**
 * Debug mode (toggle with ` or F3, or from Settings). Hitboxes/hurtboxes are
 * drawn by the renderer; this overlay shows FPS, state, positions, AI states
 * and targets, and exposes cheats for testing.
 */
export function DebugOverlay() {
  const { game, saves, refreshHasSave } = useServices();
  const ui = useGameUi();
  const [msg, setMsg] = useState('');
  if (!ui.debug) {
    return game.settings.showFps ? (
      <View style={styles.fps} pointerEvents="none">
        <Txt size={16}>{Math.round(game.fps)} FPS</Txt>
      </View>
    ) : null;
  }
  return (
    <View style={styles.root} pointerEvents="box-none">
      <View style={styles.text} pointerEvents="none">
        <Txt size={15} color={COLORS.good}>
          {ui.debug.fps} FPS · tick {ui.debug.tick} · entidades {ui.debug.entities} · guardado: {saves.backendName}
        </Txt>
        {ui.debug.lines.map((l, i) => (
          <Txt key={i} size={14} style={{ fontFamily: 'monospace' }}>
            {l}
          </Txt>
        ))}
        {msg ? <Txt size={14} color={COLORS.warn}>{msg}</Txt> : null}
      </View>
      <View style={styles.buttons}>
        <PixelButton small label="PB +25" onPress={() => game.debugAddPower(25)} />
        <PixelButton small label="PB -25" onPress={() => game.debugAddPower(-25)} />
        <PixelButton small label="Encuentro" onPress={() => setMsg(game.debugEncounter() ? '' : 'Encuentro no disponible aquí')} />
        <PixelButton small label="+100 XP" onPress={() => game.debugGrant(100, 0)} />
        <PixelButton small label="+3 AP" onPress={() => game.debugGrant(0, 3)} />
        <PixelButton
          small
          label="Borrar guardado"
          onPress={() => {
            void saves.clear().then(() => {
              setMsg('Guardado borrado');
              refreshHasSave();
            });
          }}
        />
      </View>
      <View style={styles.light} pointerEvents="box-none">
        <Txt size={14} color={COLORS.good}>
          Luz · fase {ui.light.phase.toFixed(3)} · sol {ui.light.elevation.toFixed(2)} · sepia {ui.light.sepia.toFixed(2)} · noche {ui.light.night.toFixed(2)}
        </Txt>
        <Txt size={14}>nitidez {ui.light.shadowSoftness.toFixed(2)} (0 dura, 1 suave)</Txt>
        <View style={styles.row}>
          <PixelButton small label="−" onPress={() => game.debugSetLight({ shadowSoftness: ui.light.shadowSoftness - 0.05 })} />
          <PixelButton small label="+" onPress={() => game.debugSetLight({ shadowSoftness: ui.light.shadowSoftness + 0.05 })} />
        </View>
        <Txt size={14}>brillo {ui.light.lightBrightness.toFixed(2)}</Txt>
        <View style={styles.row}>
          <PixelButton small label="−" onPress={() => game.debugSetLight({ lightBrightness: ui.light.lightBrightness - 0.1 })} />
          <PixelButton small label="+" onPress={() => game.debugSetLight({ lightBrightness: ui.light.lightBrightness + 0.1 })} />
        </View>
        <Txt size={14}>radio lámpara {ui.light.lampRadius.toFixed(2)}</Txt>
        <View style={styles.row}>
          <PixelButton small label="−" onPress={() => game.debugSetLight({ lampRadius: ui.light.lampRadius - 0.25 })} />
          <PixelButton small label="+" onPress={() => game.debugSetLight({ lampRadius: ui.light.lampRadius + 0.25 })} />
        </View>
        <Txt size={14}>hora {ui.light.mode}</Txt>
        <View style={styles.row}>
          <PixelButton small label="Auto" active={ui.light.mode === 'auto'} onPress={() => game.debugSetLight({ mode: 'auto' })} />
          <PixelButton small label="Día" active={ui.light.mode === 'day'} onPress={() => game.debugSetLight({ mode: 'day' })} />
          <PixelButton small label="Tarde" active={ui.light.mode === 'afternoon'} onPress={() => game.debugSetLight({ mode: 'afternoon' })} />
          <PixelButton small label="Noche" active={ui.light.mode === 'night'} onPress={() => game.debugSetLight({ mode: 'night' })} />
        </View>
        <View style={styles.row}>
          <PixelButton small label="fase −" onPress={() => game.debugSetLight({ mode: 'scrub', phase: ui.light.phase - 0.02 })} />
          <PixelButton small label="fase +" onPress={() => game.debugSetLight({ mode: 'scrub', phase: ui.light.phase + 0.02 })} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill },
  text: { position: 'absolute', left: 230, top: 8, right: 160, backgroundColor: 'rgba(0,0,0,0.6)', padding: 4 },
  buttons: { position: 'absolute', right: 8, bottom: 120, width: 140 },
  light: { position: 'absolute', left: 250, bottom: 8, width: 320, backgroundColor: 'rgba(0,0,0,0.72)', padding: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  fps: { position: 'absolute', left: '50%', bottom: 4 },
});
