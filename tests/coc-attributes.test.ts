import { describe, expect, it } from 'vitest';
import {
  cocAttributeRollError,
  cocAttributeCap,
  cocAttributeTotal,
  rollCocAttributes,
  scaleCocAttributes,
  type CocAttributeRollLimits,
} from '../shared/coc-attributes';
import { COC_ATTRIBUTES } from '../shared/catalog';
import {
  createCharacter,
  exportCharacter,
  parseCharacter,
  rerollAttributes,
  reduceCocAttributes,
} from '../shared/rules';
import { defaultCreationPolicy, suggestAllocation, validateCreation } from '../shared/creation';

function seeded(seed = 42) {
  return (sides: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor((seed / 2 ** 32) * sides) + 1;
  };
}

function legal(attributes: Record<string, number>) {
  for (const { key } of COC_ATTRIBUTES) {
    expect(attributes[key] % 5).toBe(0);
    expect(attributes[key]).toBeGreaterThanOrEqual(['siz', 'int', 'edu'].includes(key) ? 40 : 15);
    expect(attributes[key]).toBeLessThanOrEqual(90);
  }
}

describe('CoC capped attribute generation', () => {
  it('never exceeds any supported integer cap, including caps between dice totals', () => {
    const rng = seeded();
    for (let maxTotal = 195; maxTotal <= 720; maxTotal++) {
      const attributes = rollCocAttributes({ maxTotal }, rng);
      legal(attributes);
      expect(cocAttributeTotal(attributes)).toBeLessThanOrEqual(maxTotal);
    }
  });

  it('generates the minimum directly and leaves Luck outside the total', () => {
    const attributes = rollCocAttributes({ maxTotal: 195 }, (sides) => sides);
    expect(attributes).toEqual({
      str: 15,
      con: 15,
      siz: 40,
      dex: 15,
      app: 15,
      int: 40,
      pow: 15,
      edu: 40,
      luck: 90,
    });
    expect(cocAttributeTotal(attributes)).toBe(195);
  });

  it('remains bounded with repeated maximum and minimum random draws', () => {
    for (const rng of [() => 1, (sides: number) => sides]) {
      for (const maxTotal of [195, 200, 350, 499, 500, 719, 720]) {
        const attributes = rollCocAttributes({ maxTotal }, rng);
        legal(attributes);
        expect(cocAttributeTotal(attributes)).toBeLessThanOrEqual(maxTotal);
      }
    }
  });

  it('produces varied legal results across repeated rerolls', () => {
    const rng = seeded(13579);
    const totals = new Set<number>();
    for (let index = 0; index < 500; index++) {
      const attributes = rollCocAttributes({ maxTotal: 450 }, rng);
      const total = cocAttributeTotal(attributes);
      expect(total).toBeLessThanOrEqual(450);
      legal(attributes);
      totals.add(total);
    }
    expect(totals.size).toBeGreaterThan(10);
  });

  it('uses the host total in preference to personal caps, including an invalid personal setting', () => {
    const ranges = [
      { field: 'attributeTotal', min: 400, max: 450 },
      { field: 'attributes.str', min: 51, max: 61 },
      { field: 'attributes.luck', min: 70, max: 70 },
    ];
    const rng = seeded();
    for (const maxTotal of [undefined, 194, NaN, 390, 420, 500]) {
      expect(cocAttributeCap({ maxTotal, ranges })).toBe(450);
      expect(cocAttributeRollError({ maxTotal, ranges })).toBeNull();
      for (let index = 0; index < 80; index++) {
        const attributes = rollCocAttributes({ maxTotal, ranges }, rng);
        legal(attributes);
        expect(cocAttributeTotal(attributes)).toBeGreaterThanOrEqual(400);
        expect(cocAttributeTotal(attributes)).toBeLessThanOrEqual(450);
        expect([55, 60]).toContain(attributes.str);
        expect(attributes.luck).toBe(70);
      }
      expect(cocAttributeTotal(rollCocAttributes({ maxTotal, ranges }, (sides) => sides))).toBe(
        450,
      );
    }
  });

  it('still applies the personal cap when the host only restricts individual attributes', () => {
    const limits = { maxTotal: 400, ranges: [{ field: 'attributes.str', min: 60, max: 70 }] };
    const attributes = rollCocAttributes(limits, (sides) => sides);
    expect(cocAttributeCap(limits)).toBe(400);
    expect(attributes.str).toBe(70);
    expect(cocAttributeTotal(attributes)).toBe(400);
  });

  it.each<CocAttributeRollLimits>([
    { maxTotal: 194 },
    { maxTotal: 721 },
    { maxTotal: 500.5 },
    { maxTotal: NaN },
    { maxTotal: Infinity },
    { ranges: [{ field: 'attributeTotal', min: 441, max: 444 }] },
    { ranges: [{ field: 'attributes.str', min: 91, max: 99 }] },
    { ranges: [{ field: 'attributes.luck', min: 1, max: 10 }] },
    { ranges: [{ field: 'attributes.edu', min: 20, max: 30 }] },
    { ranges: [{ field: 'attributeTotal', min: 730, max: 800 }] },
    { ranges: [{ field: 'attributes.dex', min: 50, max: 40 }] },
    { ranges: [{ field: 'attributeTotal', min: 400, max: Infinity }] },
  ])('rejects impossible/invalid limits before consuming randomness: %j', (limits) => {
    let draws = 0;
    expect(cocAttributeRollError(limits)).toBeTruthy();
    expect(() =>
      rollCocAttributes(limits, () => {
        draws++;
        return 1;
      }),
    ).toThrow();
    expect(draws).toBe(0);
  });

  it('detects an impossible combined minimum even when each range is feasible alone', () => {
    const limits = {
      maxTotal: 450,
      ranges: COC_ATTRIBUTES.filter(({ key }) => key !== 'luck').map(({ key }) => ({
        field: `attributes.${key}`,
        min: 60,
        max: 90,
      })),
    };
    expect(cocAttributeRollError(limits)).toContain('无法同时满足');
  });

  it('rejects invalid random sources', () => {
    expect(() => rollCocAttributes({ maxTotal: 500 }, () => 0)).toThrow('随机源');
  });

  it('uses the original dice workflow when limits are absent and does not change D&D', () => {
    const coc = createCharacter('coc', () => 6);
    expect(cocAttributeTotal(coc.attributes)).toBe(720);
    expect(cocAttributeTotal(rerollAttributes(coc, () => 6).attributes)).toBe(720);
    const dnd = createCharacter('dnd', () => 6, { maxTotal: 195 });
    expect(Object.values(dnd.attributes)).toEqual([18, 18, 18, 18, 18, 18]);
  });

  it('applies limits on initial creation and reroll, retaining identity and allocations', () => {
    const policy = {
      ...defaultCreationPolicy('coc'),
      ranges: [{ field: 'attributeTotal', min: 400, max: 450 }],
    };
    const limits = { maxTotal: 430, ranges: policy.ranges };
    const first = createCharacter('coc', seeded(), limits);
    expect(cocAttributeTotal(first.attributes)).toBeLessThanOrEqual(450);
    const original = suggestAllocation(
      { ...first, name: '艾琳', occupation: '教授', notes: '保留笔记' },
      policy,
    );
    const snapshot = structuredClone(original);
    const next = rerollAttributes(original, seeded(432), limits);
    expect(cocAttributeTotal(next.attributes)).toBeGreaterThanOrEqual(400);
    expect(cocAttributeTotal(next.attributes)).toBeLessThanOrEqual(450);
    expect(next.id).toBe(original.id);
    expect(next.name).toBe('艾琳');
    expect(next.notes).toBe('保留笔记');
    expect(next.creation).toEqual(original.creation);
    expect(next.hp).toBe(Math.floor((next.attributes.con + next.attributes.siz) / 10));
    expect(next.mp).toBe(Math.floor(next.attributes.pow / 5));
    expect(next.san).toBe(next.attributes.pow);
    expect(original).toEqual(snapshot);
    const ready = suggestAllocation(next, policy);
    expect(validateCreation(ready, policy)).toEqual([]);
    expect(parseCharacter(exportCharacter(ready, 'md'))).toEqual(ready);
    expect(() => rerollAttributes(original, seeded(), { maxTotal: 194 })).toThrow();
    expect(original).toEqual(snapshot);
  });
});

