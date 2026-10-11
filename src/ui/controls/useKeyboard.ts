import { useEffect } from 'react';
import { Platform } from 'react-native';
import type { Game } from '../../game/Game';
import { type BindAction, SECONDARY_BINDINGS } from '../../game/settings';

/**
 * Web keyboard -> RawInput. Uses KeyboardEvent.code so bindings are layout
 * independent and remappable from settings. Native platforms rely on touch
 * controls / gamepads instead.
 */
export function useKeyboard(game: Game, onRebind?: (code: string) => boolean): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const lookup = (code: string): BindAction | null => {
      const b = game.settings.bindings;
      for (const k of Object.keys(b) as BindAction[]) if (b[k] === code) return k;
      return SECONDARY_BINDINGS[code] ?? null;
    };
    const down = (e: KeyboardEvent): void => {
      if (onRebind && onRebind(e.code)) {
        e.preventDefault();
        return;
      }
      const a = lookup(e.code);
      if (!a) return;
      e.preventDefault();
      game.input.setKey(a, true);
    };
    const up = (e: KeyboardEvent): void => {
      const a = lookup(e.code);
      if (!a) return;
      e.preventDefault();
      game.input.setKey(a, false);
    };
    const blur = (): void => game.input.releaseAll();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [game, onRebind]);
}
