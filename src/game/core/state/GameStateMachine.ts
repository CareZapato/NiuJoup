export type GameState =
  | 'BOOT'
  | 'MAIN_MENU'
  | 'WORLD_EXPLORATION'
  | 'ENCOUNTER_TRANSITION'
  | 'ACTIVE_COMBAT'
  | 'COMBAT_VICTORY'
  | 'COMBAT_DEFEAT'
  | 'RETURN_TO_WORLD'
  | 'PAUSED';

const ALLOWED: Record<GameState, readonly GameState[]> = {
  BOOT: ['MAIN_MENU'],
  MAIN_MENU: ['WORLD_EXPLORATION'],
  WORLD_EXPLORATION: ['ENCOUNTER_TRANSITION', 'PAUSED', 'MAIN_MENU'],
  ENCOUNTER_TRANSITION: ['ACTIVE_COMBAT', 'PAUSED'],
  ACTIVE_COMBAT: ['COMBAT_VICTORY', 'COMBAT_DEFEAT', 'PAUSED'],
  COMBAT_VICTORY: ['RETURN_TO_WORLD', 'PAUSED'],
  COMBAT_DEFEAT: ['RETURN_TO_WORLD', 'PAUSED'],
  RETURN_TO_WORLD: ['WORLD_EXPLORATION', 'PAUSED'],
  PAUSED: ['WORLD_EXPLORATION', 'ENCOUNTER_TRANSITION', 'ACTIVE_COMBAT', 'COMBAT_VICTORY', 'COMBAT_DEFEAT', 'RETURN_TO_WORLD', 'MAIN_MENU'],
};

export class InvalidTransitionError extends Error {}

export class GameStateMachine {
  private _state: GameState = 'BOOT';
  private _previous: GameState = 'BOOT';
  /** Ticks spent in the current state. */
  stateTicks = 0;
  private listeners: ((to: GameState, from: GameState) => void)[] = [];

  get state(): GameState {
    return this._state;
  }
  get previous(): GameState {
    return this._previous;
  }

  canTransition(to: GameState): boolean {
    if (to === 'PAUSED') return ALLOWED[this._state].includes('PAUSED');
    if (this._state === 'PAUSED') return to === this._previous || to === 'MAIN_MENU';
    return ALLOWED[this._state].includes(to);
  }

  transition(to: GameState): void {
    if (!this.canTransition(to)) throw new InvalidTransitionError(`${this._state} -> ${to}`);
    const from = this._state;
    this._previous = from;
    this._state = to;
    this.stateTicks = 0;
    for (const l of this.listeners) l(to, from);
  }

  /** Resume from PAUSED back to whatever state was active before. */
  resume(): void {
    if (this._state !== 'PAUSED') return;
    const back = this._previous;
    this._state = back;
    this._previous = 'PAUSED';
    for (const l of this.listeners) l(back, 'PAUSED');
  }

  onChange(l: (to: GameState, from: GameState) => void): () => void {
    this.listeners.push(l);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== l);
    };
  }

  tick(): void {
    if (this._state !== 'PAUSED') this.stateTicks++;
  }
}
