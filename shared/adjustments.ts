import { z } from 'zod';
import { COC_ATTRIBUTES, COC_SKILLS, DND_ATTRIBUTES, DND_SKILLS } from './catalog';
import { dndSkillModifier } from './creation';
import type { Character } from './types';

const key = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]{0,39}$/)
  .refine((value) => !['constructor', 'prototype'].includes(value), '项目名称无效');
const target = z.enum(['attribute', 'skill']);
const amount = z.number().int().min(-100).max(100);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const change = z.object({ target, key, amount }).strict();
const permanent = change
  .extend({ amount: z.number().int().min(-200).max(200), reason: z.string().trim().max(200) })
  .strict();

export const TemporaryEffectSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(60),
    endCondition: z.string().trim().max(200),
    enabled: z.boolean(),
    changes: z.array(change).min(1).max(20),
  })
  .strict();

export const CharacterAdjustmentsSchema = z
  .object({
    permanent: z.array(permanent).max(110),
    temporary: z.array(TemporaryEffectSchema).max(30),
  })
  .strict();

export const CharacterAdjustmentEditSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('set-value'),
      target,
      key,
      value: amount,
      reason: z.string().trim().max(200),
    })
    .strict(),
  z.object({ kind: z.literal('reset-value'), target, key }).strict(),
  z.object({ kind: z.literal('add-effect'), effect: TemporaryEffectSchema }).strict(),
  z.object({ kind: z.literal('toggle-effect'), effectId: id, enabled: z.boolean() }).strict(),
  z.object({ kind: z.literal('remove-effect'), effectId: id }).strict(),
  z.object({ kind: z.literal('clear-effects') }).strict(),
]);

export type AdjustmentTarget = z.infer<typeof target>;
export type CharacterAdjustments = z.infer<typeof CharacterAdjustmentsSchema>;
export type CharacterAdjustmentEdit = z.infer<typeof CharacterAdjustmentEditSchema>;
export type TemporaryEffect = z.infer<typeof TemporaryEffectSchema>;

export function adjustmentFields(card: Character, target: AdjustmentTarget) {
  if (target === 'attribute') return card.rule === 'dnd' ? DND_ATTRIBUTES : COC_ATTRIBUTES;
  if (card.rule === 'dnd') return DND_SKILLS;
  const known = new Set(COC_SKILLS.map((entry) => entry.key));
  return [
    ...COC_SKILLS,
    ...Object.keys(card.skills)
      .filter((entry) => !known.has(entry))
      .map((key) => ({ key, label: key })),
  ];
}

export function adjustmentLabel(card: Character, target: AdjustmentTarget, key: string) {
  return adjustmentFields(card, target).find((entry) => entry.key === key)?.label ?? key;
}

export function adjustmentBounds(card: Character, target: AdjustmentTarget, key: string) {
  return card.rule === 'dnd'
    ? target === 'attribute'
      ? { min: 1, max: 30 }
      : { min: -100, max: 100 }
    : { min: 0, max: key === 'cthulhuMythos' && target === 'skill' ? 99 : 100 };
}

export function hasAdjustments(card: Character) {
  return Boolean(card.adjustments?.permanent.length || card.adjustments?.temporary.length);
}

/** Read-only numeric projection for checks and display; always pass the original stored card. */
export function effectiveCharacter(card: Character, includeTemporary = true): Character {
  const { adjustments, ...base } = card;
  const changes = [
    ...(adjustments?.permanent ?? []),
    ...(includeTemporary
      ? (adjustments?.temporary ?? [])
          .filter((effect) => effect.enabled)
          .flatMap((effect) => effect.changes)
      : []),
  ];
  const attributes = { ...card.attributes };
  for (const entry of changes) {
    if (entry.target === 'attribute') attributes[entry.key] += entry.amount;
  }
  const withAttributes = { ...base, attributes };
  const skills =
    card.rule === 'dnd'
      ? Object.fromEntries(
          DND_SKILLS.map((entry) => [entry.key, dndSkillModifier(withAttributes, entry.key)]),
        )
      : {
          ...Object.fromEntries(COC_SKILLS.map((entry) => [entry.key, entry.base])),
          ...card.skills,
        };
  for (const entry of changes) {
    if (entry.target === 'skill') skills[entry.key] += entry.amount;
  }
  // Resource limits and creation budgets are deliberately unchanged by numeric effects.
  return { ...withAttributes, skills };
}

export function adjustedValue(card: Character, target: AdjustmentTarget, key: string) {
  return (target === 'attribute' ? card.attributes : card.skills)[key];
}

