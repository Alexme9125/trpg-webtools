import { describe, expect, it, vi } from 'vitest';
import {
  abilityModifier,
  COC_ATTRIBUTES,
  createCharacter,
  deriveCharacter,
  DND_ATTRIBUTES,
  exportCharacter,
  getCharacterErrors,
  parseCharacter,
  proficiencyBonus,
  randomTraits,
  rerollAttributes,
  rollCheck,
  rollDice,
} from '../shared/rules';
import type { Character, CheckRequest } from '../shared/types';

function sequence(...values: number[]) {
  let index = 0;
  return vi.fn((_sides: number) => {
    if (index >= values.length) throw new Error('Test dice sequence exhausted');
    return values[index++];
  });
}

function percentile(value: number) {
  return sequence((value % 10) + 1, Math.floor((value === 100 ? 0 : value) / 10) + 1);
}

function character(rule: 'dnd' | 'coc' = 'dnd'): Character {
  return {
    ...createCharacter(rule, () => 4),
    name: '黎雾 · Ω',
    occupation: rule === 'dnd' ? '游荡者' : '记者',
  };
}

function request(patch: Partial<CheckRequest> = {}): CheckRequest {
  return { kind: 'ability', key: 'dex', dc: 15, modifier: 0, edge: 'normal', ...patch };
}

