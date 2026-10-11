import { QUESTS } from '../../content/items';
import type { QuestDef } from '../../content/types';

export interface QuestProgress {
  status: 'inactive' | 'active' | 'completed';
  step: number;
  progress: number;
}

export interface QuestUpdate {
  questId: string;
  kind: 'started' | 'step' | 'completed';
  text: string;
}

/**
 * Event-driven quest tracker. Game systems report facts (talked, visited,
 * collected...) and the manager advances objectives in order.
 */
export class QuestManager {
  constructor(public state: Record<string, QuestProgress> = {}) {
    for (const id of Object.keys(QUESTS)) this.state[id] ??= { status: 'inactive', step: 0, progress: 0 };
  }

  get(id: string): QuestProgress {
    return this.state[id];
  }

  activeQuests(): { def: QuestDef; progress: QuestProgress }[] {
    return Object.values(QUESTS)
      .filter((q) => this.state[q.id].status === 'active')
      .map((q) => ({ def: q, progress: this.state[q.id] }));
  }

  currentObjectiveText(id: string): string | null {
    const q = QUESTS[id];
    const p = this.state[id];
    if (!q || p.status !== 'active') return null;
    const o = q.objectives[p.step];
    if (!o) return null;
    if (o.kind === 'collect' || o.kind === 'defeat') return `${o.text} (${p.progress}/${o.count})`;
    if (o.kind === 'earnAp') return `${o.text} (${p.progress}/${o.amount})`;
    return o.text;
  }

  onTalk(npcId: string): QuestUpdate[] {
    const updates: QuestUpdate[] = [];
    for (const q of Object.values(QUESTS)) {
      const p = this.state[q.id];
      if (p.status === 'inactive' && q.giverNpcId === npcId) {
        p.status = 'active';
        p.step = 0;
        p.progress = 0;
        updates.push({ questId: q.id, kind: 'started', text: q.name });
      }
    }
    this.advance((o) => o.kind === 'talk' && o.npcId === npcId, 1, updates);
    return updates;
  }

  onVisit(areaId: string): QuestUpdate[] {
    return this.advance((o) => o.kind === 'visit' && o.areaId === areaId, 1);
  }

  /** `total` is the inventory count after pickup, so pre-collected items count. */
  onCollect(itemId: string, total: number): QuestUpdate[] {
    const updates: QuestUpdate[] = [];
    for (const q of Object.values(QUESTS)) {
      const p = this.state[q.id];
      const o = q.objectives[p.step];
      if (p.status !== 'active' || !o || o.kind !== 'collect' || o.itemId !== itemId) continue;
      p.progress = Math.min(o.count, total);
      if (p.progress >= o.count) this.completeStep(q, p, updates);
    }
    return updates;
  }

  onDefeat(enemyId: string): QuestUpdate[] {
    return this.advance(
      (o) => (o.kind === 'defeat' && (o.enemyId === 'any' || o.enemyId === enemyId)) || (o.kind === 'defeatBoss' && o.enemyId === enemyId),
      1,
    );
  }

  onApEarned(amount: number): QuestUpdate[] {
    return this.advance((o) => o.kind === 'earnAp', amount);
  }

  onSkillUnlocked(): QuestUpdate[] {
    return this.advance((o) => o.kind === 'unlockSkill', 1);
  }

  /** Re-checks collect objectives entered with items already in the bag. */
  syncInventory(count: (itemId: string) => number): QuestUpdate[] {
    const updates: QuestUpdate[] = [];
    for (const q of Object.values(QUESTS)) {
      const p = this.state[q.id];
      const o = q.objectives[p.step];
      if (p.status === 'active' && o?.kind === 'collect') updates.push(...this.onCollect(o.itemId, count(o.itemId)));
    }
    return updates;
  }

  private advance(match: (o: QuestDef['objectives'][number]) => boolean, amount: number, updates: QuestUpdate[] = []): QuestUpdate[] {
    for (const q of Object.values(QUESTS)) {
      const p = this.state[q.id];
      if (p.status !== 'active') continue;
      const o = q.objectives[p.step];
      if (!o || !match(o)) continue;
      const needed = o.kind === 'defeat' ? o.count : o.kind === 'earnAp' ? o.amount : o.kind === 'collect' ? o.count : 1;
      p.progress += amount;
      if (p.progress >= needed) this.completeStep(q, p, updates);
    }
    return updates;
  }

  private completeStep(q: QuestDef, p: QuestProgress, updates: QuestUpdate[]): void {
    p.step++;
    p.progress = 0;
    if (p.step >= q.objectives.length) {
      p.status = 'completed';
      updates.push({ questId: q.id, kind: 'completed', text: q.name });
    } else {
      updates.push({ questId: q.id, kind: 'step', text: q.objectives[p.step].text });
    }
  }
}
