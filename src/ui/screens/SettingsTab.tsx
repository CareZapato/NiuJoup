import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { BIND_LABELS, type BindAction, DEFAULT_BINDINGS } from '../../game/settings';
import { PixelButton, Txt } from '../components/primitives';
import { useServices } from '../GameContext';
import { COLORS } from '../theme';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginVertical: 2 }}>
      <Txt size={18}>{label}</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{children}</View>
    </View>
  );
}

export function SettingsTab() {
  const { game, updateSettings } = useServices();
  const s = game.settings;
  const [, force] = useState(0);
  const [rebinding, setRebinding] = useState<BindAction | null>(null);
  const set = (patch: Parameters<typeof updateSettings>[0]): void => {
    updateSettings(patch);
    force((x) => x + 1);
  };

  useEffect(() => {
    if (!rebinding || Platform.OS !== 'web') return;
    const h = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code !== 'Escape') set({ bindings: { ...game.settings.bindings, [rebinding]: e.code } });
      setRebinding(null);
    };
    window.addEventListener('keydown', h, { capture: true });
    return () => window.removeEventListener('keydown', h, { capture: true });
  });

  const opts = <T extends string | number | boolean>(cur: T, values: [T, string][], onPick: (v: T) => void) =>
    values.map(([v, l]) => <PixelButton key={String(v)} small label={l} active={cur === v} onPress={() => onPick(v)} />);

  return (
    <View>
      <Txt size={22} color={COLORS.gold}>
        Accesibilidad y cámara
      </Txt>
      <Row label="Ventana de comandos">{opts(s.inputWindowMultiplier, [[1, 'Normal'], [1.5, 'Amplia'], [2, 'Muy amplia']], (v) => set({ inputWindowMultiplier: v }))}</Row>
      <Row label="Reducir movimiento de cámara">{opts(s.reducedMotion, [[false, 'No'], [true, 'Sí']], (v) => set({ reducedMotion: v }))}</Row>
      <Row label="Reducir destellos">{opts(s.reduceFlashes, [[false, 'No'], [true, 'Sí']], (v) => set({ reduceFlashes: v }))}</Row>
      <Row label="Suavizado de cámara">{opts(s.cameraSmoothing, [[5, 'Suave'], [9, 'Normal'], [14, 'Rápido']], (v) => set({ cameraSmoothing: v }))}</Row>
      <Row label="Calidad de efectos">{opts(s.quality, [['high', 'Alta'], ['low', 'Baja']], (v) => set({ quality: v }))}</Row>
      <Txt size={22} color={COLORS.gold}>
        Táctil y mando
      </Txt>
      <Row label="Controles táctiles">{opts(s.touchControls, [['auto', 'Auto'], ['on', 'Sí'], ['off', 'No']], (v) => set({ touchControls: v }))}</Row>
      <Row label="Tamaño de botones">{opts(s.buttonScale, [[0.8, 'S'], [1, 'M'], [1.25, 'L'], [1.5, 'XL']], (v) => set({ buttonScale: v }))}</Row>
      <Row label="Sensibilidad joystick">{opts(s.joystickSensitivity, [[0.7, 'Baja'], [1, 'Media'], [1.3, 'Alta']], (v) => set({ joystickSensitivity: v }))}</Row>
      <Row label="Modo debug">{opts(s.debug, [[false, 'No'], [true, 'Sí']], (v) => set({ debug: v }))}</Row>
      {Platform.OS === 'web' && (
        <>
          <Txt size={22} color={COLORS.gold}>
            Teclado (pulsa para reasignar)
          </Txt>
          {(Object.keys(BIND_LABELS) as BindAction[]).map((a) => (
            <Row key={a} label={BIND_LABELS[a]}>
              <PixelButton small active={rebinding === a} label={rebinding === a ? 'Pulsa una tecla…' : s.bindings[a].replace('Key', '')} onPress={() => setRebinding(a)} />
            </Row>
          ))}
          <PixelButton small label="Restaurar teclas" onPress={() => set({ bindings: { ...DEFAULT_BINDINGS } })} />
        </>
      )}
    </View>
  );
}
