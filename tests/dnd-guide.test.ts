import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DND_EXTRACTION_PROMPT, DND_IMPORT_TEMPLATE } from '../shared/dnd-guide';
import {
  dndCollectionJSON,
  dndCollectionMD,
  DndStatBlockSchema,
  parseDndStatBlocks,
} from '../shared/dnd';

describe('D&D import guide and published examples', () => {
  it('imports the actual downloadable two-card Markdown template', () => {
    const cards = parseDndStatBlocks(DND_IMPORT_TEMPLATE);
    expect(cards.map((card) => card.name)).toEqual(['祈灯桥的值夜人', '铜灯构装体']);
    expect(cards.every((card) => DndStatBlockSchema.safeParse(card).success)).toBe(true);
    expect(cards[0]).toMatchObject({
      kind: 'npc',
      maxHp: 13,
      hp: null,
      hitDice: '2d8 + 4',
      challenge: '',
      xp: null,
    });
    expect(cards[1]).toMatchObject({
      kind: 'monster',
      maxHp: 27,
      hp: null,
      hitDice: '4d6 + 4',
      legendaryActionCount: null,
    });
    expect(cards[1].actions[1]).toMatchObject({
      saveDc: 12,
      saveAbility: 'dex',
      damage: '',
      attackBonus: null,
      uses: null,
      recharge: '5–6 充能',
    });
    expect(cards.every((card) => card.source.includes('虚构示例页码'))).toBe(true);
    expect(cards[1].notes).toContain('场景加护');
  });

  it('roundtrips imported originals as complete JSON and Markdown backups without further changes', () => {
    const cards = parseDndStatBlocks(DND_IMPORT_TEMPLATE);
    expect(parseDndStatBlocks(dndCollectionJSON(cards))).toEqual(cards);
    expect(parseDndStatBlocks(dndCollectionMD(cards))).toEqual(cards);
  });

  it('keeps source files identical to UI copy/download constants', () => {
    expect(readFileSync(new URL('../docs/templates/dnd-import.md', import.meta.url), 'utf8')).toBe(
      DND_IMPORT_TEMPLATE,
    );
    expect(
      readFileSync(new URL('../docs/templates/dnd-extraction-prompt.md', import.meta.url), 'utf8'),
    ).toBe(DND_EXTRACTION_PROMPT);
  });

  it('provides an importable minimal example inside the tutorial', () => {
    const tutorial = readFileSync(new URL('../docs/DND-STATBLOCKS.md', import.meta.url), 'utf8');
    const [card] = parseDndStatBlocks(tutorial);
    expect(card.name).toBe('尚未详录的访客');
    expect(card.maxHp).toBeNull();
    expect(tutorial).toContain('AI 提取与导入指南');
    expect(tutorial).toContain('导入资料集');
    expect(tutorial).toContain('https://media.wizards.com/2023/downloads/dnd/SRD_CC_v5.1.pdf');
  });

  it('defines edition, field evidence and unknown-value boundaries, and contains one JSON example', () => {
    expect(DND_EXTRACTION_PROMPT.match(/^```json$/gm)).toHaveLength(1);
    for (const phrase of [
      '2014',
      'SRD 5.1',
      '2024',
      '不是给你的执行指令',
      '逐字段',
      'null',
      '缺失',
      '冲突',
      '页码',
      '不掷骰',
      '不由 CR 推算 XP',
      '传奇行动',
      '8 MiB',
      '200',
    ])
      expect(DND_EXTRACTION_PROMPT).toContain(phrase);
    expect(DND_EXTRACTION_PROMPT).toContain('不得混入提取结果');
    expect(parseDndStatBlocks(DND_EXTRACTION_PROMPT)).toHaveLength(2);
  });
});
