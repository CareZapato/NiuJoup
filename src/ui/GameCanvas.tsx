import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { PixelRatio, Platform, StyleSheet, View } from 'react-native';
import * as THREE from 'three';
import { BALANCE } from '../game/content/balance';
import type { Game } from '../game/Game';
import { GameRenderer } from '../game/rendering/shared/GameRenderer';
import { AdaptiveDpr, targetDpr } from '../game/rendering/shared/resolution';

const MOBILE = Platform.OS !== 'web';

function deviceDpr(): number {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.devicePixelRatio || 1;
  return PixelRatio.get();
}

function GameView({ game }: { game: Game }) {
  const { scene, camera, size, setDpr, gl } = useThree();
  const renderer = useRef<GameRenderer | null>(null);
  const [adaptive] = useState(() => new AdaptiveDpr());
  const [buffer] = useState(() => new THREE.Vector2());
  const low = MOBILE || game.settings.quality === 'low';

  useEffect(() => {
    const r = new GameRenderer(scene, camera as THREE.PerspectiveCamera, game, { mobile: MOBILE });
    renderer.current = r;
    (globalThis as { __legends?: unknown }).__legends = game;
    return () => {
      r.dispose();
      renderer.current = null;
    };
  }, [scene, camera, game]);

  useEffect(() => {
    setDpr(targetDpr(deviceDpr(), size.height, low, adaptive.factor));
  }, [size.height, low, setDpr, adaptive]);

  useFrame((_, dt) => {
    const alpha = game.frame(dt);
    renderer.current?.sync(alpha, dt);
    if (adaptive.sample(dt)) setDpr(targetDpr(deviceDpr(), size.height, low, adaptive.factor));
    gl.getDrawingBufferSize(buffer);
    game.setRenderStats({
      screenW: Math.round(size.width),
      screenH: Math.round(size.height),
      internalW: buffer.x,
      internalH: buffer.y,
      dpr: gl.getPixelRatio(),
      refScale: Math.min(size.width / BALANCE.render.referenceWidth, size.height / BALANCE.render.referenceHeight),
    });
  });
  return null;
}

/**
 * Single Three.js scene hosted by React Three Fiber: WebGL canvas on web,
 * expo-gl GLView on Android/iOS (resolved by Metro via the package's
 * react-native entry). The simulation is the same object on every platform.
 * Internal resolution is adaptive (see rendering/shared/resolution.ts).
 */
export function GameCanvas({ game }: { game: Game }) {
  return (
    <View style={StyleSheet.absoluteFill}>
      <Canvas
        style={{ flex: 1 }}
        camera={{ fov: 40, near: 0.1, far: 220, position: [0, 15, 10] }}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        dpr={1}
        frameloop="always"
      >
        <GameView game={game} />
      </Canvas>
    </View>
  );
}
