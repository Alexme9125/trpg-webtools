import { describe, expect, it, vi } from 'vitest';
import {
  createKeeperBatch,
  createKeeperCard,
  deriveKeeperCard,
  duplicateKeeperCard,
  exportKeeperCard,
  exportKeeperCards,
  getKeeperCardErrors,
  keeperDamageBonus,
  KeeperCardSchema,
  KEEPER_TEMPLATES,
  parseKeeperCard,
  parseKeeperCards,
  rerollKeeperCard,
  rollKeeperAttribute,
  type KeeperCard,
} from '../shared/keeper';
import { createCharacter } from '../shared/rules';

describe('separate CoC keeper card model', () => {
  it('supports sparse NPCs and monsters without investigator identity or point budgets', () => {
    const npc = createKeeperCard('npc', { name: '只出现一句话的路人' });
    const monster = createKeeperCard('monster');
    expect(npc).toMatchObject({
      documentType: 'keeper-card',
      kind: 'npc',
      rule: 'coc',
      category: 'human',
      hp: null,
      maxHp: null,
    });
    expect(Object.values(npc.attributes)).toEqual(Array(8).fill(null));
    expect(monster).toMatchObject({
      kind: 'monster',
      category: 'custom',
      attributes: { app: null, edu: null },
    });
    expect(getKeeperCardErrors(npc)).toEqual([]);
    expect(getKeeperCardErrors(monster)).toEqual([]);
    expect('occupation' in npc).toBe(false);
    expect('creation' in npc).toBe(false);
  });

  it('does not accept a player character as a keeper card', () => {
    const player = createCharacter('coc');
    expect(KeeperCardSchema.safeParse(player).success).toBe(false);
    expect(() => parseKeeperCard(JSON.stringify(player))).toThrow();
  });

  it('offers the four rulebook monster categories but clearly labels original examples', () => {
    for (const category of ['mythos', 'deity', 'traditional', 'beast']) {
      expect(
        KEEPER_TEMPLATES.some(
          (template) => template.kind === 'monster' && template.category === category,
        ),
      ).toBe(true);
    }
    expect(KEEPER_TEMPLATES.every((template) => template.isOriginal)).toBe(true);
    expect(createKeeperCard('monster-mist-hound').source).toContain('原创');
    expect(createKeeperCard('npc-bystander').source).toContain('非官方');
  });

  it('keeps original reference values distinct from rolled specimens', () => {
    expect(createKeeperCard('npc-bystander')).toMatchObject({
      attributes: { str: 52, siz: 65 },
      hp: 11,
      mp: 10,
    });
    const rng = vi.fn(() => 1);
    const rolled = createKeeperCard('npc-bystander', { mode: 'roll', rng });
    expect(rolled).toMatchObject({
      attributes: { str: 15, con: 15, siz: 40, int: 40, edu: 40 },
      hp: 5,
      mp: 3,
    });
    expect(rng).toHaveBeenCalledTimes(21);
    const monster = createKeeperCard('monster-mist-hound');
    expect(monster.attributes.siz).toBeGreaterThan(100);
    expect(getKeeperCardErrors(monster)).toEqual([]);
  });

  it('accepts huge known monster attributes and nullable inapplicable values', () => {
    const card = createKeeperCard('monster-deity');
    card.attributes = { ...card.attributes, str: 5000, con: 1200, siz: 3000, pow: 1500 };
    const derived = deriveKeeperCard(card);
    expect(derived).toMatchObject({
      maxHp: 420,
      maxMp: 300,
      hp: null,
      mp: null,
      attributes: { app: null, edu: null },
    });
    expect(getKeeperCardErrors(derived)).toEqual([]);
  });

  it('rejects an unknown template or cross-kind selection', () => {
    expect(() => createKeeperCard('dnd')).toThrow('模板');
    expect(() => createKeeperCard('npc', { templateId: 'monster-mist-hound' })).toThrow('模板');
  });
});

