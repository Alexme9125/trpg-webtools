import { describe, expect, it } from 'vitest';
import {
  applyCharacterAdjustment as adjust,
  effectiveCharacter,
  getAdjustmentErrors,
  type TemporaryEffect,
} from '../shared/adjustments';
import {
  cocBudget,
  defaultCreationPolicy,
  dndSkillModifier,
  validateCreation,
} from '../shared/creation';
import { emptyEncounter, orderEncounter, syncEncounterPlayers } from '../shared/encounter';
import { exportCharacter, getCharacterErrors, parseCharacter, rollCheck } from '../shared/rules';
import type { Character, CheckRequest, Member } from '../shared/types';
import { preparedCharacter } from './fixtures/adjustment-character';

const effect = (changes: TemporaryEffect['changes'], id = 'injury'): TemporaryEffect => ({
  id,
  name: '伤势影响',
  endCondition: '休息后',
  enabled: true,
  changes,
});
const request = (patch: Partial<CheckRequest> = {}): CheckRequest => ({
  kind: 'skill',
  key: 'stealth',
  modifier: 0,
  dc: 15,
  edge: 'normal',
  ...patch,
});
const setValue = (card: Character, target: 'attribute' | 'skill', key: string, value: number) =>
  adjust(card, { kind: 'set-value', target, key, value, reason: '成长' });

