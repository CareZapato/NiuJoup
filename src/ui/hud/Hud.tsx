import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { UiSnapshot } from '../../game/Game';
import { Bar, Panel, Txt } from '../components/primitives';
import { useGameUi, useServices } from '../GameContext';
import { COLORS, hex } from '../theme';
import { FocusOverlay, StatusChips } from './FocusOverlay';
import { Portrait } from './Portrait';
import { TechniqueBanner } from './TechniqueBanner';

function MoneyLine({ ui }: { ui: UiSnapshot }) {
  return (
    <Txt size={16} color={COLORS.gold}>
      {ui.money} monedas{ui.area ? `  ·  ${ui.area}` : ''}
    </Txt>
  );
}

function PartyPanel({ ui, withMoney }: { ui: UiSnapshot; withMoney?: boolean }) {
  return (
    <Panel style={styles.party}>
      {ui.party.map((p) => (
        <View key={p.characterId} style={styles.member}>
          <View style={styles.memberHead}>
            <Txt size={18} color={p.isLeader ? COLORS.gold : COLORS.text}>
              {p.isLeader ? '★ ' : ''}
              {p.name}
            </Txt>
            <Txt size={16} color={COLORS.dim}>
              Nv {p.level}
              {p.ap > 0 ? `  AP ${p.ap}` : ''}
            </Txt>
          </View>
          <Bar value={p.hp} max={p.maxHp} color={p.hp / p.maxHp < 0.3 ? COLORS.hpLow : COLORS.hp} height={7} />
          <View style={{ height: 2 }} />
          <Bar value={p.ki} max={p.maxKi} color={COLORS.ki} height={5} />
          <View style={{ height: 2 }} />
          <Bar value={p.rage} max={100} color={p.rage >= 100 ? COLORS.gold : COLORS.rage} height={3} />
          {p.isLeader && (
            <>
              <View style={{ height: 2 }} />
              <Bar value={p.xp} max={p.xpNext} color={COLORS.xp} height={3} />
            </>
          )}
        </View>
      ))}
      {withMoney && <MoneyLine ui={ui} />}
    </Panel>
  );
}

export function Minimap({ ui, size = 128 }: { ui: UiSnapshot; size?: number }) {
  const m = ui.minimap;
  const sx = size / m.w;
  const h = m.h * sx;
  const dot = (x: number, z: number, color: string, s = 4, key?: string) => (
    <View key={key} style={{ position: 'absolute', left: x * sx - s / 2, top: z * sx - s / 2, width: s, height: s, backgroundColor: color }} />
  );
  return (
    <View style={{ width: size, height: h, backgroundColor: '#2f6a26', borderWidth: 2, borderColor: COLORS.borderDim, overflow: 'hidden' }}>
      <View style={{ position: 'absolute', left: 37 * sx, top: 0, width: 3 * sx, height: h, backgroundColor: '#3a8ad8' }} />
      <View style={{ position: 'absolute', left: 42 * sx, top: 2 * sx, width: 20 * sx, height: 14 * sx, backgroundColor: '#8a7a5a' }} />
      <View style={{ position: 'absolute', left: 43 * sx, top: 32 * sx, width: 19 * sx, height: 15 * sx, backgroundColor: '#7a6a4a' }} />
      <View style={{ position: 'absolute', left: 3 * sx, top: 3 * sx, width: 19 * sx, height: 13 * sx, backgroundColor: '#9a8a5a' }} />
      {m.points.map((p, i) => dot(p.x, p.z, p.kind === 'chest' ? COLORS.gold : p.kind === 'npc' ? '#ffffff' : p.kind === 'recovery' ? '#4ab8ff' : '#c8f2ff', 4, `p${i}`))}
      {m.enemies.map((e, i) => dot(e.x, e.z, e.boss ? '#ff00ff' : COLORS.enemy, e.boss ? 6 : 4, `e${i}`))}
      {dot(m.player.x, m.player.z, '#ffff4a', 6)}
    </View>
  );
}

