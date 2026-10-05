import { COC_ATTRIBUTES } from './catalog';

/** Room total ranges override the personal maxTotal. Luck is separate. */
export interface CocAttributeRollLimits {
  maxTotal?: number;
  ranges?: ReadonlyArray<{ field: string; min: number; max: number }>;
}

type Outcome = { value: number; weight: number };
type RandomDie = (sides: number) => number;
const TOTAL_KEYS = COC_ATTRIBUTES.filter((attribute) => attribute.key !== 'luck');
const LARGE_KEYS = new Set(['siz', 'int', 'edu']);

function distribution(count: number, offset: number): Outcome[] {
  let counts = new Map([[offset, 1]]);
  for (let i = 0; i < count; i++) {
    const next = new Map<number, number>();
    for (const [sum, frequency] of counts)
      for (let face = 1; face <= 6; face++)
        next.set(sum + face, (next.get(sum + face) ?? 0) + frequency);
    counts = next;
  }
  return [...counts].map(([sum, weight]) => ({ value: sum * 5, weight }));
}

const STANDARD = distribution(3, 0);
const LARGE = distribution(2, 6);

export function cocAttributeTotal(attributes: Record<string, number>): number {
  return TOTAL_KEYS.reduce((sum, { key }) => sum + (attributes[key] ?? 0), 0);
}

export function cocAttributeCap(limits: CocAttributeRollLimits): number | undefined {
  const roomTotals = limits.ranges?.filter(({ field }) => field === 'attributeTotal') ?? [];
  return roomTotals.length ? Math.min(...roomTotals.map(({ max }) => max)) : limits.maxTotal;
}

function attributeRanges(limits: CocAttributeRollLimits) {
  const ranges = limits.ranges ?? [];
  const relevant = ranges.filter(
    ({ field }) => field === 'attributeTotal' || field.startsWith('attributes.'),
  );
  if (
    !relevant.some(({ field }) => field === 'attributeTotal') &&
    limits.maxTotal !== undefined &&
    (!Number.isInteger(limits.maxTotal) || limits.maxTotal < 195 || limits.maxTotal > 720)
  )
    throw new Error('属性点上限须为 195–720 的整数（八项属性，不含幸运）。');

  if (
    relevant.some(({ min, max }) => !Number.isInteger(min) || !Number.isInteger(max) || min > max)
  )
    throw new Error('属性范围须为有效的整数区间。');
  return relevant;
}

function prepare(limits: CocAttributeRollLimits) {
  const relevant = attributeRanges(limits);
  const choices = COC_ATTRIBUTES.map(({ key, label }) => {
    const bounds = relevant.filter(({ field }) => field === `attributes.${key}`);
    const outcomes = (LARGE_KEYS.has(key) ? LARGE : STANDARD).filter(({ value }) =>
      bounds.every(({ min, max }) => value >= min && value <= max),
    );
    if (!outcomes.length)
      throw new Error(`${label}的房间范围与 CoC 属性骰式没有交集，请调整范围或手动填写。`);
    return { key, outcomes };
  });
  const attributes = TOTAL_KEYS.map(({ key }) => choices.find((choice) => choice.key === key)!);
  const totalRanges = relevant.filter(({ field }) => field === 'attributeTotal');
  // Every attribute distribution is a contiguous sequence in steps of five.
  const min = Math.ceil(
    Math.max(
      attributes.reduce((sum, { outcomes }) => sum + outcomes[0].value, 0),
      ...totalRanges.map((range) => range.min),
    ) / 5,
  );
  const max = Math.floor(
    Math.min(
      cocAttributeCap(limits) ?? 720,
      attributes.reduce((sum, { outcomes }) => sum + outcomes.at(-1)!.value, 0),
      ...totalRanges.map((range) => range.max),
    ) / 5,
  );
  if (min > max)
    throw new Error('属性点上限与房间范围无法同时满足，或区间内没有符合骰式的总和；请调整限制。');
  return { attributes, luck: choices.find(({ key }) => key === 'luck')!.outcomes, min, max };
}

