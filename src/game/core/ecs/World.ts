import type { ComponentKey, Entity } from '../../components';

/**
 * Lightweight ECS container. Entities are plain objects with optional typed
 * components; systems ask for cached archetype queries. Queries are rebuilt
 * lazily only after structural changes, so per-tick iteration allocates nothing.
 */
export class World {
  private nextId = 1;
  readonly entities: Entity[] = [];
  private byId = new Map<number, Entity>();
  private byStable = new Map<string, Entity>();
  private queries = new Map<string, { keys: ComponentKey[]; list: Entity[] }>();
  private dirty = true;

  create(e: Omit<Entity, 'id'>): Entity {
    const ent = e as Entity;
    ent.id = this.nextId++;
    if (this.byStable.has(ent.stableId)) throw new Error(`Duplicate stable id ${ent.stableId}`);
    this.entities.push(ent);
    this.byId.set(ent.id, ent);
    this.byStable.set(ent.stableId, ent);
    this.dirty = true;
    return ent;
  }

  remove(id: number): void {
    const e = this.byId.get(id);
    if (!e) return;
    this.byId.delete(id);
    this.byStable.delete(e.stableId);
    const i = this.entities.indexOf(e);
    if (i >= 0) this.entities.splice(i, 1);
    this.dirty = true;
  }

  /** Call after adding/removing a component on an existing entity. */
  markDirty(): void {
    this.dirty = true;
  }

  get(id: number): Entity | undefined {
    return this.byId.get(id);
  }

  getStable(stableId: string): Entity | undefined {
    return this.byStable.get(stableId);
  }

  query(...keys: ComponentKey[]): readonly Entity[] {
    const sig = keys.join('|');
    if (this.dirty) this.rebuildAll();
    let q = this.queries.get(sig);
    if (!q) {
      q = { keys, list: [] };
      this.queries.set(sig, q);
      this.rebuild(q);
    }
    return q.list;
  }

  private rebuildAll(): void {
    for (const q of this.queries.values()) this.rebuild(q);
    this.dirty = false;
  }

  /** Replaces (never mutates) the cached array so systems mid-iteration keep a stable snapshot. */
  private rebuild(q: { keys: ComponentKey[]; list: Entity[] }): void {
    q.list = [];
    for (const e of this.entities) {
      let ok = true;
      for (const k of q.keys) {
        if (e[k] === undefined) {
          ok = false;
          break;
        }
      }
      if (ok) q.list.push(e);
    }
  }

  clear(): void {
    this.entities.length = 0;
    this.byId.clear();
    this.byStable.clear();
    this.queries.clear();
    this.nextId = 1;
    this.dirty = true;
  }
}