export function getAdjustmentErrors(card: Character): string[] {
  if (!card.adjustments) return [];
  const parsed = CharacterAdjustmentsSchema.safeParse(card.adjustments);
  if (!parsed.success) return ['局内修正格式无效：请检查名称、整数修正值与效果数量'];
  const { permanent, temporary } = parsed.data;
  const errors: string[] = [];
  if (new Set(temporary.map((entry) => entry.id)).size !== temporary.length)
    errors.push('临时效果的编号不可重复');
  for (const entries of [permanent, ...temporary.map((effect) => effect.changes)]) {
    const fields = new Set<string>();
    for (const entry of entries) {
      const field = `${entry.target}:${entry.key}`;
      if (fields.has(field)) errors.push('同一组修正中不可重复填写同一项目');
      fields.add(field);
      if (!adjustmentFields(card, entry.target).some((candidate) => candidate.key === entry.key))
        errors.push(`当前角色没有可调整的项目：${entry.key}`);
    }
  }
  if (errors.length) return [...new Set(errors)];
  for (const temporary of [false, true]) {
    const effective = effectiveCharacter(card, temporary);
    for (const target of ['attribute', 'skill'] as const) {
      for (const { key, label } of adjustmentFields(card, target)) {
        const value = adjustedValue(effective, target, key);
        const { min, max } = adjustmentBounds(card, target, key);
        if (!Number.isInteger(value) || value < min || value > max)
          errors.push(`${label}的${temporary ? '生效' : '长期'}数值须在 ${min}–${max} 之间`);
      }
    }
  }
  return [...new Set(errors)];
}

/** Host-authorized changes only. The caller checks identity, phase and revision first. */
export function applyCharacterAdjustment(
  card: Character,
  input: CharacterAdjustmentEdit,
  updatedAt = new Date().toISOString(),
): Character {
  const parsed = CharacterAdjustmentEditSchema.safeParse(input);
  if (!parsed.success) throw new Error('修正格式无效，请填写完整的名称与整数数值');
  const edit = parsed.data;
  const adjustments: CharacterAdjustments = structuredClone(
    card.adjustments ?? { permanent: [], temporary: [] },
  );
  if (edit.kind === 'set-value' || edit.kind === 'reset-value') {
    if (!adjustmentFields(card, edit.target).some((entry) => entry.key === edit.key))
      throw new Error('当前角色没有这个属性或技能');
    const existing = adjustments.permanent.find(
      (entry) => entry.target === edit.target && entry.key === edit.key,
    );
    adjustments.permanent = adjustments.permanent.filter((entry) => entry !== existing);
    if (edit.kind === 'set-value') {
      const delta =
        edit.value -
        adjustedValue(effectiveCharacter(card, false), edit.target, edit.key) +
        (existing?.amount ?? 0);
      if (delta !== 0)
        adjustments.permanent.push({
          target: edit.target,
          key: edit.key,
          amount: delta,
          reason: edit.reason,
        });
    }
  } else if (edit.kind === 'add-effect') {
    if (adjustments.temporary.some((effect) => effect.id === edit.effect.id))
      throw new Error('这个临时效果已存在，请勿重复添加');
    if (edit.effect.changes.every((entry) => entry.amount === 0))
      throw new Error('至少填写一个不为 0 的修正值');
    adjustments.temporary.push(structuredClone(edit.effect));
  } else if (edit.kind === 'clear-effects') {
    adjustments.temporary = [];
  } else {
    const effect = adjustments.temporary.find((entry) => entry.id === edit.effectId);
    if (!effect) throw new Error('临时效果已被移除，请重新查看角色');
    if (edit.kind === 'toggle-effect') effect.enabled = edit.enabled;
    else
      adjustments.temporary = adjustments.temporary.filter((entry) => entry.id !== edit.effectId);
  }
  const result = { ...card, adjustments, updatedAt };
  const errors = getAdjustmentErrors(result);
  if (errors.length) throw new Error(errors[0]);
  return result;
}

export function adjustmentDescription(
  before: Character,
  after: Character,
  edit: CharacterAdjustmentEdit,
) {
  const current = effectiveCharacter(after);
  const previous = effectiveCharacter(before);
  if (edit.kind === 'set-value' || edit.kind === 'reset-value') {
    const label = adjustmentLabel(after, edit.target, edit.key);
    const values = `${adjustedValue(previous, edit.target, edit.key)} → ${adjustedValue(current, edit.target, edit.key)}`;
    return `${after.name} · ${edit.kind === 'reset-value' ? '重置' : '调整'}${label}（生效值 ${values}）${edit.kind === 'set-value' && edit.reason ? ` · ${edit.reason}` : ''}`;
  }
  if (edit.kind === 'clear-effects') return `${after.name} · 已清除全部临时效果`;
  const effect =
    edit.kind === 'add-effect'
      ? edit.effect
      : before.adjustments?.temporary.find((entry) => entry.id === edit.effectId);
  const verb =
    edit.kind === 'add-effect'
      ? '添加'
      : edit.kind === 'remove-effect'
        ? '移除'
        : edit.enabled
          ? '启用'
          : '停用';
  const changes = effect?.changes
    .map(
      (entry) =>
        `${adjustmentLabel(after, entry.target, entry.key)} ${entry.amount >= 0 ? '+' : ''}${entry.amount}`,
    )
    .join('、');
  return `${after.name} · ${verb}临时效果「${effect?.name}」${changes ? `（${changes}）` : ''}`;
}
