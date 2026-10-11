import { PressStart2P_400Regular } from '@expo-google-fonts/press-start-2p';
import { useFonts, VT323_400Regular } from '@expo-google-fonts/vt323';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { Game } from '../game/Game';
import { mergeSettings, type Settings } from '../game/settings';
import { SAVE_KEYS, SaveManager } from '../game/systems/persistence/SaveManager';
import { BALANCE } from '../game/content/balance';
import { createStorage } from '../storage/createStorage';
import type { StorageAdapter } from '../storage/StorageAdapter';
import { useKeyboard } from '../ui/controls/useKeyboard';
import { TouchControls } from '../ui/controls/TouchControls';
import { DebugOverlay } from '../ui/DebugOverlay';
import { GameCanvas } from '../ui/GameCanvas';
import { GameContext, type GameServices, useGameUi } from '../ui/GameContext';
import { Hud } from '../ui/hud/Hud';
import { MainMenu } from '../ui/screens/MainMenu';
import { PauseMenu } from '../ui/screens/PauseMenu';

function detectTouch(): boolean {
  if (Platform.OS !== 'web') return true;
  if (typeof window === 'undefined') return false;
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

function bootstrap(): { game: Game; storage: StorageAdapter; saves: SaveManager } {
  const storage = createStorage();
  const game = new Game();
  const saves = new SaveManager(
    storage,
    () => {
      game.markSaving();
      return game.toSave();
    },
    (ok, reason, error) => game.events.emit('saved', { ok, reason, error }),
    BALANCE.save.debounceMs,
  );
  game.saveManager = saves;
  return { game, storage, saves };
}

function Screens() {
  const ui = useGameUi();
  return (
    <>
      <Hud />
      {ui.state === 'MAIN_MENU' && <MainMenu />}
      <PauseMenu />
    </>
  );
}

export default function AppRoot() {
  const [fontsLoaded] = useFonts({ VT323_400Regular, PressStart2P_400Regular });
  const [{ game, storage, saves }] = useState(bootstrap);

  const [ready, setReady] = useState(false);
  const [hasSave, setHasSave] = useState(false);
  const [settingsVersion, setSettingsVersion] = useState(0);

  const refreshHasSave = useCallback(() => {
    void saves.hasSave().then(setHasSave);
  }, [saves]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const raw = await storage.getItem(SAVE_KEYS.settings);
        game.applySettings(mergeSettings(raw ? JSON.parse(raw) : null));
      } catch {
        game.applySettings(mergeSettings(null));
      }
      const has = await saves.hasSave();
      if (!alive) return;
      setHasSave(has);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [storage, game, saves]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') {
        game.suspend();
        void saves.flush();
      }
    });
    return () => sub.remove();
  }, [game, saves]);

  useEffect(
    () =>
      game.fsm.onChange((to) => {
        if (to === 'MAIN_MENU') refreshHasSave();
      }),
    [game, refreshHasSave],
  );

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      const next = { ...game.settings, ...patch, bindings: { ...game.settings.bindings, ...(patch.bindings ?? {}) } };
      game.applySettings(next);
      void storage.setItem(SAVE_KEYS.settings, JSON.stringify(next));
      setSettingsVersion((v) => v + 1);
      game.notify();
    },
    [game, storage],
  );

  useKeyboard(game);

  const s = game.settings;
  const touchUi = s.touchControls === 'on' || (s.touchControls === 'auto' && detectTouch());
  const services = useMemo<GameServices>(
    () => ({ game, saves, updateSettings, hasSave, refreshHasSave, touchUi }),
    // settingsVersion forces consumers to see updated settings-derived values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [game, saves, updateSettings, hasSave, refreshHasSave, touchUi, settingsVersion],
  );

  if (!fontsLoaded || !ready) {
    return (
      <View style={styles.boot}>
        <Text style={{ color: '#f2c84a', fontSize: 18 }}>LEGENDS RPG…</Text>
      </View>
    );
  }

  return (
    <GameContext.Provider value={services}>
      <View style={styles.root}>
        <StatusBar hidden />
        <GameCanvas game={game} />
        <Screens />
        {touchUi && <TouchControls />}
        <DebugOverlay />
      </View>
    </GameContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  boot: { flex: 1, backgroundColor: '#05060f', alignItems: 'center', justifyContent: 'center' },
});