describe('in-session character adjustments', () => {
  it('retains the creation ledger and original card while D&D checks compose ability, training and skill changes once', () => {
    const base = preparedCharacter();
    const original = structuredClone(base);
    let card = setValue(base, 'attribute', 'dex', 18);
    card = setValue(card, 'skill', 'stealth', 8);
    card = adjust(card, {
      kind: 'add-effect',
      effect: effect([
        { target: 'attribute', key: 'dex', amount: -4 },
        { target: 'skill', key: 'stealth', amount: 3 },
      ]),
    });
    expect(base).toEqual(original);
    expect(card.attributes).toEqual(base.attributes);
    expect(card.skills).toEqual(base.skills);
    expect(card.creation).toEqual(base.creation);
    expect(effectiveCharacter(card, false)).toMatchObject({
      attributes: { dex: 18 },
      skills: { stealth: 8 },
    });
    expect(effectiveCharacter(card)).toMatchObject({
      attributes: { dex: 14 },
      skills: { stealth: 9 },
    });
    expect(rollCheck('dnd', card, request(), () => 10)).toMatchObject({ modifier: 9, total: 19 });
    expect(
      rollCheck('dnd', card, request({ kind: 'ability', key: 'dex' }), () => 10).modifier,
    ).toBe(2);
    expect(validateCreation(card, defaultCreationPolicy('dnd'))).toEqual([]);
    expect(getCharacterErrors(card)).toEqual([]);
  });

  it('keeps a skill change relative when another lasting ability change happens, and restores temporary effects exactly', () => {
    const base = preparedCharacter();
    let card = setValue(base, 'skill', 'stealth', 6);
    card = setValue(card, 'attribute', 'dex', 16);
    expect(effectiveCharacter(card).skills.stealth).toBe(8);
    card = adjust(card, {
      kind: 'add-effect',
      effect: effect([{ target: 'skill', key: 'stealth', amount: -2 }]),
    });
    expect(effectiveCharacter(card).skills.stealth).toBe(6);
    card = adjust(card, { kind: 'toggle-effect', effectId: 'injury', enabled: false });
    expect(effectiveCharacter(card).skills.stealth).toBe(8);
    expect(card.adjustments!.temporary).toHaveLength(1);
    card = adjust(card, { kind: 'toggle-effect', effectId: 'injury', enabled: true });
    expect(effectiveCharacter(card).skills.stealth).toBe(6);
    card = adjust(card, { kind: 'remove-effect', effectId: 'injury' });
    expect(effectiveCharacter(card).skills.stealth).toBe(8);
    card = adjust(card, { kind: 'reset-value', target: 'skill', key: 'stealth' });
    expect(effectiveCharacter(card).skills.stealth).toBe(3);
  });

  it('sets a lasting score independently from active temporary effects and replaces an existing delta', () => {
    let card = adjust(preparedCharacter(), {
      kind: 'add-effect',
      effect: effect([{ target: 'attribute', key: 'str', amount: 2 }]),
    });
    card = setValue(card, 'attribute', 'str', 16);
    expect(effectiveCharacter(card).attributes.str).toBe(18);
    card = setValue(card, 'attribute', 'str', 14);
    expect(card.adjustments!.permanent).toHaveLength(1);
    expect(effectiveCharacter(card).attributes.str).toBe(16);
    card = adjust(card, { kind: 'reset-value', target: 'attribute', key: 'str' });
    expect(effectiveCharacter(card).attributes.str).toBe(14);
    expect(card.adjustments!.temporary).toHaveLength(1);
    card = adjust(card, { kind: 'clear-effects' });
    expect(effectiveCharacter(card).attributes.str).toBe(12);
  });

  it('preserves existing expertise, Jack of All Trades and save proficiency with effective abilities', () => {
    const base = preparedCharacter();
    base.proficiencies = ['skill:stealth', 'save:dex'];
    if (base.creation?.rule === 'dnd') base.creation.expertise = ['stealth'];
    let card = setValue(base, 'attribute', 'dex', 18);
    expect(rollCheck('dnd', card, request(), () => 10).modifier).toBe(8);
    expect(rollCheck('dnd', card, request({ kind: 'save', key: 'dex' }), () => 10).modifier).toBe(
      6,
    );
    card = { ...card, occupation: '吟游诗人', level: 2, proficiencies: [] };
    expect(rollCheck('dnd', card, request(), () => 10).modifier).toBe(5);
    expect(
      rollCheck('dnd', card, request({ kind: 'attack', modifier: 7 }), () => 10).modifier,
    ).toBe(7);
  });

  it('does not reallocate CoC points, recompute acquired skills or change/heal resources when attributes change', () => {
    const base = preparedCharacter('coc');
    let card = setValue(base, 'attribute', 'int', 80);
    card = setValue(card, 'attribute', 'pow', 20);
    card = setValue(card, 'attribute', 'dex', 0);
    card = setValue(card, 'skill', 'spotHidden', 65);
    card = adjust(card, {
      kind: 'add-effect',
      effect: effect([{ target: 'skill', key: 'spotHidden', amount: 10 }]),
    });
    expect(cocBudget(card)).toEqual(cocBudget(base));
    expect(card.creation).toEqual(base.creation);
    expect(effectiveCharacter(card).skills.dodge).toBe(base.skills.dodge);
    for (const key of ['hp', 'maxHp', 'mp', 'maxMp', 'san', 'maxSan', 'ac'] as const)
      expect(effectiveCharacter(card)[key]).toBe(base[key]);
    expect(rollCheck('coc', card, request({ key: 'spotHidden' }), () => 5).target).toBe(75);
    expect(rollCheck('coc', card, request({ kind: 'ability', key: 'int' }), () => 5).target).toBe(
      80,
    );
    expect(rollCheck('coc', card, request({ kind: 'sanity' }), () => 5).target).toBe(base.san);
    expect(getCharacterErrors(card)).toEqual([]);
    expect(validateCreation(card, defaultCreationPolicy('coc'))).toEqual([]);
  });

  it('supports imported custom CoC skill keys without letting unknown or cross-rule attributes through', () => {
    const base = preparedCharacter('coc');
    base.skills.sailing = 10;
    const card = setValue(base, 'skill', 'sailing', 35);
    expect(rollCheck('coc', card, request({ key: 'sailing' }), () => 4).target).toBe(35);
    expect(() => setValue(base, 'skill', 'unknown', 20)).toThrow('没有这个');
    expect(() => setValue(preparedCharacter(), 'attribute', 'pow', 20)).toThrow('没有这个');
  });

  it.each([
    ['dnd', 'attribute', 'str', 0],
    ['dnd', 'attribute', 'dex', 31],
    ['coc', 'attribute', 'int', -1],
    ['coc', 'attribute', 'edu', 101],
    ['coc', 'skill', 'spotHidden', -1],
    ['coc', 'skill', 'cthulhuMythos', 100],
  ] as const)('rejects invalid final %s %s %s = %i', (rule, target, key, value) => {
    expect(() => setValue(preparedCharacter(rule), target, key, value)).toThrow();
  });

  it('validates both lasting and active totals and checks a disabled effect when it is enabled', () => {
    let card = setValue(preparedCharacter(), 'attribute', 'str', 30);
    card = adjust(card, {
      kind: 'add-effect',
      effect: { ...effect([{ target: 'attribute', key: 'str', amount: 2 }]), enabled: false },
    });
    expect(() =>
      adjust(card, { kind: 'toggle-effect', effectId: 'injury', enabled: true }),
    ).toThrow('生效');
    expect(card.adjustments!.temporary[0].enabled).toBe(false);
    const low = adjust(preparedCharacter(), {
      kind: 'add-effect',
      effect: effect([{ target: 'attribute', key: 'str', amount: -2 }]),
    });
    expect(() => setValue(low, 'attribute', 'str', 31)).toThrow('长期');
  });

  it('rejects duplicate IDs, fields, zero-only effects, fractions, oversized effects and unsafe keys', () => {
    const base = preparedCharacter();
    const validEffect = effect([{ target: 'attribute', key: 'str', amount: 1 }]);
    const card = adjust(base, { kind: 'add-effect', effect: validEffect });
    expect(() => adjust(card, { kind: 'add-effect', effect: validEffect })).toThrow('重复');
    expect(() =>
      adjust(base, {
        kind: 'add-effect',
        effect: { ...validEffect, changes: [...validEffect.changes, ...validEffect.changes] },
      }),
    ).toThrow('重复');
    for (const amount of [0, 0.5, 101, Infinity, NaN])
      expect(() =>
        adjust(base, {
          kind: 'add-effect',
          effect: effect([{ target: 'attribute', key: 'str', amount }]),
        }),
      ).toThrow();
    for (const key of ['constructor', '__proto__', 'prototype'])
      expect(() => setValue(base, 'attribute', key, 10)).toThrow();
    const crowded = {
      ...base,
      adjustments: {
        permanent: [],
        temporary: Array.from({ length: 31 }, (_, i) => ({ ...validEffect, id: `effect-${i}` })),
      },
    };
    expect(getAdjustmentErrors(crowded)).not.toEqual([]);
    expect(() => parseCharacter(JSON.stringify(crowded))).toThrow();
  });

  it.each(['json', 'md'] as const)(
    'round-trips the original card and all adjustments through %s without applying them twice',
    (format) => {
      let card = setValue(preparedCharacter('coc'), 'skill', 'spotHidden', 50);
      card = adjust(card, {
        kind: 'add-effect',
        effect: effect([{ target: 'skill', key: 'spotHidden', amount: 10 }]),
      });
      const imported = parseCharacter(exportCharacter(card, format));
      expect(imported).toEqual(card);
      expect(effectiveCharacter(imported).skills.spotHidden).toBe(60);
      expect(getCharacterErrors(imported)).toEqual([]);
    },
  );

  it.each(['dnd', 'coc'] as const)(
    'uses the latest effective DEX for the next %s initiative ordering',
    (rule) => {
      const base = preparedCharacter(rule);
      const card = setValue(base, 'attribute', 'dex', rule === 'dnd' ? 18 : 80);
      const member: Member = {
        id: 'player',
        name: '玩家',
        role: 'player',
        online: true,
        ready: true,
        color: '#abc',
        character: card,
        characterRevision: 2,
        review: {
          status: 'approved',
          note: '',
          reviewedAt: null,
          characterRevision: 1,
          policyRevision: 0,
        },
      };
      const state = syncEncounterPlayers(emptyEncounter(), [member]);
      expect(state.participants[0].dex).toBe(rule === 'dnd' ? 18 : 80);
      expect(orderEncounter(state, rule, () => 10).participants[0].initiative).toBe(
        rule === 'dnd' ? 14 : 80,
      );
      expect(dndSkillModifier(preparedCharacter(), 'stealth')).toBe(1);
    },
  );
});
