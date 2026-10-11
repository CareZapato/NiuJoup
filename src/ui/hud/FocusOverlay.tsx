import { StyleSheet, View } from 'react-native';
import type { UiSnapshot } from '../../game/Game';
import type { FocusSymbol } from '../../game/content/types';
import { type BindAction, keyCaption } from '../../game/settings';
import { PixelIcon, type IconName } from '../controls/PixelIcon';
import { Panel, Txt } from '../components/primitives';
import { useServices } from '../GameContext';
import { COLORS } from '../theme';

const ARROW: Partial<Record<FocusSymbol, string>> = { F: '→', B: '←', U: '↑', D: '↓' };
const BUTTON: Partial<Record<FocusSymbol, { icon: IconName; action: BindAction; color: string }>> = {
  P: { icon: 'fist', action: 'light', color: COLORS.gold },
  K: { icon: 'blast', action: 'ki', color: COLORS.ki },
  H: { icon: 'heavy', action: 'heavy', color: COLORS.enemy },
  G: { icon: 'shield', action: 'guard', color: COLORS.good },
};

function Symbol({ s, state, caption }: { s: FocusSymbol; state: 'done' | 'next' | 'todo' | 'dead'; caption: (a: BindAction) => string | null }) {
  const bg = state === 'done' ? 'rgba(242,200,74,0.85)' : state === 'next' ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.45)';
  const border = state === 'next' ? '#ffffff' : state === 'dead' ? '#444' : COLORS.borderDim;
  const b = BUTTON[s];
  return (
    <View style={[styles.sym, { backgroundColor: bg, borderColor: border, opacity: state === 'dead' ? 0.35 : 1 }]}>
      {b ? (
        <PixelIcon name={b.icon} size={24} color="#101018" accent={b.color} />
      ) : (
        <Txt size={26} color={state === 'done' ? '#101018' : '#ffffff'}>
          {ARROW[s]}
        </Txt>
      )}
      {b && caption(b.action) && (
        <View style={styles.symCap}>
          <Txt size={12} color={COLORS.dim}>
            {caption(b.action)}
          </Txt>
        </View>
      )}
    </View>
  );
}

/**
 * Focus window HUD. Runs on the real-time clock (the world is at 0.2×), stays
 * at full brightness while the 3D view is desaturated, and never captures input.
 */
export function FocusOverlay({ ui }: { ui: UiSnapshot }) {
  const { game, touchUi } = useServices();
  const f = ui.focus;
  if (!f.active) return null;
  const caption = (a: BindAction): string | null => (touchUi ? null : keyCaption(game.settings.bindings[a]));
  const frac = Math.max(0, Math.min(1, f.remaining / f.window));
  const n = f.input.length;
  return (
    <View style={styles.wrap} pointerEvents="none">
      <Panel style={styles.panel}>
        <View style={styles.head}>
          <Txt size={14} title color="#d8d8ff">
            CONCENTRACIÓN
          </Txt>
          <Txt size={20} color={frac < 0.3 ? COLORS.hpLow : COLORS.text}>
            {f.remaining.toFixed(1)} s
          </Txt>
        </View>
        <View style={styles.timer}>
          <View style={[styles.timerFill, { width: `${frac * 100}%`, backgroundColor: frac < 0.3 ? COLORS.hpLow : '#d8d8ff' }]} />
        </View>
        {f.candidates.map((c) => (
          <View key={c.moveId + c.mode} style={[styles.row, { opacity: c.matching ? 1 : 0.4 }]}>
            <View style={styles.name}>
              <Txt size={18} color={c.limit ? COLORS.gold : COLORS.text} numberOfLines={1}>
                {c.name}
                {c.limit ? (c.mode === 'concentrate' ? ' · concentrar' : ' · dispersar') : ''}
              </Txt>
            </View>
            <View style={styles.seq}>
              {c.sequence.map((s, i) => (
                <Symbol key={i} s={s} caption={caption} state={!c.matching ? 'dead' : i < n ? 'done' : i === n ? 'next' : 'todo'} />
              ))}
            </View>
          </View>
        ))}
        <Txt size={14} color={COLORS.dim}>
          Las direcciones son relativas al objetivo. Suelta el joystick para repetir una dirección.
        </Txt>
      </Panel>
    </View>
  );
}

/** Persistent status chips for the controlled fighter (confusion, Kaioken, charge). */
export function StatusChips({ ui }: { ui: UiSnapshot }) {
  const s = ui.status;
  const chips: { text: string; color: string }[] = [];
  if (s.confused > 0) chips.push({ text: `¡CONFUNDIDO! ${s.confused.toFixed(1)}s`, color: '#e070ff' });
  if (s.blinded > 0) chips.push({ text: `CEGADO ${s.blinded.toFixed(1)}s`, color: '#ffffa0' });
  if (s.kaioken > 0) chips.push({ text: `KAIOKEN ${Math.ceil(s.kaioken)}s`, color: '#ff4a3a' });
  if (s.charging) chips.push({ text: 'CARGANDO KI', color: COLORS.ki });
  if (!ui.focus.active && ui.state === 'ACTIVE_COMBAT' && !ui.focus.ready) chips.push({ text: `Concentración ${ui.focus.cooldown.toFixed(1)}s`, color: COLORS.dim });
  if (!chips.length) return null;
  return (
    <View style={styles.chips} pointerEvents="none">
      {chips.map((c) => (
        <View key={c.text.split(' ')[0]} style={[styles.chip, { borderColor: c.color }]}>
          <Txt size={17} color={c.color}>
            {c.text}
          </Txt>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 64, left: 0, right: 0, alignItems: 'center' },
  panel: { minWidth: 320, maxWidth: 560, gap: 6, borderColor: '#d8d8ff' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  timer: { height: 8, borderWidth: 1, borderColor: '#ffffff', backgroundColor: '#000' },
  timerFill: { height: '100%' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { width: 170 },
  seq: { flexDirection: 'row', gap: 4 },
  sym: { width: 36, height: 36, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  symCap: { position: 'absolute', right: 1, top: -1 },
  chips: { position: 'absolute', top: '40%', left: 12, gap: 4 },
  chip: { backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 2, paddingHorizontal: 8 },
});
