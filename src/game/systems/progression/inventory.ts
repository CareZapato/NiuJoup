import { ITEMS, LOOT_TABLES } from '../../content/items';
import type { Rng } from '../../core/math';
import type { EquipSlot } from '../../content/types';
import { computeStats, type PartyMember } from './progression';

export class InventoryManager {
  constructor(public items: Record<string, number> = {}) {}

  add(itemId: string, count = 1): void {
    if (!ITEMS[itemId]) throw new Error(`Unknown item ${itemId}`);
    this.items[itemId] = (this.items[itemId] ?? 0) + count;
  }

  remove(itemId: string, count = 1): boolean {
    const have = this.items[itemId] ?? 0;
    if (have < count) return false;
    if (have === count) delete this.items[itemId];
    else this.items[itemId] = have - count;
    return true;
  }

  count(itemId: string): number {
    return this.items[itemId] ?? 0;
  }

  /** Applies a consumable to a party member. Returns false if not usable. */
  use(itemId: string, member: PartyMember): boolean {
    const def = ITEMS[itemId];
    if (!def?.heal || this.count(itemId) <= 0) return false;
    const s = computeStats(member);
    if ((def.heal.hp ?? 0) > 0 && member.hp >= s.maxHp && (def.heal.ki ?? 0) <= 0) return false;
    member.hp = Math.min(s.maxHp, member.hp + (def.heal.hp ?? 0));
    member.ki = Math.min(s.maxKi, member.ki + (def.heal.ki ?? 0));
    this.remove(itemId);
    return true;
  }
}

export class EquipmentManager {
  static equip(member: PartyMember, itemId: string, inv: InventoryManager): boolean {
    const eq = ITEMS[itemId]?.equip;
    if (!eq || inv.count(itemId) <= 0) return false;
    const prev = member.equipment[eq.slot];
    inv.remove(itemId);
    if (prev) inv.add(prev);
    member.equipment[eq.slot] = itemId;
    EquipmentManager.clampVitals(member);
    return true;
  }

  static unequip(member: PartyMember, slot: EquipSlot, inv: InventoryManager): boolean {
    const prev = member.equipment[slot];
    if (!prev) return false;
    member.equipment[slot] = null;
    inv.add(prev);
    EquipmentManager.clampVitals(member);
    return true;
  }

  private static clampVitals(m: PartyMember): void {
    const s = computeStats(m);
    m.hp = Math.min(m.hp, s.maxHp);
    m.ki = Math.min(m.ki, s.maxKi);
  }
}

export const LootTableManager = {
  roll(tableId: string, rng: Rng): { itemId: string; count: number }[] {
    const t = LOOT_TABLES[tableId];
    if (!t) return [];
    const out: { itemId: string; count: number }[] = [];
    const total = t.emptyWeight + t.entries.reduce((a, e) => a + e.weight, 0);
    for (let r = 0; r < t.rolls; r++) {
      let pick = rng.next() * total;
      if (pick < t.emptyWeight) continue;
      pick -= t.emptyWeight;
      for (const e of t.entries) {
        if (pick < e.weight) {
          out.push({ itemId: e.itemId, count: rng.int(e.min, e.max) });
          break;
        }
        pick -= e.weight;
      }
    }
    return out;
  },
};