describe('bounded stat-block formulas', () => {
  it.each([
    ['3d6*5', 1, 15],
    ['(2d6+6)*5', 6, 90],
    ['(2D6 + 6) × 5', 2, 50],
    ['2d6+6', 3, 12],
    ['(2d6-2)*5', 1, 0],
    ['d6*10', 4, 40],
    ['250', 1, 250],
  ])('rolls %s with each die %i to %i', (formula, value, expected) => {
    expect(rollKeeperAttribute(formula, () => value)).toBe(expected);
  });

  it.each([
    '2d6+6*5',
    'Math.random()',
    '3d6;alert(1)',
    '101d6',
    'd1001',
    'd1',
    '(2d6-3)*5',
    '100d1000*2',
    '3d6*0',
    '3d6*1001',
    '100001',
    '2*(3d6)',
    '(3d6+6)*5*2',
    '1e4',
    'Infinity',
    '2.5d6',
    'd6'.padEnd(81, ' '),
  ])('rejects ambiguous, executable or over-budget formula %s', (formula) => {
    expect(() => rollKeeperAttribute(formula, () => 1)).toThrow();
  });

  it('validates every possible result and checks the injected die range', () => {
    expect(rollKeeperAttribute('100d1000', (sides) => sides)).toBe(100000);
    expect(() => rollKeeperAttribute('3d6*5', () => 0)).toThrow('随机源');
    expect(() => rollKeeperAttribute('3d6*5', () => 7)).toThrow('随机源');
    const card = createKeeperCard('monster');
    card.attributeRolls.str = '(2d6+6)*5';
    expect(getKeeperCardErrors(card)).toEqual([]);
    card.attributeRolls.str = '100d1000*2';
    expect(getKeeperCardErrors(card).join('')).toContain('attributeRolls');
  });
});

describe('derived stats, duplication and batches', () => {
  it.each([
    [64, '-2', -2],
    [65, '-1', -1],
    [84, '-1', -1],
    [85, '0', 0],
    [124, '0', 0],
    [125, '+1d4', 1],
    [164, '+1d4', 1],
    [165, '+1d6', 2],
    [204, '+1d6', 2],
    [205, '+2d6', 3],
    [284, '+2d6', 3],
    [285, '+3d6', 4],
    [875, '+10d6', 11],
  ])('maps STR+SIZ %i to DB %s and build %i', (total, damageBonus, build) => {
    expect(keeperDamageBonus(total, 0)).toEqual({ damageBonus, build });
  });

  it('does not heal or rewrite manual narrative fields during recalculation/reroll', () => {
    const card = createKeeperCard('npc-bystander');
    card.hp = 3;
    card.mp = 2;
    card.notes = '尚未公开的线索';
    card.movement = '跛行 4';
    card.armor = 7;
    const rolled = rerollKeeperCard(card, () => 6);
    expect(rolled).toMatchObject({
      hp: 3,
      maxHp: 18,
      mp: 2,
      maxMp: 18,
      notes: '尚未公开的线索',
      movement: '跛行 4',
      armor: 7,
    });
    expect(card.attributes.str).toBe(52);
    const noCon = createKeeperCard('monster');
    noCon.maxHp = 20;
    noCon.hp = 11;
    expect(deriveKeeperCard(noCon)).toMatchObject({ maxHp: 20, hp: 11 });
  });

  it('deep-copies card data and nested IDs without changing the source/template', () => {
    const original = createKeeperCard('monster-mist-hound');
    const duplicate = duplicateKeeperCard(original, '第二只猎影');
    expect(duplicate.id).not.toBe(original.id);
    expect(duplicate.attacks[0].id).not.toBe(original.attacks[0].id);
    expect(duplicate.skills[0].id).not.toBe(original.skills[0].id);
    duplicate.attributes.str = 1;
    duplicate.attacks[0].name = '改动';
    duplicate.tags.push('额外');
    expect(original.attributes.str).toBe(92);
    expect(original.attacks[0].name).toBe('利爪');
    expect(original.tags).not.toContain('额外');
    original.attributes.str = 2;
    expect(createKeeperCard('monster-mist-hound').attributes.str).toBe(92);
  });

  it('creates up to 200 independently identified cards with predictable numbering', () => {
    const cards = createKeeperBatch('npc-contact', 200, { name: '档案员', startIndex: 3 });
    expect(cards).toHaveLength(200);
    expect(new Set(cards.map((card) => card.id)).size).toBe(200);
    expect(cards[0].name).toBe('档案员 03');
    expect(cards[199].name).toBe('档案员 202');
    expect(parseKeeperCards(exportKeeperCards(cards, 'json'))).toEqual(cards);
  });

  it.each([0, -1, 201, 1.5, Number.NaN])('bounds batch counts (%s)', (count) => {
    expect(() => createKeeperBatch('npc-bystander', count)).toThrow('1–200');
  });
});

