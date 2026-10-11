import type { Team } from './content/types';

export interface GameEvents {
  hit: { attackerId: number; defenderId: number; x: number; y: number; z: number; damage: number; crit: boolean; blocked: boolean; heavy: boolean; moveId: string };
  parry: { attackerId: number; defenderId: number; x: number; y: number; z: number };
  defeated: { entityId: number; killerId: number };
  projectileSpawned: { id: number; visual: string };
  projectileExploded: { x: number; y: number; z: number; visual: string };
  comboFinish: { attackerId: number; count: number };
  coordinated: { attackerId: number; partnerId: number };
  teleport: { entityId: number; fromX: number; fromY: number; fromZ: number };
  dash: { entityId: number };
  meteoStart: { attackerId: number; victimId: number; partnerId: number; team: Team };
  meteoHit: { x: number; y: number; z: number; final: boolean };
  meteoEnd: { attackerId: number; victimId: number; damage: number; defended: boolean };
  dominance: { team: Team | null };
  encounterStart: { groupId: string };
  encounterEnd: { victory: boolean };
  levelUp: { characterId: string; level: number };
  item: { itemId: string; count: number };
  toast: { text: string; tone?: 'info' | 'good' | 'warn' | 'quest' };
  dialogue: { speaker: string; lines: string[] };
  obstacleBroken: { id: string; x: number; z: number };
  saveRequested: { reason: string; immediate: boolean };
  saved: { ok: boolean; reason: string; error?: string };
}
