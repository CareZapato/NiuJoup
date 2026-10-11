import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { AllyOrder } from '../../game/components';
import { CHARACTERS } from '../../game/content/characters';
import { ITEMS, QUESTS } from '../../game/content/items';
import { getMove } from '../../game/content/moves';
import { SKILLS, SKILL_TREES } from '../../game/content/skills';
import type { EquipSlot, StatKey } from '../../game/content/types';
import { canPurchaseSkill, computeStats } from '../../game/systems/progression/progression';
import { Bar, Panel, PixelButton, Txt } from '../components/primitives';
import { useGameUi, useServices } from '../GameContext';
import { Minimap } from '../hud/Hud';
import { COLORS } from '../theme';
import { SettingsTab } from './SettingsTab';

type Tab = 'party' | 'skills' | 'items' | 'quests' | 'map' | 'settings';
const TABS: [Tab, string][] = [
  ['party', 'Personajes'],
  ['skills', 'Habilidades'],
  ['items', 'Inventario'],
  ['quests', 'Misiones'],
  ['map', 'Mapa'],
  ['settings', 'Ajustes'],
];
const ORDERS: [AllyOrder, string][] = [
  ['AGGRESSIVE', 'Agresivo'],
  ['BALANCED', 'Equilibrado'],
  ['DEFENSIVE', 'Defensivo'],
  ['SUPPORT', 'Apoyo'],
  ['FOCUS_TARGET', 'Mi objetivo'],
];
const SLOTS: [EquipSlot, string][] = [
  ['hands', 'Manos'],
  ['body', 'Cuerpo'],
  ['accessory', 'Accesorio'],
];
const STAT_LABELS: [StatKey, string][] = [
  ['maxHp', 'PV'],
  ['maxKi', 'Ki'],
  ['physicalAttack', 'Atq'],
  ['kiAttack', 'Atq Ki'],
  ['physicalDefense', 'Def'],
  ['kiDefense', 'Def Ki'],
  ['speed', 'Vel'],
  ['technique', 'Téc'],
  ['criticalRate', 'Crít'],
  ['evasion', 'Eva'],
];

function CharacterPicker({ selected, onSelect, ids }: { selected: string; onSelect: (id: string) => void; ids: string[] }) {
  return (
    <View style={styles.row}>
      {ids.map((id) => (
        <PixelButton key={id} small label={CHARACTERS[id].name} active={selected === id} onPress={() => onSelect(id)} />
      ))}
    </View>
  );
}

function PartyTab() {
  const { game } = useServices();
  useGameUi();
  const [sel, setSel] = useState(game.partyOrder[0]);
  const m = game.roster[sel];
  const st = computeStats(m);
  const canReorder = game.fsm.previous === 'WORLD_EXPLORATION';
  const ids = Object.keys(CHARACTERS);
  const inParty = game.partyOrder.includes(sel);

  const toggleMember = (): void => {
    if (inParty) {
      if (game.partyOrder.length <= 1) return;
      game.setPartyOrder(game.partyOrder.filter((x) => x !== sel));
    } else if (game.partyOrder.length < 3) {
      game.setPartyOrder([...game.partyOrder, sel]);
    }
  };
  const makeLeader = (): void => game.setPartyOrder([sel, ...game.partyOrder.filter((x) => x !== sel)]);
  const equipables = Object.entries(game.inventory.items).filter(([id, n]) => n > 0 && ITEMS[id]?.equip);

  return (
    <View>
      <CharacterPicker ids={ids} selected={sel} onSelect={setSel} />
      <Txt size={16} color={COLORS.dim}>
        Grupo activo: {game.partyOrder.map((id) => CHARACTERS[id].name).join(' · ')} (líder: {CHARACTERS[game.leaderId].name})
      </Txt>
      <View style={styles.cols}>
        <View style={styles.col}>
          <Txt size={22} color={COLORS.gold}>
            {CHARACTERS[sel].name} — Nv {m.level}
          </Txt>
          <Txt size={16} color={COLORS.dim}>
            XP {m.xp} · AP {m.ap}
          </Txt>
          <Bar value={m.hp} max={st.maxHp} color={COLORS.hp} />
          {STAT_LABELS.map(([k, l]) => (
            <Txt key={k} size={17}>
              {l}: {Math.round(st[k])}
            </Txt>
          ))}
        </View>
        <View style={styles.col}>
          <Txt size={20} color={COLORS.gold}>
            Equipo
          </Txt>
          {SLOTS.map(([slot, label]) => (
            <View key={slot} style={styles.rowBetween}>
              <Txt size={17}>
                {label}: {m.equipment[slot] ? ITEMS[m.equipment[slot]!].name : '—'}
              </Txt>
              {m.equipment[slot] && <PixelButton small label="Quitar" onPress={() => game.unequip(sel, slot)} />}
            </View>
          ))}
          {equipables.map(([id, n]) => (
            <View key={id} style={styles.rowBetween}>
              <Txt size={16} color={COLORS.dim}>
                {ITEMS[id].name} x{n}
              </Txt>
              <PixelButton small label="Equipar" onPress={() => game.equip(sel, id)} />
            </View>
          ))}
          <Txt size={20} color={COLORS.gold}>
            Orden en combate
          </Txt>
          <View style={styles.row}>
            {ORDERS.map(([o, l]) => (
              <PixelButton key={o} small label={l} active={(game.allyOrders[sel] ?? 'BALANCED') === o} onPress={() => game.setAllyOrder(sel, o)} />
            ))}
          </View>
          {canReorder ? (
            <View style={styles.row}>
              <PixelButton small label={inParty ? 'Sacar del grupo' : 'Añadir al grupo'} disabled={inParty ? game.partyOrder.length <= 1 : game.partyOrder.length >= 3} onPress={toggleMember} />
              {inParty && game.leaderId !== sel && <PixelButton small label="Hacer líder" onPress={makeLeader} />}
            </View>
          ) : (
            <Txt size={15} color={COLORS.dim}>
              El grupo solo puede cambiarse durante la exploración.
            </Txt>
          )}
        </View>
      </View>
    </View>
  );
}