describe('keeper portable files and strict validation', () => {
  it.each(['json', 'md'] as const)('round-trips private Unicode fields in %s', (format) => {
    const card = createKeeperCard('monster', { name: '海雾中的 Ω 🎲' });
    card.notes = 'KP 私密：\n**可疑信件**\n```json\n不是真代码块\n```';
    card.specialAbilities = '声音从不同方向传来；先让玩家描述如何追踪。';
    card.attacks = [
      { id: 'attack-1', name: '异响', skill: null, damage: 'KP 裁定', notes: '不自动扣血' },
    ];
    expect(parseKeeperCard(exportKeeperCard(card, format))).toEqual(card);
    const cards = [card, duplicateKeeperCard(card)];
    expect(parseKeeperCards(exportKeeperCards(cards, format))).toEqual(cards);
  });

  it('supports BOM/CRLF, a raw array, and single-card batch import', () => {
    const card = createKeeperCard('npc');
    expect(parseKeeperCard(`\uFEFF${exportKeeperCard(card, 'md').replace(/\n/g, '\r\n')}`)).toEqual(
      card,
    );
    expect(parseKeeperCards(JSON.stringify([card]))).toEqual([card]);
    expect(parseKeeperCards(exportKeeperCard(card, 'json'))).toEqual([card]);
  });

  it('rejects duplicate IDs and more than 200 imported cards', () => {
    const card = createKeeperCard('npc');
    expect(() => exportKeeperCards([card, card], 'json')).toThrow();
    expect(() => parseKeeperCards(JSON.stringify(Array(201).fill(card)))).toThrow();
    expect(() =>
      parseKeeperCard(exportKeeperCards([card, duplicateKeeperCard(card)], 'json')),
    ).toThrow('批量导入');
  });

  it.each([
    (card: KeeperCard) => ({ ...card, schemaVersion: 2 }),
    (card: KeeperCard) => ({ ...card, rule: 'dnd' }),
    (card: KeeperCard) => ({ ...card, name: '   ' }),
    (card: KeeperCard) => ({ ...card, extra: true }),
    (card: KeeperCard) => ({ ...card, kind: 'player' }),
    (card: KeeperCard) => ({ ...card, category: 'human' }),
    (card: KeeperCard) => ({ ...card, attributes: { ...card.attributes, str: -1 } }),
    (card: KeeperCard) => ({ ...card, attributes: { ...card.attributes, str: '150' } }),
    (card: KeeperCard) => ({ ...card, attributes: { ...card.attributes, str: 100001 } }),
    (card: KeeperCard) => ({ ...card, attributes: { str: null } }),
    (card: KeeperCard) => ({ ...card, attributes: { ...card.attributes, luck: 50 } }),
    (card: KeeperCard) => ({ ...card, attributeRolls: { unknown: '3d6' } }),
    (card: KeeperCard) => ({ ...card, hp: 10, maxHp: null }),
    (card: KeeperCard) => ({ ...card, hp: 10, maxHp: 5 }),
    (card: KeeperCard) => ({ ...card, skills: [{ id: 'skill-1', name: '知识', value: 1001 }] }),
    (card: KeeperCard) => ({ ...card, notes: 'x'.repeat(24001) }),
    (card: KeeperCard) => ({ ...card, tags: ['重复', '重复'] }),
    (card: KeeperCard) => ({ ...card, createdAt: 'yesterday' }),
  ])('rejects malformed data without coercing or silently dropping fields', (mutate) => {
    const malformed = mutate(createKeeperCard('monster'));
    expect(getKeeperCardErrors(malformed).length).toBeGreaterThan(0);
    expect(() => parseKeeperCard(JSON.stringify(malformed))).toThrow();
  });

  it('blocks prototype keys and cycles when the schema is used directly by the server', () => {
    const json = exportKeeperCard(createKeeperCard('monster'), 'json');
    const hostile = json.replace('"attributeRolls": {}', '"attributeRolls": {"__proto__": "3d6"}');
    expect(KeeperCardSchema.safeParse(JSON.parse(hostile)).success).toBe(false);
    expect(() => parseKeeperCard(hostile)).toThrow();
    const cycle = createKeeperCard('monster') as unknown as Record<string, unknown>;
    cycle.notes = cycle;
    expect(KeeperCardSchema.safeParse(cycle).success).toBe(false);
  });

  it('rejects ambiguous Markdown, incomplete JSON and oversized files', () => {
    const markdown = exportKeeperCard(createKeeperCard('npc'), 'md');
    expect(() => parseKeeperCard(markdown + markdown)).toThrow('仅有一个');
    expect(() => parseKeeperCard('{"name":')).toThrow('JSON');
    expect(() => parseKeeperCard(' ')).toThrow('为空');
    expect(() => parseKeeperCard(' '.repeat(8_000_001))).toThrow('8000000');
  });

  it('bounds UTF-8 bytes as well as character count for Chinese collections', () => {
    const cards = createKeeperBatch('npc-contact', 150);
    cards.forEach((card) => {
      card.notes = '密'.repeat(24000);
    });
    const json = JSON.stringify(cards);
    expect(json.length).toBeLessThan(8_000_000);
    expect(new TextEncoder().encode(json).byteLength).toBeGreaterThan(8 * 1024 * 1024);
    expect(() => parseKeeperCards(json)).toThrow('8 MiB');
    expect(() => exportKeeperCards(cards, 'json')).toThrow('分批导出');
    expect(() => exportKeeperCards(cards, 'md')).toThrow('分批导出');
  });
});
