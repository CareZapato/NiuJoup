import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import type * as THREE from 'three';
import type { Game } from '../game/Game';
import { GameRenderer } from '../game/rendering/shared/GameRenderer';

function GameView({ game }: { game: Game }) {
  const { scene, camera } = useThree();
  const renderer = useRef<GameRenderer | null>(null);

  useEffect(() => {
    const r = new GameRenderer(scene, camera as THREE.PerspectiveCamera, game, { mobile: Platform.OS !== 'web' });
    renderer.current = r;
    (globalThis as { __legends?: unknown }).__legends = game;
    return () => {
      r.dispose();
      renderer.current = null;
    };
  }, [scene, camera, game]);

  useFrame((_, dt) => {
    const alpha = game.frame(dt);
    renderer.current?.sync(alpha, dt);
  });
  return null;
}

/**
 * Single Three.js scene hosted by React Three Fiber: WebGL canvas on web,
 * expo-gl GLView on Android/iOS (resolved by Metro via the package's
 * react-native entry). The simulation is the same object on every platform.
 */
export function GameCanvas({ game }: { game: Game }) {
  return (
    <View style={StyleSheet.absoluteFill}>
      <Canvas
        style={{ flex: 1 }}
        camera={{ fov: 40, near: 0.1, far: 220, position: [0, 15, 10] }}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        dpr={Platform.OS === 'web' ? [1, 1.5] : 1}
        frameloop="always"
      >
        <GameView game={game} />
      </Canvas>
    </View>
  );
}
