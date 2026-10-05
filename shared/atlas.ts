import { z } from 'zod';
import { parsePortable, portableMarkdown } from './portable';

export const MAX_ATLAS_BYTES = 8 * 1024 * 1024;
export const MAX_ATLASES = 50;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const name = z.string().trim().min(1).max(100);
const description = z.string().max(4000);
const notes = z.string().max(8000);
const source = z.string().max(2000);
const tags = z.array(z.string().trim().min(1).max(40)).max(12);
const rule = z.enum(['any', 'coc', 'dnd']);
export const AtlasMapSchema = z.object({ id, name, description, keeperNotes: notes }).strict();
export const AtlasSceneSchema = z
  .object({
    id,
    mapId: id.nullable(),
    title: name,
    description,
    keeperNotes: notes,
    source,
    tags,
  })
  .strict();
export const AtlasSchema = z
  .object({
    documentType: z.literal('interlude-atlas'),
    schemaVersion: z.literal(1),
    id,
    rule,
    name,
    summary: description,
    source,
    maps: z.array(AtlasMapSchema).max(50),
    scenes: z.array(AtlasSceneSchema).max(300),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((atlas, ctx) => {
    const maps = new Set(atlas.maps.map((m) => m.id));
    if (
      maps.size !== atlas.maps.length ||
      new Set(atlas.scenes.map((s) => s.id)).size !== atlas.scenes.length
    )
      ctx.addIssue({ code: 'custom', message: '地图或场景编号重复' });
    if (atlas.scenes.some((s) => s.mapId !== null && !maps.has(s.mapId)))
      ctx.addIssue({ code: 'custom', message: '场景引用了不存在的地图' });
  });
export type Atlas = z.infer<typeof AtlasSchema>;
export type AtlasMap = z.infer<typeof AtlasMapSchema>;
export type AtlasScene = z.infer<typeof AtlasSceneSchema>;

export const AtlasLibrarySchema = z
  .array(AtlasSchema)
  .max(MAX_ATLASES)
  .superRefine((items, ctx) => {
    if (new Set(items.map((a) => a.id)).size !== items.length)
      ctx.addIssue({ code: 'custom', message: '地图册编号重复' });
    if (new TextEncoder().encode(JSON.stringify(items)).byteLength > MAX_ATLAS_BYTES - 2048)
      ctx.addIssue({ code: 'custom', message: '地图集总量不能超过 8 MiB，请拆分整理' });
  });
const SourceAtlasSchema = z
  .object({
    name,
    rule: rule.default('any'),
    summary: description.default(''),
    source: source.default(''),
    maps: z
      .array(
        z
          .object({
            key: id,
            name,
            description: description.default(''),
            keeperNotes: notes.default(''),
          })
          .strict(),
      )
      .max(50)
      .default([]),
    scenes: z
      .array(
        z
          .object({
            mapKey: id.nullable().default(null),
            title: name,
            description: description.default(''),
            keeperNotes: notes.default(''),
            source: source.default(''),
            tags: tags.default([]),
          })
          .strict(),
      )
      .max(300)
      .default([]),
  })
  .strict()
  .superRefine((a, ctx) => {
    const keys = new Set(a.maps.map((m) => m.key));
    if (keys.size !== a.maps.length) ctx.addIssue({ code: 'custom', message: '地图 key 不能重复' });
    if (a.scenes.some((s) => s.mapKey !== null && !keys.has(s.mapKey)))
      ctx.addIssue({ code: 'custom', message: '场景 mapKey 没有对应地图' });
  });
const SourceSchema = z
  .object({
    documentType: z.literal('atlas-source'),
    schemaVersion: z.literal(1),
    atlases: z.array(SourceAtlasSchema).min(1).max(MAX_ATLASES),
  })
  .strict();
const BundleSchema = z
  .object({
    documentType: z.literal('interlude-atlas-library'),
    schemaVersion: z.literal(1),
    atlases: AtlasLibrarySchema.min(1),
  })
  .strict();
export function createAtlas(): Atlas {
  const date = new Date().toISOString();
  return {
    documentType: 'interlude-atlas',
    schemaVersion: 1,
    id: crypto.randomUUID(),
    rule: 'any',
    name: '未命名地图册',
    summary: '',
    source: '',
    maps: [],
    scenes: [],
    createdAt: date,
    updatedAt: date,
  };
}
export function duplicateAtlas(atlas: Atlas): Atlas {
  const next = structuredClone(atlas);
  const ids = new Map(next.maps.map((m) => [m.id, crypto.randomUUID()]));
  next.id = crypto.randomUUID();
  next.maps.forEach((m) => {
    m.id = ids.get(m.id)!;
  });
  next.scenes.forEach((s) => {
    s.id = crypto.randomUUID();
    s.mapId = s.mapId ? ids.get(s.mapId)! : null;
  });
  next.createdAt = next.updatedAt = new Date().toISOString();
  return next;
}
export function parseAtlases(text: string): Atlas[] {
  const raw = parsePortable(text, MAX_ATLAS_BYTES);
  const kind = raw && typeof raw === 'object' && 'documentType' in raw ? raw.documentType : '';
  if (kind === 'atlas-source') {
    const parsed = SourceSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`地图来源文件无效：${parsed.error.issues[0]?.message}`);
    return AtlasLibrarySchema.parse(
      parsed.data.atlases.map((a) => {
        const maps = a.maps.map((m) => ({
          id: crypto.randomUUID(),
          name: m.name,
          description: m.description,
          keeperNotes: m.keeperNotes,
        }));
        const ids = new Map(a.maps.map((m, i) => [m.key, maps[i].id]));
        return {
          ...createAtlas(),
          ...a,
          maps,
          scenes: a.scenes.map(({ mapKey, ...s }) => ({
            ...s,
            id: crypto.randomUUID(),
            mapId: mapKey ? ids.get(mapKey)! : null,
          })),
        };
      }),
    );
  }
  const parsed =
    kind === 'interlude-atlas' ? AtlasSchema.safeParse(raw) : BundleSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`地图集文件无效：${parsed.error.issues[0]?.message}`);
  return 'atlases' in parsed.data ? parsed.data.atlases : [parsed.data];
}
export function exportAtlases(atlases: Atlas[], format: 'json' | 'md') {
  const bundle = BundleSchema.parse({
    documentType: 'interlude-atlas-library',
    schemaVersion: 1,
    atlases,
  });
  const note = '包含主持人笔记，请保留给主持人。场景可在房间内选择公布。';
  const pretty =
    format === 'json'
      ? JSON.stringify(bundle, null, 2)
      : portableMarkdown('地图册与场景集', bundle, note);
  // Formatting must never make a valid full library too large to import again.
  if (new TextEncoder().encode(pretty).byteLength <= MAX_ATLAS_BYTES) return pretty;
  return format === 'json'
    ? JSON.stringify(bundle)
    : portableMarkdown('地图册与场景集', bundle, note, 0);
}
export function mergeAtlases(existing: Atlas[], incoming: Atlas[]): Atlas[] {
  const current = AtlasLibrarySchema.parse(existing);
  const additions = AtlasLibrarySchema.parse(incoming);
  const merged = new Map(current.map((a) => [a.id, a]));
  additions.forEach((a) => merged.set(a.id, a));
  const result = AtlasLibrarySchema.safeParse([...merged.values()]);
  if (!result.success) throw new Error(`地图集未保存：${result.error.issues[0]?.message}`);
  return result.data;
}