function PowerBalanceBar({ ui }: { ui: UiSnapshot }) {
  const v = ui.pb.value;
  const pct = (v + 100) / 200;
  const thrL = (100 - ui.pb.threshold) / 200;
  const thrR = (100 + ui.pb.threshold) / 200;
  const dom = ui.pb.dominance;
  return (
    <View style={styles.pbWrap}>
      <View style={styles.pbLabels}>
        <Txt size={16} color={COLORS.player}>
          ALIADOS
        </Txt>
        <Txt size={14} title color={dom ? (dom === 'player' ? COLORS.gold : COLORS.enemy) : COLORS.dim}>
          {dom ? (dom === 'player' ? `DOMINIO ${Math.ceil(ui.pb.ticksLeft / 60)}s` : `DOMINIO RIVAL`) : 'POWER BALANCE'}
        </Txt>
        <Txt size={16} color={COLORS.enemy}>
          RIVALES
        </Txt>
      </View>
      <View style={[styles.pbBar, dom === 'player' && { borderColor: COLORS.gold }, dom === 'enemy' && { borderColor: COLORS.enemy }]}>
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct * 100}%`, backgroundColor: COLORS.player }} />
        <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${(1 - pct) * 100}%`, backgroundColor: COLORS.enemy }} />
        <View style={[styles.pbMark, { left: `${thrL * 100}%` }]} />
        <View style={[styles.pbMark, { left: `${thrR * 100}%` }]} />
        <View style={[styles.pbCursor, { left: `${pct * 100}%` }]} />
      </View>
    </View>
  );
}

function CombatantRow({ c, align }: { c: UiSnapshot['combatants'][number]; align: 'left' | 'right' }) {
  const defeated = c.state === 'DEFEATED';
  return (
    <View style={[styles.cRow, { opacity: defeated ? 0.45 : 1, alignItems: align === 'left' ? 'flex-start' : 'flex-end' }]}>
      <View style={{ flexDirection: align === 'left' ? 'row' : 'row-reverse', alignItems: 'center', gap: 4 }}>
        <View style={{ width: 8, height: 8, backgroundColor: hex(c.color) }} />
        <Txt size={17} color={c.controlled ? COLORS.gold : c.isTarget ? COLORS.warn : COLORS.text} numberOfLines={1}>
          {c.controlled ? '▶' : ''}
          {c.name}
          {c.isTarget ? ' ◎' : ''}
          {c.transformed ? ' ✦' : ''}
        </Txt>
      </View>
      <Bar value={c.hp} max={c.maxHp} color={c.hp / c.maxHp < 0.3 ? COLORS.hpLow : COLORS.hp} height={7} width={140} />
      <View style={{ height: 2 }} />
      <Bar value={c.ki} max={c.maxKi} color={COLORS.ki} height={4} width={140} />
      {c.team === 'player' && (
        <>
          <View style={{ height: 2 }} />
          <Bar value={c.rage} max={100} color={c.rage >= 100 ? COLORS.gold : COLORS.rage} height={3} width={140} />
        </>
      )}
    </View>
  );
}

function CombatHud({ ui }: { ui: UiSnapshot }) {
  const { touchUi } = useServices();
  const allies = ui.combatants.filter((c) => c.team === 'player');
  const enemies = ui.combatants.filter((c) => c.team === 'enemy');
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={styles.topBar}>
        <Panel style={styles.side}>
          {allies.map((c) => (
            <CombatantRow key={c.id} c={c} align="left" />
          ))}
        </Panel>
        <PowerBalanceBar ui={ui} />
        <Panel style={styles.side}>
          {enemies.map((c) => (
            <CombatantRow key={c.id} c={c} align="right" />
          ))}
        </Panel>
      </View>
      {ui.combo >= 2 && (
        <View style={styles.combo}>
          <Txt size={34} title color={COLORS.gold}>
            {ui.combo} HITS
          </Txt>
          <Txt size={18} color={COLORS.text}>
            {ui.comboDamage} daño
          </Txt>
        </View>
      )}
      {ui.specialReady && !ui.focus.active && (
        <View style={styles.special}>
          <Txt size={18} title color={COLORS.gold}>
            ¡LÍMITE LISTO!
          </Txt>
        </View>
      )}
      {!touchUi && (
        <View style={styles.helpLine}>
          <Txt size={14} color={COLORS.dim}>
            WASD mover · J/K/L atacar · U defensa · I cargar · Shift dash · F concentración · 1-4 técnicas · G límite · R objetivo · Tab aliado
          </Txt>
        </View>
      )}
      <StatusChips ui={ui} />
      <FocusOverlay ui={ui} />
    </View>
  );
}

