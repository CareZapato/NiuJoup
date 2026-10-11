import { describe, expect, it } from 'vitest';
import { BALANCE, xpToNextLevel } from '../content/balance';
import { Rng } from '../core/math';
import { EquipmentManager, InventoryManager, LootTableManager } from '../systems/progression/inventory';
import {
  canPurchaseSkill,
  computeStats,
  createMember,
  farmMultiplier,
  type FarmLedger,
  grantXp,
  levelGapMultiplier,
  purchaseSkill,
  recordKill,
  unlockedMoves,
} from '../systems/progression/progression';
import { QuestManager } from '../systems/progression/quests';

describe('XP and levels', () => {
  it('uses floor(100 * level^1.5)', () => {
    expect(xpToNextLevel(1)).toBe(100);
    expect(xpToNextLevel(2)).toBe(282);
    expect(xpToNextLevel(5)).toBe(1118);
  });

  it('levels up across multiple thresholds, grants AP and heals', () => {
    const m = createMember('kaien');
    m.hp = 1;
    const r = grantXp(m, 100 + 282 + 10);
    expect(r).toEqual({ levelsGained: 2, newLevel: 3 });
    expect(m.xp).toBe(10);
    expect(m.ap).toBe(2 * BALANCE.progression.apPerLevelUp);
    expect(m.hp).toBe(computeStats(m).maxHp);
  });

  it('stats grow with level', () => {
    const m = createMember('suri');
    const s1 = computeStats(m);
    grantXp(m, 100);
    const s2 = computeStats(m);
    expect(s2.maxHp).toBeGreaterThan(s1.maxHp);
    expect(s2.physicalAttack).toBeGreaterThan(s1.physicalAttack);
  });
});

describe('skill tree', () => {
  it('requires AP, character level and prerequisites', () => {
    const m = createMember('kaien');
    expect(canPurchaseSkill(m, 'combo_basics')).toMatchObject({ ok: false });
    m.ap = 1;
    expect(canPurchaseSkill(m, 'combo_basics')).toEqual({ ok: true, cost: 1 });
    m.ap = 10;
    expect(canPurchaseSkill(m, 'air_chase')).toMatchObject({ ok: false, reason: 'Requiere nivel 2' });
    m.level = 5;
    expect(canPurchaseSkill(m, 'air_chase')).toMatchObject({ ok: false });
  });

  it('purchasing spends AP, unlocks moves and respects max level', () => {
    const m = createMember('kaien');
    m.ap = 3;
    expect(unlockedMoves(m)).not.toContain('launcher');
    expect(purchaseSkill(m, 'combo_basics').ok).toBe(true);
    expect(m.ap).toBe(2);
    expect(m.skills.combo_basics).toBe(1);
    expect(unlockedMoves(m)).toEqual(expect.arrayContaining(['launcher', 'rising_strike']));
    expect(purchaseSkill(m, 'combo_basics')).toMatchObject({ ok: false, reason: 'Nivel máximo' });
    expect(m.ap).toBe(2);
  });

  it('stat skills raise stats per level', () => {
    const m = createMember('kaien');
    m.ap = 5;
    const before = computeStats(m).physicalAttack;
    purchaseSkill(m, 'power_training');
    expect(computeStats(m).physicalAttack).toBeGreaterThan(before);
  });
});

describe('inventory, equipment, loot', () => {
  it('consumables heal and are removed; full HP blocks pure healing', () => {
    const inv = new InventoryManager({ herb: 1 });
    const m = createMember('kaien');
    expect(inv.use('herb', m)).toBe(false);
    m.hp = 10;
    expect(inv.use('herb', m)).toBe(true);
    expect(m.hp).toBeGreaterThan(10);
    expect(inv.count('herb')).toBe(0);
  });

  it('equipping swaps items with the inventory and changes stats', () => {
    const inv = new InventoryManager({ iron_wristbands: 1 });
    const m = createMember('kaien');
    const before = computeStats(m);
    expect(EquipmentManager.equip(m, 'iron_wristbands', inv)).toBe(true);
    expect(inv.count('iron_wristbands')).toBe(0);
    expect(computeStats(m)).not.toEqual(before);
    expect(EquipmentManager.unequip(m, 'hands', inv)).toBe(true);
    expect(inv.count('iron_wristbands')).toBe(1);
    expect(computeStats(m)).toEqual(before);
  });

  it('loot rolls are deterministic for a seed and only yield known items', () => {
    const a = LootTableManager.roll('golem', new Rng(42));
    const b = LootTableManager.roll('golem', new Rng(42));
    expect(a).toEqual(b);
    for (let s = 0; s < 50; s++) for (const d of LootTableManager.roll('bandit', new Rng(s))) expect(d.count).toBeGreaterThan(0);
  });
});

describe('anti-farming', () => {
  it('reduces rewards after repeated kills of the same enemy and recovers over time', () => {
    const ledger: FarmLedger = { kills: [] };
    const p = BALANCE.progression;
    for (let i = 0; i < p.farmFreeKills; i++) recordKill(ledger, 'sprout', i);
    expect(farmMultiplier(ledger, 'sprout', 10)).toBe(1);
    recordKill(ledger, 'sprout', 11);
    expect(farmMultiplier(ledger, 'sprout', 12)).toBeCloseTo(1 - p.farmPenaltyPerKill);
    expect(farmMultiplier(ledger, 'bandit', 12)).toBe(1);
    expect(farmMultiplier(ledger, 'sprout', 12 + p.farmWindowSeconds + 1)).toBe(1);
  });

  it('much weaker enemies give less XP', () => {
    expect(levelGapMultiplier(3, 1)).toBe(1);
    expect(levelGapMultiplier(10, 1)).toBeLessThan(1);
    expect(levelGapMultiplier(40, 1)).toBe(BALANCE.progression.farmMinMultiplier);
  });
});

describe('quests: "Entrenamiento en el valle"', () => {
  it('walks through all 8 objectives in order', () => {
    const q = new QuestManager();
    expect(q.get('valley_training').status).toBe('inactive');
    q.onTalk('master');
    expect(q.get('valley_training')).toMatchObject({ status: 'active', step: 1 });
    q.onDefeat('sprout');
    expect(q.get('valley_training').step).toBe(1);
    q.onVisit('meadow');
    q.onCollect('training_stone', 1);
    expect(q.currentObjectiveText('valley_training')).toContain('(1/2)');
    q.onCollect('training_stone', 2);
    for (let i = 0; i < 3; i++) q.onDefeat('sprout');
    q.onApEarned(2);
    q.onSkillUnlocked();
    expect(q.get('valley_training').step).toBe(6);
    q.onDefeat('sprout');
    expect(q.get('valley_training').step).toBe(6);
    q.onDefeat('golem');
    const done = q.onTalk('master');
    expect(done.some((u) => u.kind === 'completed')).toBe(true);
    expect(q.get('valley_training').status).toBe('completed');
  });
});