describe('CoC proportional attribute reduction', () => {
  const attributes: Record<string, number> = {
    str: 80,
    con: 70,
    siz: 80,
    dex: 75,
    app: 65,
    int: 80,
    pow: 70,
    edu: 80,
    luck: 77,
  };
  const roomLimits = { maxTotal: 195, ranges: [{ field: 'attributeTotal', min: 400, max: 500 }] };

  it('scales by the host cap and floors each attribute to a multiple of five, leaving Luck unchanged', () => {
    const next = scaleCocAttributes(attributes, roomLimits);
    expect(next).toEqual({
      str: 65,
      con: 55,
      siz: 65,
      dex: 60,
      app: 50,
      int: 65,
      pow: 55,
      edu: 65,
      luck: 77,
    });
    expect(cocAttributeTotal(next)).toBe(480);
    expect(cocAttributeTotal(attributes)).toBe(600);
  });

  it('never raises any attribute or exceeds any active personal cap', () => {
    for (let cap = 195; cap < 600; cap++) {
      const next = scaleCocAttributes(attributes, { maxTotal: cap });
      expect(cocAttributeTotal(next)).toBeLessThanOrEqual(cap);
      expect(cocAttributeTotal(next)).toBeGreaterThan(cap - 40);
      for (const { key } of COC_ATTRIBUTES.filter(({ key }) => key !== 'luck')) {
        expect(next[key]).toBeLessThanOrEqual(attributes[key]);
        expect(next[key] % 5).toBe(0);
        expect(next[key]).toBeGreaterThan(0);
      }
      expect(next.luck).toBe(77);
    }
  });

  it.each([
    [{ field: 'attributeTotal', min: 495, max: 500 }],
    [
      { field: 'attributeTotal', min: 400, max: 500 },
      { field: 'attributes.edu', min: 70, max: 90 },
    ],
    [
      { field: 'attributeTotal', min: 400, max: 500 },
      { field: 'attributes.str', min: 1, max: 60 },
    ],
    [
      { field: 'attributeTotal', min: 400, max: 500 },
      { field: 'attributes.luck', min: 1, max: 70 },
    ],
  ])(
    'rejects reductions that violate other host ranges without mutating the card (%j)',
    (...ranges) => {
      const original = { ...attributes };
      expect(() => scaleCocAttributes(attributes, { ranges })).toThrow('请重新掷骰或手动调整');
      expect(attributes).toEqual(original);
    },
  );

  it('does not silently clamp a zero result or increase an already compliant card', () => {
    expect(() => scaleCocAttributes({ ...attributes, str: 1 }, { maxTotal: 300 })).toThrow(
      '不能降为 0',
    );
    expect(() => scaleCocAttributes(attributes, { maxTotal: 600 })).toThrow('无需降低');
    expect(() => scaleCocAttributes(attributes, {})).toThrow('请先设置');
    expect(() => scaleCocAttributes(attributes, { maxTotal: NaN })).toThrow();
    expect(() => scaleCocAttributes({ ...attributes, int: NaN }, { maxTotal: 500 })).toThrow(
      '有效的属性',
    );
  });

  it('updates base skills and resource ceilings while retaining allocations, injury and identity', () => {
    const policy = defaultCreationPolicy('coc');
    const original = suggestAllocation(
      {
        ...createCharacter('coc', () => 6),
        name: '艾琳',
        occupation: '教授',
        hp: 6,
        mp: 4,
        san: 33,
        notes: '保留记录',
      },
      policy,
    );
    const snapshot = structuredClone(original);
    const next = reduceCocAttributes(original, { maxTotal: 500 });
    expect(cocAttributeTotal(next.attributes)).toBe(480);
    expect(next.creation).toEqual(original.creation);
    expect(next.skills.dodge).toBe(original.skills.dodge - 15);
    expect(next.skills.ownLanguage).toBe(original.skills.ownLanguage - 30);
    expect(next.maxHp).toBe(12);
    expect(next.maxMp).toBe(12);
    expect(next.hp).toBe(6);
    expect(next.mp).toBe(4);
    expect(next.san).toBe(33);
    expect(next.id).toBe(original.id);
    expect(next.notes).toBe('保留记录');
    expect(validateCreation(next, policy).join('；')).toContain('职业点');
    const reallocated = suggestAllocation(next, policy);
    expect(validateCreation(reallocated, policy)).toEqual([]);
    expect(parseCharacter(exportCharacter(reallocated, 'json'))).toEqual(reallocated);
    expect(original).toEqual(snapshot);
    expect(() => reduceCocAttributes(createCharacter('dnd'), { maxTotal: 500 })).toThrow(
      '仅适用于 CoC',
    );
  });
});
