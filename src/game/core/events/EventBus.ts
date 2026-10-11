type Handler<T> = (payload: T) => void;

/**
 * Synchronous typed event bus. Systems publish domain events (hits, defeats,
 * pickups...) and other systems/quests/UI react without direct coupling.
 */
export class EventBus<Events extends { [K in keyof Events]: unknown }> {
  private handlers: { [K in keyof Events]?: Handler<Events[K]>[] } = {};

  on<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    const list = (this.handlers[type] ??= []);
    list.push(handler);
    return () => {
      const i = list.indexOf(handler);
      if (i >= 0) list.splice(i, 1);
    };
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const list = this.handlers[type];
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i](payload);
  }

  clear(): void {
    this.handlers = {};
  }
}