function ExplorationHud({ ui }: { ui: UiSnapshot }) {
  const { touchUi } = useServices();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={styles.topLeft}>
        <PartyPanel ui={ui} withMoney={touchUi} />
      </View>
      <View style={styles.topRight}>
        <Minimap ui={ui} size={touchUi ? 110 : 140} />
        {ui.objective && (
          <Panel style={styles.objective}>
            <Txt size={15} color={COLORS.quest}>
              Misión
            </Txt>
            <Txt size={17}>{ui.objective}</Txt>
          </Panel>
        )}
        {!touchUi && <MoneyLine ui={ui} />}
      </View>
      {ui.prompt && (
        <View style={styles.prompt}>
          <Panel>
            <Txt size={20}>{touchUi ? ui.prompt.replace('J:', 'Botón J:') : ui.prompt}</Txt>
          </Panel>
        </View>
      )}
      {!touchUi && (
        <View style={styles.helpLine}>
          <Txt size={14} color={COLORS.dim}>
            WASD mover · Shift correr · Espacio saltar · J interactuar · L disparo de ki · I cargar · 1-4 técnicas · Tab líder · Esc menú
          </Txt>
        </View>
      )}
    </View>
  );
}

function Toasts({ ui }: { ui: UiSnapshot }) {
  const { width, height } = useWindowDimensions();
  const color = { info: COLORS.text, good: COLORS.good, warn: COLORS.warn, quest: COLORS.quest } as const;
  // The focus panel owns the top of the screen during its 3 s window.
  if (ui.focus.active) return null;
  const portrait = height > width;
  const combat = ui.state === 'ACTIVE_COMBAT' || ui.state === 'ENCOUNTER_TRANSITION' || ui.state === 'COMBAT_VICTORY' || ui.state === 'COMBAT_DEFEAT';
  // Under the party panel in portrait, and between the side panels in landscape, so the text never covers them or the buttons.
  const top = combat ? (portrait ? 118 : 64) : portrait ? 196 : 72;
  return (
    <View style={[styles.toasts, { top, paddingHorizontal: 8 }]} pointerEvents="none">
      {ui.toasts.slice(-3).map((t) => (
        <View key={t.id} style={[styles.toast, { maxWidth: Math.min(360, width - (portrait ? 16 : 280)) }]}>
          <Txt size={19} color={color[t.tone]}>
            {t.text}
          </Txt>
        </View>
      ))}
    </View>
  );
}

function FaceSlot({ slot, flip }: { slot: NonNullable<UiSnapshot['dialogue']>['left']; flip: boolean }) {
  return (
    <View style={[styles.face, { opacity: slot.speaking ? 1 : 0.42, borderColor: slot.speaking ? COLORS.gold : COLORS.borderDim }]}>
      <Portrait id={slot.portrait} expression={slot.expression} flip={flip} size={80} />
      <Txt size={14} numberOfLines={1} color={slot.speaking ? COLORS.gold : COLORS.dim}>
        {slot.name}
      </Txt>
    </View>
  );
}

function DialogueBox({ ui }: { ui: UiSnapshot }) {
  const { game, touchUi } = useServices();
  const insets = useSafeAreaInsets();
  const d = ui.dialogue;
  if (!d) return null;
  return (
    <View style={[styles.dialogue, { bottom: insets.bottom + (touchUi ? 118 : 16) }]} onTouchEnd={() => game.input.tap('light')}>
      <Panel style={styles.dialoguePanel}>
        <FaceSlot slot={d.left} flip={false} />
        <View style={styles.dialogueText}>
          <Txt size={18} color={COLORS.gold}>
            {d.speaker}
          </Txt>
          <Txt size={22}>{d.line}</Txt>
          <Txt size={15} color={COLORS.dim}>
            [J] {d.index + 1}/{d.total}
          </Txt>
        </View>
        <FaceSlot slot={d.right} flip />
      </Panel>
    </View>
  );
}

