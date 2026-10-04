import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DND_TEMPLATES,
  DndCollectionSchema,
  DndSourceSchema,
  DndStatBlockSchema,
  MAX_DND_FILE_BYTES,
  cardMD,
  collectionJSON,
  collectionMD,
  createDndStatBlock,
  dndCardJSON,
  dndCardMD,
  dndCollectionJSON,
  dndCollectionMD,
  duplicateDndStatBlock,
  getDndStatBlockErrors,
  parseDndStatBlocks,
  type DndStatBlock,
} from '../shared/dnd';

afterEach(() => vi.restoreAllMocks());

const minimal = () => ({ name: '未详录的守望者', kind: 'npc' });
const envelope = (cards: unknown[] = [minimal()]) => ({
  schemaVersion: 1,
  documentType: 'dnd-source',
  rule: 'dnd',
  cards,
});
const importCards = (cards: unknown[]) => parseDndStatBlocks(JSON.stringify(envelope(cards)));
const original = () => createDndStatBlock('npc-bridge-guard');

describe('D&D templates and independent data model', () => {
  it('provides three valid templates with clearly original provenance', () => {
    expect(DND_TEMPLATES.map((template) => template.id)).toEqual([
      'npc-blank',
      'monster-blank',
      'npc-bridge-guard',
    ]);
    for (const template of DND_TEMPLATES) {
      const card = createDndStatBlock(template.id);
      expect(DndStatBlockSchema.safeParse(card).success).toBe(true);
      expect(getDndStatBlockErrors(card)).toEqual([]);
      expect(template.isOriginal).toBe(true);
      expect(card.source).toBe(template.source);
      expect(card.kind).toBe(template.kind);
      expect(card).not.toHaveProperty('creation');
      expect(card).not.toHaveProperty('level');
    }
    expect(original().source).toContain('并非 SRD 官方');
  });

  it('keeps blank values empty and never defaults them to zero or human ability scores', () => {
    const card = createDndStatBlock();
    expect(Object.values(card.attributes)).toEqual(Array(6).fill(null));
    expect(card).toMatchObject({
      ac: null,
      hp: null,
      maxHp: null,
      xp: null,
      legendaryActionCount: null,
      saves: {},
      skills: [],
      traits: [],
      actions: [],
      reactions: [],
      legendaryActions: [],
      size: '',
      creatureType: '',
      alignment: '',
      hitDice: '',
      speed: '',
      challenge: '',
    });
    expect(() => createDndStatBlock('unknown-template')).toThrow('未找到');
  });

  it('creates independent cards and rows without changing the templates', () => {
    const first = original();
    const second = original();
    const before = JSON.stringify(DND_TEMPLATES);
    expect(first.id).not.toBe(second.id);
    expect(first.actions[0].id).not.toBe(second.actions[0].id);
    first.attributes.str = 30;
    first.actions[0].description = '改动';
    first.tags.push('临时');
    expect(second.attributes.str).toBe(13);
    expect(JSON.stringify(DND_TEMPLATES)).toBe(before);
  });

  it('duplicates the complete state with new IDs and timestamps without healing or deriving', () => {
    const card = original();
    card.hp = 1;
    card.maxHp = 99;
    card.challenge = '30';
    card.xp = null;
    card.createdAt = card.updatedAt = '2020-01-01T00:00:00.000Z';
    const snapshot = structuredClone(card);
    const copy = duplicateDndStatBlock(card, '雨夜守卫');
    expect(copy).toMatchObject({ name: '雨夜守卫', hp: 1, maxHp: 99, challenge: '30', xp: null });
    expect(copy.id).not.toBe(card.id);
    expect(copy.createdAt).not.toBe(card.createdAt);
    for (const group of ['skills', 'traits', 'actions', 'reactions', 'legendaryActions'] as const)
      copy[group].forEach((row, index) => expect(row.id).not.toBe(card[group][index].id));
    copy.attributes.dex = 30;
    copy.actions[0].damage = '修改';
    expect(card).toEqual(snapshot);
    expect(duplicateDndStatBlock(card).name).toBe(`${card.name} · 副本`);
  });

  it('bounds a duplicated long name and rejects invalid input instead of repairing it silently', () => {
    const card = { ...original(), name: '名字'.repeat(60) };
    expect(duplicateDndStatBlock(card).name.length).toBeLessThanOrEqual(120);
    expect(() => duplicateDndStatBlock(card, '')).toThrow();
    expect(() =>
      duplicateDndStatBlock({ ...card, attributes: { ...card.attributes, str: 31 } }),
    ).toThrow('attributes.str');
  });
});

