import { useEffect } from 'react';
import { Platform } from 'react-native';
import type { Game } from '../../game/Game';
import { type BindAction, SECONDARY_BINDINGS } from '../../game/settings';

/**
 * Web keyboard -> RawInput. Uses KeyboardEvent.code so bindings are layout
 * independent and remappable from settings. Each physical key is its own
 * holder, so several keys can be held and released independently. OS key
 * repeat is ignored. Native platforms rely on touch controls / gamepads.
 */
export function useKeyboard(game: Game, onRebind?: (code: string) => boolean): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const lookup = (code: string): BindAction | null => {
      const b = game.settings.bindings;
      for (const k of Object.keys(b) as BindAction[]) if (b[k] === code) return k;
      return SECONDARY_BINDINGS[code] ?? null;
    };
    const typing = (e: KeyboardEvent): boolean => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };
    const down = (e: KeyboardEvent): void => {
      if (typing(e)) return;
      if (!e.repeat && onRebind && onRebind(e.code)) {
        e.preventDefault();
        return;
      }
      const a = lookup(e.code);
      if (!a) return;
      e.preventDefault();
      if (e.repeat) return;
      game.input.setKey(a, true, e.code);
    };
    const up = (e: KeyboardEvent): void => {
      const a = lookup(e.code);
      if (!a) return;
      e.preventDefault();
      game.input.setKey(a, false, e.code);
    };
    const releaseAll = (): void => game.input.releaseAll();
    const visibility = (): void => {
      if (document.visibilityState === 'hidden') releaseAll();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', releaseAll);
    window.addEventListener('pagehide', releaseAll);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', releaseAll);
      window.removeEventListener('pagehide', releaseAll);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [game, onRebind]);
}
