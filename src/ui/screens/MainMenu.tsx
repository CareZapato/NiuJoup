import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CHARACTERS } from '../../game/content/characters';
import { Panel, PixelButton, Txt } from '../components/primitives';
import { useServices } from '../GameContext';
import { COLORS, hex } from '../theme';
import { SettingsTab } from './SettingsTab';

export function MainMenu() {
  const { game, saves, hasSave } = useServices();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'root' | 'select' | 'settings'>('root');
  const [status, setStatus] = useState<string | null>(null);

  const continueGame = async (): Promise<void> => {
    setStatus('Cargando…');
    const r = await saves.load();
    if (!r.data) {
      setStatus(`No se pudo cargar la partida${r.error ? `: ${r.error}` : ''}`);
      return;
    }
    game.loadSave(r.data);
    if (r.source === 'backup') game.pushToast('Se restauró la copia de seguridad (la principal estaba dañada)', 'warn');
    setStatus(null);
  };

  return (
    <View style={styles.root}>
      <Txt size={44} title color={COLORS.gold} style={{ textAlign: 'center' }}>
        LEGENDS RPG
      </Txt>
      <Txt size={20} color={COLORS.dim} style={{ textAlign: 'center', marginBottom: 16 }}>
        Prototipo fan no comercial · Valle de entrenamiento
      </Txt>
      {mode === 'root' && (
        <Panel style={styles.menu}>
          <PixelButton testID="btn-continue" label="Continuar" onPress={() => void continueGame()} disabled={!hasSave} />
          <PixelButton testID="btn-new" label="Nueva partida" onPress={() => setMode('select')} />
          <PixelButton label="Configuración" onPress={() => setMode('settings')} />
          {status && <Txt color={COLORS.warn}>{status}</Txt>}
        </Panel>
      )}
      {mode === 'select' && (
        <Panel style={[styles.menu, { maxWidth: 760 }]}>
          <Txt size={22} color={COLORS.gold}>
            Elige a tu líder
          </Txt>
          <View style={styles.cards}>
            {Object.values(CHARACTERS).map((c) => (
              <View key={c.id} style={styles.card}>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <View style={{ width: 14, height: 14, backgroundColor: hex(c.appearance.palette.outfit), borderWidth: 1, borderColor: '#000' }} />
                  <Txt size={22}>{c.name}</Txt>
                </View>
                <Txt size={16} color={COLORS.gold}>
                  {c.archetype}
                </Txt>
                <Txt size={15} color={COLORS.dim}>
                  {c.description}
                </Txt>
                <Txt size={15}>
                  PV {c.baseStats.maxHp} · Ki {c.baseStats.maxKi} · Atq {c.baseStats.physicalAttack} · Ki-Atq {c.baseStats.kiAttack} · Def {c.baseStats.physicalDefense} · Vel {c.baseStats.speed}
                </Txt>
                <PixelButton testID={`pick-${c.id}`} small label="Elegir" onPress={() => game.newGame(c.id)} />
              </View>
            ))}
          </View>
          <PixelButton small label="Volver" onPress={() => setMode('root')} />
        </Panel>
      )}
      {mode === 'settings' && (
        <Panel style={[styles.menu, { maxWidth: 700, maxHeight: '80%' }]}>
          <ScrollView>
            <SettingsTab />
          </ScrollView>
          <PixelButton small label="Volver" onPress={() => setMode('root')} />
        </Panel>
      )}
      <Txt size={16} color={COLORS.dim} style={[styles.credit, { bottom: Math.max(10, insets.bottom + 6) }]}>
        Carezapato - v0.1.0
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(6, 8, 24, 0.55)', alignItems: 'center', justifyContent: 'center', padding: 12 },
  menu: { minWidth: 300, alignItems: 'stretch', gap: 4 },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8 },
  card: { flexBasis: 330, flexGrow: 1, borderWidth: 1, borderColor: COLORS.borderDim, padding: 6, gap: 2 },
  credit: { position: 'absolute', left: 0, right: 0, textAlign: 'center' },
});