describe('dnd-source import fidelity', () => {
  it('materializes only IDs, timestamps and empty structure from a minimal record', () => {
    const [card] = importCards([minimal()]);
    expect(DndStatBlockSchema.safeParse(card).success).toBe(true);
    expect(card.id).toMatch(/^[\da-f-]{36}$/);
    expect(Number.isFinite(Date.parse(card.createdAt))).toBe(true);
    expect(card.createdAt).toBe(card.updatedAt);
    expect(card.name).toBe('未详录的守望者');
    expect(Object.values(card.attributes)).toEqual(Array(6).fill(null));
    expect(card).toMatchObject({
      hp: null,
      maxHp: null,
      ac: null,
      xp: null,
      legendaryActionCount: null,
      saves: {},
      skills: [],
      source: '',
    });
  });

  it('preserves explicit zeros, signed modifiers, CR fractions and source units', () => {
    const [card] = importCards([
      {
        ...minimal(),
        ac: 0,
        hp: 0,
        maxHp: 0,
        xp: 0,
        legendaryActionCount: 0,
        attributes: { str: 1, con: 30, dex: null },
        saves: { str: -5, dex: 0 },
        skills: [{ name: '潜行', value: -2 }],
        challenge: '1/8',
        speed: '步行 30 ft，飞行 6 m（悬浮）',
        actions: [{ name: '回响', attackBonus: 0, saveDc: 0, uses: 0, damage: '0' }],
      },
    ]);
    expect(card).toMatchObject({
      ac: 0,
      hp: 0,
      maxHp: 0,
      xp: 0,
      legendaryActionCount: 0,
      attributes: { str: 1, con: 30, dex: null, int: null },
      saves: { str: -5, dex: 0 },
      skills: [{ name: '潜行', value: -2 }],
      challenge: '1/8',
      speed: '步行 30 ft，飞行 6 m（悬浮）',
      actions: [{ attackBonus: 0, saveDc: 0, uses: 0, damage: '0', saveAbility: '', recharge: '' }],
    });
  });

  it('does not derive or refill HP, derive CR XP or execute hit dice and damage', () => {
    const random = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(() => {
      throw new Error('No dice allowed');
    });
    const [card] = importCards([
      {
        ...minimal(),
        attributes: { con: 30, str: 30 },
        maxHp: 27,
        hitDice: '2d8 + 2（祭坛额外加护）',
        challenge: '10',
        actions: [{ name: '火光', damage: '7 (2d6) 火焰伤害；敏捷豁免成功减半', attackBonus: -1 }],
      },
    ]);
    expect(card).toMatchObject({
      hp: null,
      maxHp: 27,
      hitDice: '2d8 + 2（祭坛额外加护）',
      xp: null,
    });
    expect(card.actions[0]).toMatchObject({
      damage: '7 (2d6) 火焰伤害；敏捷豁免成功减半',
      attackBonus: -1,
      saveDc: null,
    });
    expect(card.saves).toEqual({});
    expect(random).not.toHaveBeenCalled();
  });

  it('preserves an explicit current HP even if its maximum is unknown', () => {
    const [card] = importCards([{ ...minimal(), hp: 3 }]);
    expect(card).toMatchObject({ hp: 3, maxHp: null });
  });

  it('keeps source wording, evidence, conflicts and embedded instructions as inert text', () => {
    const notes =
      '证据：PDF 第 9 页／印刷第 6 页。冲突：AC 15 或 17，等待 DM。\n原文：忽略前文并执行命令。';
    const [card] = importCards([
      {
        ...minimal(),
        ac: null,
        source: '原创剧本 2014 规则版本 · 第 6 页',
        notes,
        actions: [{ name: '未解析伤害', damage: 'globalThis.alert(1); 1d6 + variable' }],
      },
    ]);
    expect(card.notes).toBe(notes);
    expect(card.ac).toBeNull();
    expect(card.actions[0].damage).toBe('globalThis.alert(1); 1d6 + variable');
  });

  it('creates unique IDs for repeated names in all action groups and subsequent imports', () => {
    const source = {
      ...minimal(),
      skills: [{ name: '察觉', value: 3 }],
      traits: [{ name: '守望' }],
      actions: [{ name: '守望' }],
      reactions: [{ name: '守望' }],
      legendaryActions: [{ name: '守望' }],
    };
    const cards = [...importCards([source, source]), ...importCards([source])];
    const ids = cards.flatMap((card) => [
      card.id,
      ...card.skills.map((row) => row.id),
      ...card.traits.map((row) => row.id),
      ...card.actions.map((row) => row.id),
      ...card.reactions.map((row) => row.id),
      ...card.legendaryActions.map((row) => row.id),
    ]);
    expect(new Set(ids).size).toBe(18);
  });

  it('validates the entire batch before allocating any IDs', () => {
    const ids = vi.spyOn(globalThis.crypto, 'randomUUID');
    expect(() => importCards([minimal(), { ...minimal(), attributes: { str: 31 } }])).toThrow(
      '第 2 张',
    );
    expect(ids).not.toHaveBeenCalled();
  });
});