describe('bounded dice expressions', () => {
  it('evaluates signed mixed groups and preserves every die for the log', () => {
    const rng = sequence(4, 6, 2, 3);
    const result = rollDice(' 2D6 + 1d4 - d8 + 5 ', rng);
    expect(result).toEqual({
      expression: '2d6+1d4-d8+5',
      modifier: 5,
      total: 14,
      groups: [
        { count: 2, sides: 6, sign: 1, rolls: [4, 6] },
        { count: 1, sides: 4, sign: 1, rolls: [2] },
        { count: 1, sides: 8, sign: -1, rolls: [3] },
      ],
    });
    expect(rng.mock.calls.map(([sides]) => sides)).toEqual([6, 6, 4, 8]);
  });

  it('supports leading negative groups and constant expressions', () => {
    expect(rollDice('-2d6+10', sequence(1, 6)).total).toBe(3);
    expect(rollDice('3-8+2').total).toBe(-3);
  });

  it.each([
    '',
    '0d6',
    '101d6',
    '1d1',
    'd1001',
    '50d6+51d6',
    '1d6++2',
    '(1d6)',
    '2*d6',
    '1d6/0',
    '2d6;process.exit()',
    'Math.random()',
    '1e3',
    '1.5d6',
    '1d6+NaN',
    '10001',
    '10000+1',
    'd6'.padEnd(121, ' '),
  ])('rejects malformed or over-budget input: %s', (expression) => {
    expect(() => rollDice(expression, () => 1)).toThrow();
  });

  it('validates the whole expression before rolling and accepts the exact caps', () => {
    const rng = vi.fn(() => 1);
    expect(() => rollDice('1d6+100d6', rng)).toThrow();
    expect(rng).not.toHaveBeenCalled();
    expect(rollDice('100d1000', (sides) => sides).total).toBe(100000);
  });

  it.each([0, -1, 7, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid injected random values (%s)',
    (value) => {
      expect(() => rollDice('d6', () => value)).toThrow('随机源');
    },
  );
});

describe('D&D 5e checks', () => {
  it('rounds odd negative modifiers down and advances proficiency at the right levels', () => {
    expect([1, 9, 10, 17, 30].map(abilityModifier)).toEqual([-5, -1, 0, 3, 10]);
    expect([1, 4, 5, 8, 9, 12, 13, 16, 17, 20].map(proficiencyBonus)).toEqual([
      2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
    ]);
    expect(() => proficiencyBonus(0)).toThrow();
    expect(() => proficiencyBonus(21)).toThrow();
  });

  it('adds skill and save proficiency once, without adding it to ability checks', () => {
    const c = character();
    c.level = 5;
    c.attributes.dex = 16;
    c.proficiencies = ['skill:acrobatics', 'save:dex'];
    expect(
      rollCheck('dnd', c, request({ kind: 'skill', key: 'acrobatics', modifier: 2 }), sequence(10)),
    ).toMatchObject({ modifier: 8, total: 18, success: true });
    expect(rollCheck('dnd', c, request({ kind: 'save' }), sequence(10))).toMatchObject({
      modifier: 6,
      total: 16,
    });
    expect(rollCheck('dnd', c, request(), sequence(10))).toMatchObject({
      modifier: 3,
      total: 13,
      success: false,
    });
  });

  it('takes the high or low d20 for advantage/disadvantage', () => {
    expect(rollCheck('dnd', null, request({ edge: 'advantage' }), sequence(3, 19))).toMatchObject({
      rolls: [3, 19],
      selected: 19,
      success: true,
    });
    expect(
      rollCheck('dnd', null, request({ edge: 'disadvantage' }), sequence(3, 19)),
    ).toMatchObject({ selected: 3, success: false });
  });

  it('uses the explicit attack modifier without adding an ability twice', () => {
    const c = character();
    c.attributes.str = 20;
    const result = rollCheck(
      'dnd',
      c,
      request({ kind: 'attack', key: 'str', modifier: 7 }),
      sequence(10),
    );
    expect(result).toMatchObject({ total: 17, modifier: 7, label: '攻击检定' });
  });

  it('reserves automatic natural 1 / 20 outcomes for attacks', () => {
    expect(rollCheck('dnd', null, request({ modifier: 10, dc: 10 }), sequence(1))).toMatchObject({
      success: true,
      outcome: '成功',
    });
    expect(rollCheck('dnd', null, request({ dc: 30 }), sequence(20))).toMatchObject({
      success: false,
      outcome: '失败',
    });
    expect(rollCheck('dnd', null, request({ kind: 'save', dc: 30 }), sequence(20)).success).toBe(
      false,
    );
    expect(
      rollCheck('dnd', null, request({ kind: 'attack', dc: 0, modifier: 100 }), sequence(1)),
    ).toMatchObject({ success: false, outcome: '自动失手' });
    expect(
      rollCheck('dnd', null, request({ kind: 'attack', dc: 1000 }), sequence(20)),
    ).toMatchObject({ success: true, outcome: '重击' });
  });

  it('supports a host without a character and rejects wrong rule/check types', () => {
    expect(rollCheck('dnd', null, request({ modifier: 4 }), sequence(11)).total).toBe(15);
    expect(() => rollCheck('dnd', character('coc'), request())).toThrow('不匹配');
    expect(() => rollCheck('dnd', character(), request({ kind: 'sanity' }))).toThrow('理智');
    expect(() => rollCheck('dnd', character(), request({ key: 'constructor' }))).toThrow(
      '检定项目',
    );
  });
});

describe('CoC 7 checks', () => {
  it.each([
    [53, 1, '大成功', true],
    [53, 10, '极难成功', true],
    [53, 11, '困难成功', true],
    [53, 26, '困难成功', true],
    [53, 27, '普通成功', true],
    [53, 53, '普通成功', true],
    [53, 54, '失败', false],
    [49, 95, '失败', false],
    [49, 96, '大失败', false],
    [50, 96, '失败', false],
    [50, 99, '失败', false],
    [50, 100, '大失败', false],
    [100, 100, '大失败', false],
    [180, 36, '极难成功', true],
    [180, 90, '困难成功', true],
    [180, 99, '普通成功', true],
    [180, 100, '大失败', false],
  ])('resolves target %i, roll %i as %s', (target, value, outcome, success) => {
    expect(rollCheck('coc', null, request({ target }), percentile(value))).toMatchObject({
      selected: value,
      outcome,
      success,
    });
  });

  it('uses one units die and two tens dice for a bonus or penalty', () => {
    const rng = sequence(5, 5, 3);
    const bonus = rollCheck('coc', null, request({ target: 50, edge: 'advantage' }), rng);
    expect(bonus).toMatchObject({ rolls: [44, 24], selected: 24, outcome: '困难成功' });
    expect(rng.mock.calls.map(([sides]) => sides)).toEqual([10, 10, 10]);
    expect(
      rollCheck('coc', null, request({ target: 50, edge: 'disadvantage' }), sequence(5, 5, 3)),
    ).toMatchObject({ rolls: [44, 24], selected: 44 });
  });

  it('compares complete percentile values when the units die is zero', () => {
    expect(
      rollCheck('coc', null, request({ target: 50, edge: 'advantage' }), sequence(1, 1, 10)),
    ).toMatchObject({ rolls: [100, 90], selected: 90 });
    expect(
      rollCheck('coc', null, request({ target: 50, edge: 'disadvantage' }), sequence(1, 1, 10)),
    ).toMatchObject({ selected: 100, outcome: '大失败' });
  });

  it('reads actual SAN for sanity checks, final skill values for skills', () => {
    const c = character('coc');
    c.san = 23;
    c.skills.listen = 57;
    expect(rollCheck('coc', c, request({ kind: 'sanity' }), percentile(24))).toMatchObject({
      target: 23,
      success: false,
      label: '理智检定',
    });
    expect(
      rollCheck('coc', c, request({ kind: 'skill', key: 'listen' }), percentile(57)),
    ).toMatchObject({ target: 57, success: true });
    expect(
      rollCheck('coc', c, request({ kind: 'skill', key: 'listen', target: 20 }), percentile(21)),
    ).toMatchObject({ target: 20, success: false });
  });

  it('requires an explicit percentage for hosts and bounds it', () => {
    expect(() => rollCheck('coc', null, request())).toThrow('目标百分比');
    expect(() => rollCheck('coc', null, request({ target: 100001 }))).toThrow();
    expect(() => rollCheck('coc', null, request({ kind: 'sanity', target: 101 }))).toThrow();
    expect(rollCheck('coc', null, request({ target: 37 }), percentile(37))).toMatchObject({
      success: true,
      target: 37,
    });
  });

  it('uses a simple SAN threshold without skill success grades or a success at SAN zero', () => {
    const c = character('coc');
    c.san = 70;
    expect(rollCheck('coc', c, request({ kind: 'sanity' }), percentile(1))).toMatchObject({
      success: true,
      outcome: '成功',
      rolls: [1],
    });
    c.san = 0;
    expect(rollCheck('coc', c, request({ kind: 'sanity' }), percentile(1))).toMatchObject({
      success: false,
      outcome: '失败',
    });
  });

  it.each(['advantage', 'disadvantage'] as const)('rejects %s on an ordinary SAN roll', (edge) => {
    expect(() => rollCheck('coc', character('coc'), request({ kind: 'sanity', edge }))).toThrow(
      '不使用奖励骰或惩罚骰',
    );
  });
});

describe('character creation and derived resources', () => {
  it('rolls six D&D attributes using 4d6 drop lowest, without filling manual identity', () => {
    const rng = sequence(...Array.from({ length: 6 }, () => [1, 2, 5, 6]).flat());
    const c = createCharacter('dnd', rng);
    expect(Object.keys(c.attributes)).toEqual(DND_ATTRIBUTES.map(({ key }) => key));
    expect(Object.values(c.attributes)).toEqual([13, 13, 13, 13, 13, 13]);
    expect(c.name).toBe('');
    expect(c.occupation).toBe('');
    expect(getCharacterErrors(c)).toHaveLength(2);
    expect(rng).toHaveBeenCalledTimes(24);
  });

  it('generates CoC base attributes, special 2d6+6 attributes, and derived resources', () => {
    const c = createCharacter('coc', () => 1);
    expect(Object.keys(c.attributes)).toEqual(COC_ATTRIBUTES.map(({ key }) => key));
    expect(c.attributes).toEqual({
      str: 15,
      con: 15,
      siz: 40,
      dex: 15,
      app: 15,
      int: 40,
      pow: 15,
      edu: 40,
      luck: 15,
    });
    expect(c).toMatchObject({ hp: 5, maxHp: 5, mp: 3, maxMp: 3, san: 15, maxSan: 99 });
    expect(c.skills).toMatchObject({ dodge: 7, ownLanguage: 40, spotHidden: 25, cthulhuMythos: 0 });
  });

  it('does not heal a character when recomputing changed attributes', () => {
    const c = character('coc');
    c.hp = 3;
    c.mp = 2;
    c.san = 30;
    c.attributes.con = 90;
    c.attributes.siz = 90;
    c.attributes.pow = 90;
    c.skills.cthulhuMythos = 80;
    const changed = deriveCharacter(c);
    expect(changed).toMatchObject({ hp: 3, maxHp: 18, mp: 2, maxMp: 18, san: 19, maxSan: 19 });
    expect(c.san).toBe(30);
    const dnd = character();
    dnd.maxHp = 42;
    dnd.hp = 8;
    dnd.ac = 18;
    expect(deriveCharacter(dnd)).toMatchObject({ hp: 8, maxHp: 42, ac: 18 });
  });

  it('rerolls creation stats repeatedly while preserving identity and allocated skill points', () => {
    const c = character('coc');
    c.notes = '保留这一句';
    c.skills.dodge += 10;
    if (c.creation?.rule === 'coc') c.creation.personal.dodge = 10;
    const next = rerollAttributes(c, () => 6);
    expect(next.id).toBe(c.id);
    expect(next.name).toBe(c.name);
    expect(next.notes).toBe(c.notes);
    expect(next).toMatchObject({ hp: 18, mp: 18, san: 90 });
    expect(next.skills.dodge).toBe(55);
    expect(next.skills.ownLanguage).toBe(90);
    expect(randomTraits('dnd')).toHaveLength(3);
    expect(randomTraits('coc')).toHaveLength(3);
  });
});

describe('portable character files', () => {
  it.each(['json', 'md'] as const)(
    'round-trips Unicode, newlines and Markdown punctuation in %s',
    (format) => {
      const c = character('coc');
      c.notes = '日记：\n**雨夜**，骰子 🎲\n```json\n这不是额外的数据块\n```';
      c.items = [{ id: 'item-1', name: '旧怀表 ⏱', quantity: 1, notes: '刻着「归来」' }];
      expect(parseCharacter(exportCharacter(c, format), 'coc')).toEqual(c);
    },
  );

  it('supports a UTF-8 BOM and Windows line endings in structured Markdown', () => {
    const c = character();
    expect(parseCharacter(`\uFEFF${exportCharacter(c, 'md').replace(/\n/g, '\r\n')}`)).toEqual(c);
  });

  it('rejects incomplete cards, wrong rules, unsupported versions and ambiguous Markdown', () => {
    expect(() => exportCharacter(createCharacter('dnd'), 'json')).toThrow('姓名');
    expect(() => parseCharacter(exportCharacter(character(), 'json'), 'coc')).toThrow('规则不匹配');
    expect(() => parseCharacter(JSON.stringify({ ...character(), schemaVersion: 2 }))).toThrow(
      '格式版本',
    );
    const markdown = exportCharacter(character(), 'md');
    expect(() => parseCharacter(`${markdown}\n${markdown}`)).toThrow('仅包含一个');
    expect(() => parseCharacter('# 普通人物描述，没有数据')).toThrow('json');
    expect(() => parseCharacter('{"name":')).toThrow('无法读取 JSON');
  });

  it.each([
    (c: Character) => ({ ...c, name: 5 }),
    (c: Character) => ({ ...c, extra: true }),
    (c: Character) => ({ ...c, attributes: { ...c.attributes, dex: '18' } }),
    (c: Character) => ({ ...c, attributes: { ...c.attributes, dex: 31 } }),
    (c: Character) => ({ ...c, attributes: { dex: 18 } }),
    (c: Character) => ({ ...c, attributes: { ...c.attributes, pow: 50 } }),
    (c: Character) => ({ ...c, hp: c.maxHp + 1 }),
    (c: Character) => ({ ...c, level: 0 }),
    (c: Character) => ({ ...c, notes: 'n'.repeat(12001) }),
    (c: Character) => ({ ...c, skills: { constructor: 1 } }),
    (c: Character) => ({ ...c, proficiencies: ['skill:acrobatics', 'skill:acrobatics'] }),
    (c: Character) => ({ ...c, items: [{ id: 'a', name: '物品', quantity: -1, notes: '' }] }),
    (c: Character) => ({ ...c, createdAt: 'yesterday' }),
  ])('rejects malformed schema fields', (mutate) => {
    expect(() => parseCharacter(JSON.stringify(mutate(character())))).toThrow();
  });

  it('rejects prototype keys, oversized files and invalid top-level values', () => {
    const json = exportCharacter(character(), 'json');
    expect(() =>
      parseCharacter(json.replace('"skills": {', '"skills": {"__proto__": 1,')),
    ).toThrow();
    expect(() => parseCharacter(' '.repeat(256001))).toThrow('最多');
    expect(() => parseCharacter('null')).toThrow();
    expect(getCharacterErrors(null as unknown as Character).length).toBeGreaterThan(0);
  });
});