/** A manual proportional reduction, not a dice roll; reject conflicting ranges atomically. */
export function scaleCocAttributes(
  attributes: Record<string, number>,
  limits: CocAttributeRollLimits,
): Record<string, number> {
  const ranges = attributeRanges(limits);
  const cap = cocAttributeCap(limits);
  if (cap === undefined || !Number.isSafeInteger(cap) || cap <= 0)
    throw new Error('请先设置有效的属性总和上限。');
  if (
    COC_ATTRIBUTES.some(
      ({ key }) =>
        !Number.isInteger(attributes[key]) || attributes[key] < 1 || attributes[key] > 9999,
    )
  )
    throw new Error('请先补齐有效的属性数值。');
  const total = cocAttributeTotal(attributes);
  if (total <= cap) throw new Error('当前属性总和未超限，无需降低。');
  const next = { ...attributes };
  for (const { key } of TOTAL_KEYS)
    next[key] = Math.floor((attributes[key] * cap) / (total * 5)) * 5;

  const errors: string[] = [];
  for (const { key, label } of COC_ATTRIBUTES) {
    const bounds = ranges.filter(({ field }) => field === `attributes.${key}`);
    for (const { min, max } of bounds.length ? bounds : [{ min: 1, max: 99 }])
      if (next[key] < min || next[key] > max)
        errors.push(`${label}将为 ${next[key]}，须在 ${min}–${max} 内`);
    if (next[key] < 1) errors.push(`${label}不能降为 0`);
  }
  const nextTotal = cocAttributeTotal(next);
  for (const { min, max } of ranges.filter(({ field }) => field === 'attributeTotal'))
    if (nextTotal < min || nextTotal > max)
      errors.push(`总和将为 ${nextTotal}，须在 ${min}–${max} 内`);
  if (errors.length) throw new Error(`按比例降低后${errors.join('；')}。请重新掷骰或手动调整。`);
  return next;
}

export function cocAttributeRollError(limits: CocAttributeRollLimits): string | null {
  try {
    prepare(limits);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

function pick(outcomes: Outcome[], rng: RandomDie): number {
  const possible = outcomes.filter(({ weight }) => weight > 0);
  if (possible.length === 1) return possible[0].value;
  const draw = () => {
    const value = rng(2 ** 26);
    if (!Number.isInteger(value) || value < 1 || value > 2 ** 26)
      throw new Error('随机源返回了无效骰点。');
    return value - 1;
  };
  // Two bounded draws provide a 52-bit fraction without exceeding uint32 RNG limits.
  const unit = (draw() * 2 ** 26 + draw()) / 2 ** 52;
  let ticket = unit * possible.reduce((sum, { weight }) => sum + weight, 0);
  for (const outcome of possible) {
    ticket -= outcome.weight;
    if (ticket < 0) return outcome.value;
  }
  return possible.at(-1)!.value; // Floating-point rounding at the upper boundary.
}

/**
 * Sample legal dice outcomes conditioned on the requested ranges. Suffix counts
 * weight each choice by its remaining dice combinations, avoiding rejection
 * loops even for the minimum total of 195. No attributes are clipped afterward.
 */
export function rollCocAttributes(
  limits: CocAttributeRollLimits,
  rng: RandomDie,
): Record<string, number> {
  const { attributes, luck, min, max } = prepare(limits);
  const suffix = Array.from({ length: attributes.length + 1 }, () => Array<number>(145).fill(0));
  suffix[attributes.length][0] = 1;
  for (let i = attributes.length - 1; i >= 0; i--)
    for (const { value, weight } of attributes[i].outcomes)
      for (let sum = value / 5; sum <= max; sum++)
        suffix[i][sum] += weight * suffix[i + 1][sum - value / 5];

  const result: Record<string, number> = {};
  let used = 0;
  for (const [index, { key, outcomes }] of attributes.entries()) {
    const weighted = outcomes.map(({ value, weight }) => {
      let continuations = 0;
      for (let sum = Math.max(0, min - used - value / 5); sum <= max - used - value / 5; sum++)
        continuations += suffix[index + 1][sum];
      return { value, weight: weight * continuations };
    });
    result[key] = pick(weighted, rng);
    used += result[key] / 5;
  }
  result.luck = pick(luck, rng);
  return result;
}
