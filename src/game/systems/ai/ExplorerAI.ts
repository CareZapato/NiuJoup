import type { Entity, ExplorerState } from '../../components';
import { BALANCE } from '../../content/balance';
import { distXZ, type Rng } from '../../core/math';
import type { TileMap } from '../../world/TileMap';
import { moveGroundBody } from '../movement/ExplorationMovement';

function setState(e: Entity, s: ExplorerState): void {
  e.explorer!.state = s;
  e.explorer!.stateTicks = 0;
}

/**
 * World-map enemy behaviour: idle/patrol around home, detect the leader by
 * distance + line of sight, chase, and report contact so the game can start a
 * seamless encounter. Enemies are physical entities; no invisible random battles.
 */
export class ExplorerAI {
  update(enemies: readonly Entity[], leader: Entity, map: TileMap, rng: Rng, onContact: (enemy: Entity) => void): void {
    const X = BALANCE.exploration;
    for (const e of enemies) {
      const ai = e.explorer!;
      if (ai.state === 'IN_COMBAT' || ai.state === 'DEFEATED') continue;
      ai.stateTicks++;
      if (ai.alertTicks < 0) ai.alertTicks++;
      const p = e.transform.pos;
      const d = distXZ(p, leader.transform.pos);
      const sees =
        ai.alertTicks >= 0 &&
        d < ai.detectRadius &&
        Math.abs(leader.transform.pos.y - p.y) < 1.6 &&
        map.lineOfSight(p.x, p.z, leader.transform.pos.x, leader.transform.pos.z, p.y + 1.2);

      switch (ai.state) {
        case 'IDLE':
          moveGroundBody(e, map, 0, 0, 0);
          if (sees) setState(e, 'ALERT');
          else if (ai.stateTicks > 60 + rng.int(0, 90)) {
            const a = rng.range(0, Math.PI * 2);
            const r = rng.range(0.5, ai.patrolRadius);
            ai.wanderTarget.x = ai.home.x + Math.cos(a) * r;
            ai.wanderTarget.z = ai.home.z + Math.sin(a) * r;
            setState(e, 'PATROL');
          }
          break;
        case 'PATROL': {
          if (sees) {
            setState(e, 'ALERT');
            break;
          }
          const dx = ai.wanderTarget.x - p.x;
          const dz = ai.wanderTarget.z - p.z;
          const l = Math.hypot(dx, dz);
          if (l < 0.3 || ai.stateTicks > 240) setState(e, 'IDLE');
          else moveGroundBody(e, map, dx / l, dz / l, X.walkSpeed * 0.45);
          break;
        }
        case 'ALERT':
          // Brief "!" pause before charging gives the player a readable tell.
          moveGroundBody(e, map, 0, 0, 0);
          e.transform.yaw = Math.atan2(leader.transform.pos.x - p.x, leader.transform.pos.z - p.z);
          if (ai.stateTicks > 24) setState(e, sees || d < ai.detectRadius ? 'CHASE' : 'IDLE');
          break;
        case 'CHASE': {
          const dx = leader.transform.pos.x - p.x;
          const dz = leader.transform.pos.z - p.z;
          const l = Math.hypot(dx, dz) || 1;
          moveGroundBody(e, map, dx / l, dz / l, X.walkSpeed * 1.15);
          if (d < X.encounterContactRadius) onContact(e);
          else if (d > X.loseInterestRadius || distXZ(p, ai.home) > X.loseInterestRadius + 4) setState(e, 'RETURN');
          break;
        }
        case 'RETURN': {
          const dx = ai.home.x - p.x;
          const dz = ai.home.z - p.z;
          const l = Math.hypot(dx, dz);
          if (l < 0.4) setState(e, 'IDLE');
          else moveGroundBody(e, map, dx / l, dz / l, X.walkSpeed * 0.8);
          if (sees && d < ai.detectRadius * 0.7 && ai.stateTicks > 60) setState(e, 'ALERT');
          break;
        }
      }
    }
  }
}
