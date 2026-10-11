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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill },
  text: { position: 'absolute', left: 230, top: 8, right: 160, backgroundColor: 'rgba(0,0,0,0.6)', padding: 4 },
  buttons: { position: 'absolute', right: 8, bottom: 120, width: 140 },
  fps: { position: 'absolute', left: '50%', bottom: 4 },
});
