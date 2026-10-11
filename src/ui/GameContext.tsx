import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Game, UiSnapshot } from '../game/Game';
import type { Settings } from '../game/settings';
import type { SaveManager } from '../game/systems/persistence/SaveManager';

export interface GameServices {
  game: Game;
  saves: SaveManager;
  updateSettings: (patch: Partial<Settings>) => void;
  hasSave: boolean;
  refreshHasSave: () => void;
  touchUi: boolean;
}

export const GameContext = createContext<GameServices | null>(null);

export function useServices(): GameServices {
  const s = useContext(GameContext);
  if (!s) throw new Error('GameContext missing');
  return s;
}

/** Subscribes to the throttled (10 Hz) UI snapshot; React never re-renders at 60 Hz. */
export function useGameUi(): UiSnapshot {
  const { game } = useServices();
  return useSyncExternalStore(game.subscribe, game.getUi, game.getUi);
}
