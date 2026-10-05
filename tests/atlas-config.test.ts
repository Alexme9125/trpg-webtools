import { describe, it, expect } from 'vitest';
import {
  ATLAS_IMPORT_TEMPLATE,
  ATLAS_EXTRACTION_PROMPT,
  ATLAS_SOURCE_EXAMPLE,
} from '../shared/atlas-guide';
import {
  createAtlas,
  duplicateAtlas,
  exportAtlases,
  mergeAtlases,
  parseAtlases,
  MAX_ATLAS_BYTES,
  AtlasSchema,
} from '../shared/atlas';
import {
  defaultCreationPolicy,
  CreationPolicySchema,
  suggestAllocation,
  syncAllocation,
  validateCreation,
} from '../shared/creation';
import { parseRoomConfig, exportRoomConfig, type RoomConfig } from '../shared/room-config';
import { preparedCharacter } from './fixtures/adjustment-character';
import { decodeImage } from '../server/images';
import { MAX_IMAGE_BYTES } from '../shared/media';

const config = (): RoomConfig => ({
  documentType: 'interlude-room-config',
  schemaVersion: 1,
  name: '测试',
  rule: 'coc',
  mode: 'external',
  scene: { title: '码头', description: '雾' },
  creationPolicy: defaultCreationPolicy('coc'),
});
describe('portable atlas source and library', () => {
  it('imports the actual example and prompt, resolves several maps and scenes with private notes intact', () => {
    const [atlas] = parseAtlases(ATLAS_IMPORT_TEMPLATE);
    expect(atlas.maps).toHaveLength(2);
    expect(atlas.scenes).toHaveLength(3);
    expect(atlas.scenes[0].mapId).toBe(atlas.maps[0].id);
    expect(atlas.scenes[1].mapId).toBe(atlas.maps[0].id);
    expect(atlas.scenes[2].mapId).toBe(atlas.maps[1].id);
    expect(atlas.scenes[1].keeperNotes).toContain('秘密');
    expect(parseAtlases(ATLAS_EXTRACTION_PROMPT)).toHaveLength(1);
  });
  it('supports a scene-only collection and omitted optional fields', () => {
    const [a] = parseAtlases(
      JSON.stringify({
        documentType: 'atlas-source',
        schemaVersion: 1,
        atlases: [{ name: '独立场景', scenes: [{ title: '梦境' }] }],
      }),
    );
    expect(a.rule).toBe('any');
    expect(a.maps).toEqual([]);
    expect(a.scenes[0]).toMatchObject({
      mapId: null,
      description: '',
      keeperNotes: '',
      source: '',
      tags: [],
    });
  });
  it.each(['md', 'json'] as const)('round trips %s, including code fences in notes', (format) => {
    const a = parseAtlases(ATLAS_IMPORT_TEMPLATE)[0];
    a.scenes[0].keeperNotes = 'line\n```json\n{}\n```\nend';
    expect(parseAtlases(exportAtlases([a], format))).toEqual([a]);
  });
  it('duplicates nested map/scene IDs without retaining mutable references', () => {
    const a = parseAtlases(ATLAS_IMPORT_TEMPLATE)[0],
      b = duplicateAtlas(a);
    expect(b.id).not.toBe(a.id);
    expect(b.maps[0].id).not.toBe(a.maps[0].id);
    expect(b.scenes[0].mapId).toBe(b.maps[0].id);
    expect(b.scenes[0].id).not.toBe(a.scenes[0].id);
    b.scenes[0].keeperNotes = 'changed';
    expect(a.scenes[0].keeperNotes).not.toBe('changed');
  });
  it.each(['duplicate', 'dangling', 'unknown', 'wrong-version'])(
    'refuses %s input atomically',
    (problem) => {
      const raw = structuredClone(ATLAS_SOURCE_EXAMPLE);
      if (problem === 'duplicate') raw.atlases[0].maps[1].key = 'harbour';
      if (problem === 'dangling') raw.atlases[0].scenes[0].mapKey = 'absent';
      if (problem === 'unknown') Object.assign(raw.atlases[0].scenes[0], { script: 'bad' });
      if (problem === 'wrong-version') raw.schemaVersion = 2;
      expect(() => parseAtlases(JSON.stringify(raw))).toThrow();
    },
  );
  it('rejects ambiguous JSON blocks, unsafe keys and oversized files', () => {
    expect(() => parseAtlases(ATLAS_IMPORT_TEMPLATE + ATLAS_IMPORT_TEMPLATE)).toThrow('一个完整');
    expect(() => parseAtlases('{"__proto__": {}}')).toThrow('键名');
    expect(() => parseAtlases('x'.repeat(MAX_ATLAS_BYTES + 1))).toThrow('文件过大');
  });
  it('rejects 301 scenes and a 51st map', () => {
    const a = parseAtlases(ATLAS_IMPORT_TEMPLATE)[0];
    expect(
      AtlasSchema.safeParse({
        ...a,
        scenes: Array.from({ length: 301 }, (_, i) => ({ ...a.scenes[0], id: `s${i}` })),
      }).success,
    ).toBe(false);
    expect(
      AtlasSchema.safeParse({
        ...a,
        maps: Array.from({ length: 51 }, (_, i) => ({ ...a.maps[0], id: `m${i}` })),
      }).success,
    ).toBe(false);
  });
  it('updates a full library while rejecting additional or duplicate atlases without mutation', () => {
    const a = createAtlas(),
      all = Array.from({ length: 50 }, (_, i) => ({ ...a, id: `atlas-${i}` }));
    const snapshot = structuredClone(all);
    expect(mergeAtlases(all, [{ ...all[0], name: '更新' }])[0].name).toBe('更新');
    expect(() => mergeAtlases(all, [createAtlas()])).toThrow();
    expect(() => mergeAtlases(all, [a, a])).toThrow();
    expect(all).toEqual(snapshot);
  });
});
describe('large portable atlas files', () => {
  it.each(['json', 'md'] as const)('keeps a near-capacity %s export re-importable', (format) => {
    const scene = parseAtlases(ATLAS_IMPORT_TEMPLATE)[0].scenes[0];
    const base = createAtlas();
    const atlases = Array.from({ length: 50 }, (_, i) => ({
      ...base,
      id: `atlas-${i}`,
      scenes: Array.from({ length: 300 }, (_, j) => ({
        ...scene,
        id: `scene-${j}`,
        mapId: null,
        title: '场景',
        description: '',
        source: '',
        tags: [],
        keeperNotes: 'x'.repeat(390),
      })),
    }));
    expect(
      new TextEncoder().encode(
        JSON.stringify(
          { documentType: 'interlude-atlas-library', schemaVersion: 1, atlases },
          null,
          2,
        ),
      ).byteLength,
    ).toBeGreaterThan(MAX_ATLAS_BYTES);
    const exported = exportAtlases(atlases, format);
    expect(new TextEncoder().encode(exported).byteLength).toBeLessThanOrEqual(MAX_ATLAS_BYTES);
    expect(parseAtlases(exported)).toEqual(atlases);
  });
});

