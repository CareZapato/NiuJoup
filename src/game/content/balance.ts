/**
 * Every tunable gameplay number lives here so designers can rebalance without
 * touching systems. Power Balance values are an original proposal, not a
 * reproduction of any commercial game.
 */
export const BALANCE = {
  powerBalance: {
    min: -100,
    max: 100,
    dominanceThreshold: 60,
    dominanceWindowTicks: 60 * 8,
    lightHit: 2,
    heavyHit: 4,
    kiHit: 3,
    comboFinisherBonus: 6,
    parry: 5,
    coordinatedAttack: 8,
    knockdown: 3,
    special: 6,
    /** After a Meteo Attack the bar is multiplied by this (partial reset). */
    resetFactorAfterMeteo: 0.2,
    passiveDecayPerSecond: 0.6,
  },
  combat: {
    arenaRadius: 9,
    arenaMaxHeight: 9,
    hoverHeight: 1.1,
    flySpeed: 6.5,
    groundSpeed: 5.5,
    verticalSpeed: 5,
    dashSpeed: 17,
    dashTicks: 12,
    dashKiCost: 4,
    teleportKiCost: 12,
    teleportDistance: 4,
    guardDamageMultiplier: 0.2,
    guardKiDrainPerHit: 4,
    parryWindowTicks: 7,
    parryStunTicks: 40,
    kiChargePerSecond: 28,
    kiRegenPerSecond: 2,
    minComboScaling: 0.35,
    critMultiplier: 1.5,
    knockbackFriction: 4,
    recoveryTicks: 18,
    invulnAfterRecovery: 20,
    launchGravity: 14,
    comboResetTicks: 50,
    coordinatedWindowTicks: 90,
    meteoTicks: 110,
    meteoDamageMultiplier: 3.2,
    meteoDefendReduction: 0.5,
  },
  exploration: {
    walkSpeed: 4.2,
    runSpeed: 7,
    jumpVelocity: 5.4,
    gravity: 18,
    stepUp: 0.55,
    encounterContactRadius: 1.25,
    loseInterestRadius: 14,
    companionFollowGap: 1.3,
  },
  transition: {
    encounterTicks: 54,
    playerControlAfterTicks: 24,
    victoryTicks: 100,
    defeatTicks: 120,
    returnTicks: 60,
  },
  progression: {
    xpCurveBase: 100,
    xpCurveExponent: 1.5,
    maxLevel: 50,
    inactiveAllyXpShare: 0.5,
    /** Anti-farming: kills of the same enemy type inside this window reduce rewards. */
    farmWindowSeconds: 300,
    farmFreeKills: 4,
    farmPenaltyPerKill: 0.15,
    farmMinMultiplier: 0.25,
    /** Enemies this many levels below the party grant reduced XP. */
    levelGapSoftCap: 5,
    levelGapPenaltyPerLevel: 0.1,
    apPerLevelUp: 1,
  },
  save: {
    debounceMs: 800,
    schemaVersion: 2,
  },
  effects: {
    maxParticlesMobile: 120,
    maxParticlesDesktop: 300,
  },
} as const;

export function xpToNextLevel(level: number): number {
  return Math.floor(BALANCE.progression.xpCurveBase * Math.pow(level, BALANCE.progression.xpCurveExponent));
}
