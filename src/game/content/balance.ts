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
    guardDamageMultiplier: 0.2,
    guardKiDrainPerHit: 4,
    parryWindowTicks: 7,
    parryStunTicks: 40,
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
    /** Stun-lock breaker: ticks of near-continuous hit reactions before armor kicks in. */
    stunLockMaxTicks: 150,
    /** Armor window: hits still deal damage but do not stun or interrupt. */
    stunLockArmorTicks: 60,
    /** Chain decay per free tick. */
    stunLockDecayPerTick: 3,
  },
  /** One ki system shared by exploration and combat. Rates use simulation seconds. */
  ki: {
    baseMax: 100,
    /** Hold-to-charge: immobile, no attack/guard, interrupted by damage. */
    chargePerSecond: 12,
    /** Passive regen only refills up to this fraction of max ki. */
    regenPerSecond: 1,
    regenCapFraction: 0.3,
    /** Ki after waking up at the checkpoint (defeat is not a free refill). */
    afterDefeatFraction: 0.3,
    costs: {
      kiBlast: 3,
      melee: 0,
      dash: 4,
      kamehameha: 30,
      kaioken: 15,
      teleport: 15,
      kienzan: 25,
      taiyoken: 20,
      kakusandan: 28,
      sokidan: 30,
      rogafufuken: 10,
      limit: 0,
    },
    worldBlastCooldownTicks: 30,
  },
  /** Focus combos: real-time window, world in slow motion. */
  focus: {
    timeScale: 0.2,
    windowSeconds: 3,
    cooldownTicks: 60 * 8,
    /** Small explicit ki penalty on a failed sequence (never negative, never double). */
    failKiPenalty: 5,
    /** Fraction of rage lost when a limit sequence fails. */
    failRageFraction: 0.5,
    confusedTicks: 90,
    confusedDamageTaken: 1.25,
    /** Stick magnitude to register / release a direction symbol. */
    stickOn: 0.6,
    stickOff: 0.3,
    /** World filter while focused (0..1). Ramp uses real seconds. */
    desaturate: 0.85,
    darken: 0.22,
    filterRampSeconds: 0.12,
  },
  /** AI allies: named techniques are paced (limits are exempt). */
  ai: {
    /** No ally slot technique during the first seconds of an encounter. */
    allyTechniqueOpeningTicks: 150,
    /** Minimum gap between two slot techniques from the same ally. */
    allyTechniqueIntervalTicks: 300,
  },
  rage: {
    max: 100,
    /** Rage per point of damage received from enemies, relative to max HP. */
    perDamageFraction: 110,
    blockedFactor: 0.5,
    /** Smaller contribution from active combat. */
    perHitLanded: 0.6,
    dominancePerSecond: 1.5,
  },
  /**
   * One wind for the whole valley. Direction is a unit vector on the ground.
   * Trees lean that way. The ground stays still.
   */
  /**
   * One sun for the valley. Day and night are equal real-time halves.
   * Afternoon is the low sun inside the day half, not a third clock.
   */
  dayNight: {
    daySeconds: 300,
    nightSeconds: 300,
    /** 0 = hard shadow, 1 = wide soft edge. */
    shadowSoftness: 0.35,
    /** Lamps, windows and ki glows. */
    lightBrightness: 1,
    /** Path lamp pool, in world units. */
    lampRadius: 4.5,
  },
  wind: {
    turnPerTick: 0.0004,
    gustSpeed: 0.018,
    flutterSpeed: 0.01,
    minStrength: 0.28,
    maxStrength: 0.85,
    /** Rigid tilt in radians when the wind blows fully across the view. */
    treeLean: 0.08,
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
    schemaVersion: 3,
  },
  /**
   * Camera framing. `zoomOut` multiplies every gameplay distance (1.15 = 15 %
   * farther than the original framing); the encounter zoom-in is preserved
   * because exploration and combat distances scale together. Exploration stays
   * close enough that the party reads large while walking.
   */
  camera: {
    zoomOut: 1.15,
    exploration: { distance: 11, pitch: 0.52, fov: 50 },
    /**
     * Combat stays closer than exploration (`max` × zoomOut < exploration distance)
     * and keeps a downward angle. The look-at point is always the controlled
     * fighter, never the map centre.
     */
    combat: { base: 6.2, perSpread: 0.45, min: 6.5, max: 10.5, pitch: 0.4, fov: 52 },
  },
  /**
   * Resolution model: the layout is authored against a 1920x1080 reference;
   * the GL canvas renders at an internal resolution chosen per device (never
   * forced to 1080p on phones), sprites keep their own texel size, and the
   * camera zoom is independent of all three.
   */
  render: {
    referenceWidth: 1920,
    referenceHeight: 1080,
    /** Max device-pixel ratio for the GL canvas per quality level. */
    maxDprHigh: 2,
    maxDprLow: 1,
    /** Cap on internal render height in pixels (phones with 3x screens stay cheap). */
    maxInternalHeight: 1080,
    minInternalHeight: 540,
    /** Adaptive resolution: drop DPR by `downStep` when the 2 s average falls under `downFps`; recover above `upFps`. */
    downFps: 45,
    upFps: 57,
    downStep: 0.85,
    upStep: 1.08,
    sampleSeconds: 2,
    /** Trees closer than (bottom-of-screen ground distance + this) along the view are cut away. */
    treeCutaway: 2.5,
  },
  effects: {
    maxParticlesMobile: 120,
    maxParticlesDesktop: 300,
  },
} as const;

export function xpToNextLevel(level: number): number {
  return Math.floor(BALANCE.progression.xpCurveBase * Math.pow(level, BALANCE.progression.xpCurveExponent));
}