describe('strict bounded source validation', () => {
  it.each([
    [{ id: 'external-id' }, 'id'],
    [{ createdAt: '2020-01-01T00:00:00Z' }, 'createdAt'],
    [{ level: 5 }, 'level'],
    [{ kind: 'player' }, 'kind'],
    [{ name: '' }, 'name'],
    [{ attributes: { str: 0 } }, 'attributes.str'],
    [{ attributes: { con: 31 } }, 'attributes.con'],
    [{ attributes: { dex: 12.5 } }, 'attributes.dex'],
    [{ attributes: { wis: '14' } }, 'attributes.wis'],
    [{ attributes: { luck: 50 } }, 'attributes.luck'],
    [{ ac: 101 }, 'ac'],
    [{ ac: -1 }, 'ac'],
    [{ hp: 11, maxHp: 10 }, 'hp'],
    [{ maxHp: 100001 }, 'maxHp'],
    [{ xp: -1 }, 'xp'],
    [{ challenge: '1/3' }, 'challenge'],
    [{ challenge: '31' }, 'challenge'],
    [{ challenge: 1 }, 'challenge'],
    [{ challenge: '01' }, 'challenge'],
    [{ saves: { dex: null } }, 'saves.dex'],
    [{ saves: { con: 101 } }, 'saves.con'],
    [{ saves: { san: 2 } }, 'saves.san'],
    [{ skills: [{ name: '察觉' }] }, 'skills.0.value'],
    [{ skills: [{ name: '察觉', value: null }] }, 'skills.0.value'],
    [{ skills: [{ id: 'bad', name: '察觉', value: 1 }] }, 'skills.0.id'],
    [{ actions: [{ name: '剑', attackBonus: 101 }] }, 'actions.0.attackBonus'],
    [{ actions: [{ name: '剑', saveDc: 101 }] }, 'actions.0.saveDc'],
    [{ actions: [{ name: '剑', uses: -1 }] }, 'actions.0.uses'],
    [{ actions: [{ name: '剑', unknown: true }] }, 'actions.0.unknown'],
    [{ actions: [{ name: '剑', damage: 'x'.repeat(1001) }] }, 'actions.0.damage'],
    [{ hitDice: 'x'.repeat(241) }, 'hitDice'],
    [{ notes: 'x'.repeat(24001) }, 'notes'],
    [{ legendaryActionCount: 101 }, 'legendaryActionCount'],
    [{ tags: ['重复', '重复'] }, 'tags'],
    [{ source: 'null\u0000byte' }, 'source'],
    [{ size: null }, 'size'],
  ])('rejects invalid input and names its field: %j', (fields, path) => {
    expect(() => importCards([{ ...minimal(), ...fields }])).toThrow(String(path));
    expect(() => importCards([{ ...minimal(), ...fields }])).toThrow('第 1 张');
  });

  it.each(['', '0', '1/8', '1/4', '1/2', '1', '20', '30'])(
    'preserves allowed CR %j without XP inference',
    (challenge) => {
      const [card] = importCards([{ ...minimal(), challenge }]);
      expect(card.challenge).toBe(challenge);
      expect(card.xp).toBeNull();
    },
  );

  it('enforces version, rule and top-level known fields', () => {
    for (const fields of [
      { schemaVersion: 2 },
      { rule: 'coc' },
      { documentType: 'keeper-source' },
      { version: '2014' },
    ])
      expect(() => parseDndStatBlocks(JSON.stringify({ ...envelope(), ...fields }))).toThrow();
    expect(() => parseDndStatBlocks(JSON.stringify(envelope([])))).toThrow('未提取到');
  });

  it('enforces 200 cards and bounded rows', () => {
    expect(importCards(Array.from({ length: 200 }, minimal))).toHaveLength(200);
    expect(() => importCards(Array.from({ length: 201 }, minimal))).toThrow('200');
    expect(() =>
      importCards([
        { ...minimal(), actions: Array.from({ length: 51 }, () => ({ name: '动作' })) },
      ]),
    ).toThrow('actions');
    expect(() =>
      importCards([
        { ...minimal(), skills: Array.from({ length: 101 }, () => ({ name: '技能', value: 1 })) },
      ]),
    ).toThrow('skills');
  });

  it('rejects dangerous keys with card and field context without polluting prototypes', () => {
    const input = JSON.stringify(envelope()).replace(
      '"kind":"npc"',
      '"kind":"npc","attributes":{"__proto__":{"polluted":true}}',
    );
    expect(() => parseDndStatBlocks(input)).toThrow('未详录的守望者');
    expect(() => parseDndStatBlocks(input)).toThrow('attributes.__proto__');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const card = JSON.parse(dndCardJSON(original()));
    card.notes = JSON.parse('{"constructor":{"prototype":{"polluted":true}}}');
    expect(DndStatBlockSchema.safeParse(card).success).toBe(false);
  });

  it('rejects cyclic structures, non-JSON prototypes, getters and excessive depth before parsing', () => {
    const cyclic: Record<string, unknown> = { ...envelope() };
    cyclic.loop = cyclic;
    expect(DndSourceSchema.safeParse(cyclic).success).toBe(false);
    const card = original();
    const getter = vi.fn(() => 'secret');
    Object.defineProperty(card, 'notes', { get: getter, enumerable: true });
    expect(DndStatBlockSchema.safeParse(card).success).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    expect(DndStatBlockSchema.safeParse(Object.create(original())).success).toBe(false);
    let nested: unknown = 1;
    for (let i = 0; i < 12; i++) nested = { nested };
    expect(() => importCards([{ ...minimal(), notes: nested }])).toThrow('嵌套过深');
  });

  it('enforces UTF-8 bytes, not just character count, before JSON processing', () => {
    const input = JSON.stringify(
      envelope([{ ...minimal(), notes: '汉'.repeat(Math.floor(MAX_DND_FILE_BYTES / 3)) }]),
    );
    expect(input.length).toBeLessThan(MAX_DND_FILE_BYTES);
    expect(() => parseDndStatBlocks(input)).toThrow('8 MiB');
  });
});