function Rewards({ ui }: { ui: UiSnapshot }) {
  const r = ui.rewards;
  if (!r) return null;
  return (
    <View style={styles.rewards} pointerEvents="none">
      <Panel style={{ borderColor: COLORS.gold, alignItems: 'center' }}>
        <Txt size={20} title color={COLORS.gold}>
          ¡VICTORIA!
        </Txt>
        <Txt size={20}>
          +{r.xp} XP · +{r.ap} AP · +{r.money} monedas
        </Txt>
        {r.items.map((i, k) => (
          <Txt key={k} size={17} color={COLORS.good}>
            {i.name} x{i.count}
          </Txt>
        ))}
        {r.levelUps.map((l, k) => (
          <Txt key={`l${k}`} size={18} color={COLORS.gold}>
            {l.name} sube a nivel {l.level}
          </Txt>
        ))}
        {r.farmPenalty && (
          <Txt size={15} color={COLORS.dim}>
            Recompensa reducida: este enemigo ya no te enseña mucho.
          </Txt>
        )}
      </Panel>
    </View>
  );
}

function SaveIndicator({ ui }: { ui: UiSnapshot }) {
  const { touchUi } = useServices();
  if (ui.save.status === 'idle') return null;
  return (
    <View style={touchUi ? styles.saveTouch : styles.save} pointerEvents="none">
      <Txt size={15} color={ui.save.status === 'error' ? COLORS.hpLow : COLORS.dim}>
        {ui.save.text}
      </Txt>
    </View>
  );
}

export function Hud() {
  const ui = useGameUi();
  const s = ui.state === 'PAUSED' ? ui.previousState : ui.state;
  const combat = s === 'ACTIVE_COMBAT' || s === 'ENCOUNTER_TRANSITION' || s === 'COMBAT_VICTORY' || s === 'COMBAT_DEFEAT';
  if (ui.state === 'MAIN_MENU' || ui.state === 'BOOT') return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {combat ? <CombatHud ui={ui} /> : <ExplorationHud ui={ui} />}
      <Toasts ui={ui} />
      <TechniqueBanner />
      <Rewards ui={ui} />
      <DialogueBox ui={ui} />
      <SaveIndicator ui={ui} />
    </View>
  );
}

const styles = StyleSheet.create({
  topLeft: { position: 'absolute', left: 8, top: 8 },
  topRight: { position: 'absolute', right: 8, top: 8, alignItems: 'flex-end', gap: 4, maxWidth: 260 },
  party: { width: 210, gap: 4 },
  member: { marginBottom: 3 },
  memberHead: { flexDirection: 'row', justifyContent: 'space-between' },
  objective: { maxWidth: 260 },
  prompt: { position: 'absolute', bottom: 70, alignSelf: 'center', left: 0, right: 0, alignItems: 'center' },
  helpLine: { position: 'absolute', bottom: 6, left: 0, right: 0, alignItems: 'center' },
  topBar: { position: 'absolute', top: 6, left: 6, right: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  side: { padding: 4, gap: 2 },
  cRow: { marginBottom: 2 },
  pbWrap: { flex: 1, maxWidth: 520, marginHorizontal: 10, alignItems: 'stretch' },
  pbLabels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pbBar: { height: 14, borderWidth: 2, borderColor: '#ffffff', backgroundColor: '#000', overflow: 'hidden' },
  pbMark: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: '#ffffff' },
  pbCursor: { position: 'absolute', top: -2, bottom: -2, width: 4, marginLeft: -2, backgroundColor: '#fff07a' },
  combo: { position: 'absolute', left: 16, top: '34%' },
  special: { position: 'absolute', alignSelf: 'center', top: 64, left: 0, right: 0, alignItems: 'center' },
  moves: { position: 'absolute', left: 8, bottom: 8, maxWidth: 420, padding: 6 },
  toasts: { position: 'absolute', top: 92, left: 0, right: 0, alignItems: 'center', gap: 2 },
  toast: { backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 10, paddingVertical: 1 },
  dialogue: { position: 'absolute', left: 8, right: 8 },
  dialoguePanel: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 8 },
  dialogueText: { flex: 1, gap: 2 },
  face: { width: 92, alignItems: 'center', borderWidth: 2, backgroundColor: '#1a1428', paddingTop: 2 },
  rewards: { position: 'absolute', top: '30%', left: 0, right: 0, alignItems: 'center' },
  save: { position: 'absolute', right: 10, bottom: 6 },
  saveTouch: { position: 'absolute', left: 0, right: 0, top: 2, alignItems: 'center' },
});
