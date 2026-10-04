import type { Mobile } from "../../entity/impl/Mobile";

export type HitModifier = (entity: Mobile, baseHit: number) => number;

const meleeHitModifiers: HitModifier[] = [];
const rangedHitModifiers: HitModifier[] = [];
const magicHitModifiers: HitModifier[] = [];
const meleeAttackAccuracyModifiers: HitModifier[] = [];
const meleeDefenseModifiers: HitModifier[] = [];
const rangedAttackAccuracyModifiers: HitModifier[] = [];
const rangedDefenseModifiers: HitModifier[] = [];
const magicAttackAccuracyModifiers: HitModifier[] = [];
const magicDefenseModifiers: HitModifier[] = [];

const applyModifiers = (modifiers: HitModifier[], entity: Mobile, baseHit: number): number =>
  modifiers.reduce((damage, modifier) => {
    const next = modifier(entity, damage);
    return Number.isFinite(next) ? next : damage;
  }, baseHit);

const registerModifier = (modifiers: HitModifier[], modifier: HitModifier): void => {
  if (typeof modifier !== "function") {
    return;
  }
  modifiers.push(modifier);
};

export function registerMeleeHitModifier(modifier: HitModifier): void {
  registerModifier(meleeHitModifiers, modifier);
}

export function registerRangedHitModifier(modifier: HitModifier): void {
  registerModifier(rangedHitModifiers, modifier);
}

export function registerMagicHitModifier(modifier: HitModifier): void {
  registerModifier(magicHitModifiers, modifier);
}

export function registerMeleeAttackAccuracyModifier(modifier: HitModifier): void {
  registerModifier(meleeAttackAccuracyModifiers, modifier);
}

export function registerMeleeDefenseModifier(modifier: HitModifier): void {
  registerModifier(meleeDefenseModifiers, modifier);
}

export function registerRangedAttackAccuracyModifier(modifier: HitModifier): void {
  registerModifier(rangedAttackAccuracyModifiers, modifier);
}

export function registerRangedDefenseModifier(modifier: HitModifier): void {
  registerModifier(rangedDefenseModifiers, modifier);
}

export function registerMagicAttackAccuracyModifier(modifier: HitModifier): void {
  registerModifier(magicAttackAccuracyModifiers, modifier);
}

export function registerMagicDefenseModifier(modifier: HitModifier): void {
  registerModifier(magicDefenseModifiers, modifier);
}

export function applyMeleeHitModifiers(entity: Mobile, baseHit: number): number {
  return applyModifiers(meleeHitModifiers, entity, baseHit);
}

export function applyRangedHitModifiers(entity: Mobile, baseHit: number): number {
  return applyModifiers(rangedHitModifiers, entity, baseHit);
}

export function applyMagicHitModifiers(entity: Mobile, baseHit: number): number {
  return applyModifiers(magicHitModifiers, entity, baseHit);
}

export function applyMeleeAttackAccuracyModifiers(entity: Mobile, value: number): number {
  return applyModifiers(meleeAttackAccuracyModifiers, entity, value);
}

export function applyMeleeDefenseModifiers(entity: Mobile, value: number): number {
  return applyModifiers(meleeDefenseModifiers, entity, value);
}

export function applyRangedAttackAccuracyModifiers(entity: Mobile, value: number): number {
  return applyModifiers(rangedAttackAccuracyModifiers, entity, value);
}

export function applyRangedDefenseModifiers(entity: Mobile, value: number): number {
  return applyModifiers(rangedDefenseModifiers, entity, value);
}

export function applyMagicAttackAccuracyModifiers(entity: Mobile, value: number): number {
  return applyModifiers(magicAttackAccuracyModifiers, entity, value);
}

export function applyMagicDefenseModifiers(entity: Mobile, value: number): number {
  return applyModifiers(magicDefenseModifiers, entity, value);
}