function SkillsTab() {
  const { game } = useServices();
  useGameUi();
  const [sel, setSel] = useState(game.partyOrder[0]);
  const [msg, setMsg] = useState<string | null>(null);
  const m = game.roster[sel];
  const tree = SKILL_TREES[CHARACTERS[sel].skillTree];
  const rows = Math.max(...tree.nodes.map((n) => n.row)) + 1;
  const cols = Math.max(...tree.nodes.map((n) => n.col)) + 1;

  return (
    <View>
      <CharacterPicker ids={Object.keys(CHARACTERS)} selected={sel} onSelect={setSel} />
      <Txt size={20} color={COLORS.gold}>
        AP disponibles: {m.ap}
      </Txt>
      {msg && <Txt color={COLORS.warn}>{msg}</Txt>}
      {Array.from({ length: rows }, (_, r) => (
        <View key={r} style={styles.treeRow}>
          {Array.from({ length: cols }, (_, c) => {
            const node = tree.nodes.find((n) => n.row === r && n.col === c);
            if (!node) return <View key={c} style={styles.nodeEmpty} />;
            const sk = SKILLS[node.skillId];
            const lv = m.skills[sk.id] ?? 0;
            const chk = canPurchaseSkill(m, sk.id);
            return (
              <View key={c} style={[styles.node, lv > 0 && { borderColor: COLORS.gold }, !chk.ok && lv === 0 && { opacity: 0.6 }]}>
                <Txt size={17} color={lv > 0 ? COLORS.gold : COLORS.text}>
                  {sk.name} {lv}/{sk.maxLevel}
                </Txt>
                <Txt size={14} color={COLORS.dim}>
                  {sk.description}
                </Txt>
                {sk.unlocksMoves.length > 0 && (
                  <Txt size={14} color={COLORS.ki}>
                    {sk.unlocksMoves.map((id) => `${getMove(id).name}${getMove(id).command ? ` [${getMove(id).command!.label}]` : ''}`).join(', ')}
                  </Txt>
                )}
                <PixelButton
                  small
                  testID={`skill-${sk.id}`}
                  label={chk.ok ? `Aprender (${chk.cost} AP)` : chk.reason}
                  disabled={!chk.ok}
                  onPress={() => setMsg(game.purchaseSkill(sel, sk.id))}
                />
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function ItemsTab() {
  const { game } = useServices();
  useGameUi();
  const [target, setTarget] = useState(game.partyOrder[0]);
  const entries = Object.entries(game.inventory.items).filter(([, n]) => n > 0);
  return (
    <View>
      <Txt size={18} color={COLORS.dim}>
        Usar en:
      </Txt>
      <CharacterPicker ids={game.partyOrder} selected={target} onSelect={setTarget} />
      <Txt size={18} color={COLORS.gold}>
        Monedas: {game.money}
      </Txt>
      {entries.length === 0 && <Txt color={COLORS.dim}>Inventario vacío</Txt>}
      {entries.map(([id, n]) => {
        const it = ITEMS[id];
        return (
          <View key={id} style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Txt size={18} color={it.important ? COLORS.quest : COLORS.text}>
                {it.name} x{n}
              </Txt>
              <Txt size={14} color={COLORS.dim}>
                {it.description}
              </Txt>
            </View>
            {it.heal && <PixelButton small label="Usar" onPress={() => game.useItem(id, target)} />}
            {it.equip && <PixelButton small label="Equipar" onPress={() => game.equip(target, id)} />}
          </View>
        );
      })}
    </View>
  );
}

function QuestsTab() {
  const { game } = useServices();
  return (
    <View>
      {Object.values(QUESTS).map((q) => {
        const p = game.quests.get(q.id);
        if (p.status === 'inactive') return null;
        return (
          <View key={q.id} style={{ marginBottom: 8 }}>
            <Txt size={20} color={p.status === 'completed' ? COLORS.good : COLORS.quest}>
              {q.name} {p.status === 'completed' ? '(completada)' : ''}
            </Txt>
            <Txt size={15} color={COLORS.dim}>
              {q.description}
            </Txt>
            {q.objectives.map((o, i) => (
              <Txt key={i} size={16} color={i < p.step || p.status === 'completed' ? COLORS.good : i === p.step ? COLORS.text : COLORS.dim}>
                {i < p.step || p.status === 'completed' ? '✔' : i === p.step ? '▶' : '·'} {i === p.step && p.status === 'active' ? game.quests.currentObjectiveText(q.id) : o.text}
              </Txt>
            ))}
          </View>
        );
      })}
      {Object.values(QUESTS).every((q) => game.quests.get(q.id).status === 'inactive') && <Txt color={COLORS.dim}>Aún no tienes misiones. Habla con los aldeanos.</Txt>}
    </View>
  );
}

export function PauseMenu() {
  const { game, saves, refreshHasSave } = useServices();
  const ui = useGameUi();
  const [tab, setTab] = useState<Tab>('party');
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  if (ui.state !== 'PAUSED') return null;
  const canSave = ui.previousState === 'WORLD_EXPLORATION';

  const saveNow = async (): Promise<void> => {
    setSaveMsg('Guardando…');
    saves.request('manual', true);
    const ok = await saves.flush();
    setSaveMsg(ok ? 'Partida guardada' : 'Error al guardar');
    refreshHasSave();
  };

  return (
    <View style={styles.overlay}>
      <Panel style={styles.box}>
        <View style={styles.rowBetween}>
          <Txt size={22} title color={COLORS.gold}>
            PAUSA
          </Txt>
          <Txt size={16} color={COLORS.dim}>
            Tiempo: {Math.floor(ui.playTime / 60)}m {ui.playTime % 60}s
          </Txt>
        </View>
        <View style={styles.row}>
          {TABS.map(([t, l]) => (
            <PixelButton key={t} testID={`tab-${t}`} small label={l} active={tab === t} onPress={() => setTab(t)} />
          ))}
        </View>
        <ScrollView style={styles.content}>
          {tab === 'party' && <PartyTab />}
          {tab === 'skills' && <SkillsTab />}
          {tab === 'items' && <ItemsTab />}
          {tab === 'quests' && <QuestsTab />}
          {tab === 'map' && (
            <View style={{ alignItems: 'center' }}>
              <Minimap ui={ui} size={420} />
              <Txt size={15} color={COLORS.dim}>
                Amarillo: tú · Rojo: enemigos · Magenta: jefe · Dorado: cofres · Blanco: aldeanos · Azul: cristal de recuperación
              </Txt>
            </View>
          )}
          {tab === 'settings' && <SettingsTab />}
        </ScrollView>
        <View style={styles.row}>
          <PixelButton testID="btn-resume" label="Continuar" onPress={() => game.resume()} />
          <PixelButton testID="btn-save" label="Guardar" disabled={!canSave} onPress={() => void saveNow()} />
          <PixelButton label="Menú principal" onPress={() => game.returnToMenu()} />
        </View>
        {saveMsg && <Txt color={COLORS.dim}>{saveMsg}</Txt>}
        {!canSave && (
          <Txt size={15} color={COLORS.dim}>
            Solo se puede guardar durante la exploración.
          </Txt>
        )}
      </Panel>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 10 },
  box: { width: '100%', maxWidth: 920, maxHeight: '96%', borderColor: COLORS.border },
  content: { marginVertical: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
  cols: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 },
  col: { flexGrow: 1, flexBasis: 300, gap: 2 },
  treeRow: { flexDirection: 'row', gap: 6, marginBottom: 6 },
  node: { flex: 1, borderWidth: 2, borderColor: COLORS.borderDim, padding: 4, minHeight: 90, justifyContent: 'space-between' },
  nodeEmpty: { flex: 1 },
});