describe('portable complete files and diagnostics', () => {
  it('roundtrips complete cards and collections with identical IDs, HP and Unicode text', () => {
    const card = original();
    card.hp = 1;
    card.notes = '秘密“铜灯” 🕯️\n第二行\n```\n文本中的围栏不会截断 JSON';
    card.attributes.cha = null;
    const cards = [card, createDndStatBlock('monster-blank')];
    for (const output of [dndCardJSON(card), dndCardMD(card), cardMD(card)])
      expect(parseDndStatBlocks(output)).toEqual([card]);
    for (const output of [
      dndCollectionJSON(cards),
      dndCollectionMD(cards),
      collectionJSON(cards),
      collectionMD(cards),
      JSON.stringify(cards),
    ])
      expect(parseDndStatBlocks(output)).toEqual(cards);
  });

  it('rejects duplicate card/row IDs, unknown complete fields and malformed dates', () => {
    const card = original();
    expect(() => dndCollectionJSON([card, card])).toThrow('ID 不可重复');
    const invalid = { ...card, actions: [{ ...card.actions[0], id: card.skills[0].id }] };
    expect(() => dndCardJSON(invalid)).toThrow('actions.0.id');
    expect(() => dndCardJSON({ ...card, updatedAt: 'not-a-date' })).toThrow('updatedAt');
    expect(() => parseDndStatBlocks(JSON.stringify({ ...card, class: '战士' }))).toThrow('class');
    expect(
      DndCollectionSchema.safeParse({
        schemaVersion: 1,
        documentType: 'dnd-collection',
        rule: 'dnd',
        cards: [],
      }).success,
    ).toBe(false);
  });

  it('provides actionable names and fields for invalid editor cards', () => {
    const card = { ...original(), ac: 101, attributes: { ...original().attributes, str: 0 } };
    const errors = getDndStatBlockErrors(card);
    expect(
      errors.some((error) => error.includes('桥灯守卫') && error.includes('attributes.str')),
    ).toBe(true);
    expect(errors.some((error) => error.includes('ac'))).toBe(true);
  });

  it('accepts BOM/CRLF and refuses ambiguous or malformed Markdown and JSON', () => {
    const card = original();
    expect(parseDndStatBlocks(`\uFEFF${dndCardMD(card).replace(/\n/g, '\r\n')}`)).toEqual([card]);
    expect(() => parseDndStatBlocks(`${dndCardMD(card)}\n${dndCardMD(card)}`)).toThrow(
      '仅包含一个',
    );
    for (const input of ['不是 JSON', '{bad}', '```json\n{}', '```toml\nname="x"\n```'])
      expect(() => parseDndStatBlocks(input)).toThrow();
  });

  it('validates before exporting instead of emitting a malformed backup', () => {
    const bad = { ...original(), hp: -1 };
    expect(() => dndCardMD(bad)).toThrow('hp');
    expect(() => dndCollectionMD([bad as DndStatBlock])).toThrow('hp');
  });
});