describe('room configuration and dedicated skill pools', () => {
  it.each(['md', 'json'] as const)('round trips all configuration values through %s', (format) => {
    const c = config();
    c.creationPolicy.allowInterestOnOccupation = false;
    c.creationPolicy.ranges = [{ field: 'attributeTotal', min: 300, max: 500 }];
    c.creationPolicy.notes = '秘密?\n```\n仅配置备注';
    expect(parseRoomConfig(exportRoomConfig(c, format))).toEqual(c);
  });
  it('rejects rule mismatch, unknown credential fields and invalid bounds', () => {
    expect(() => parseRoomConfig(JSON.stringify({ ...config(), rule: 'dnd' }))).toThrow();
    expect(() => parseRoomConfig(JSON.stringify({ ...config(), token: 'secret' }))).toThrow();
    const c = config();
    c.creationPolicy.ranges = [{ field: 'attributes.str', min: 80, max: 30 }];
    expect(() => parseRoomConfig(JSON.stringify(c))).toThrow();
  });
  it('defaults a legacy policy to allowing interest on occupational skills', () => {
    const c = config();
    delete (c.creationPolicy as Partial<typeof c.creationPolicy>).allowInterestOnOccupation;
    expect(CreationPolicySchema.parse(c.creationPolicy).allowInterestOnOccupation).toBe(true);
    expect(parseRoomConfig(JSON.stringify(c)).creationPolicy.allowInterestOnOccupation).toBe(true);
  });
  it('rejects occupational interest and credit investments only when the host disables them', () => {
    let card = preparedCharacter('coc');
    if (card.creation?.rule !== 'coc') throw new Error();
    const key = card.creation.occupationSkills[0];
    card.creation.personal = { [key]: 1, creditRating: 1 };
    card = syncAllocation(card);
    const normal = defaultCreationPolicy('coc'),
      strict = { ...normal, allowInterestOnOccupation: false };
    expect(validateCreation(card, normal).some((e) => e.includes('兴趣点不能用于职业技能'))).toBe(
      false,
    );
    expect(
      validateCreation(card, strict).filter((e) => e.includes('兴趣点不能用于职业技能')),
    ).toHaveLength(2);
  });
  it('keeps suggested allocations legal with separate pools without losing the interest budget', () => {
    const policy = { ...defaultCreationPolicy('coc'), allowInterestOnOccupation: false };
    const card = suggestAllocation(preparedCharacter('coc'), policy);
    expect(validateCreation(card, policy)).toEqual([]);
    if (card.creation?.rule !== 'coc') throw new Error();
    const a = card.creation;
    expect(a.occupationSkills.every((key) => !(a.personal[key] > 0))).toBe(true);
    expect(Object.values(a.personal).reduce((a, b) => a + b, 0)).toBe(2 * card.attributes.int);
  });
});
describe('bounded raster image decoding', () => {
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6szsAAAAASUVORK5CYII=';
  it('accepts actual PNG bytes and refuses renamed active content', () => {
    expect(decodeImage(png, 'image/png').length).toBeGreaterThan(24);
    expect(() => decodeImage(Buffer.from('<svg></svg>').toString('base64'), 'image/png')).toThrow(
      '内容',
    );
    expect(() => decodeImage(png, 'image/jpeg')).toThrow('内容');
  });
  it('rejects malformed base64 and oversized content without recursion failure', () => {
    expect(() => decodeImage(png + '!', 'image/png')).toThrow();
    expect(() => decodeImage('AA=A', 'image/png')).toThrow();
    const bytes = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    expect(() => decodeImage(bytes.toString('base64'), 'image/png')).toThrow('8 MiB');
    expect(() =>
      decodeImage(Buffer.alloc(MAX_IMAGE_BYTES).toString('base64'), 'image/png'),
    ).toThrow('格式');
  });
});
