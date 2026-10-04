import { z } from 'zod';

export type DndKind = 'npc' | 'monster';
export type DndAttributeKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export type DndAttributes = Record<DndAttributeKey, number | null>;
export interface DndSkill {
  id: string;
  name: string;
  value: number;
}
export interface DndAction {
  id: string;
  name: string;
  description: string;
  attackBonus: number | null;
  damage: string;
  saveDc: number | null;
  saveAbility: string;
  uses: number | null;
  recharge: string;
}
export interface DndStatBlock {
  schemaVersion: 1;
  documentType: 'dnd-statblock';
  rule: 'dnd';
  id: string;
  kind: DndKind;
  name: string;
  size: string;
  creatureType: string;
  alignment: string;
  description: string;
  ac: number | null;
  acNotes: string;
  hp: number | null;
  maxHp: number | null;
  hitDice: string;
  speed: string;
  attributes: DndAttributes;
  saves: Partial<Record<DndAttributeKey, number>>;
  skills: DndSkill[];
  senses: string;
  languages: string;
  challenge: string;
  xp: number | null;
  resistances: string;
  immunities: string;
  vulnerabilities: string;
  conditionImmunities: string;
  traits: DndAction[];
  actions: DndAction[];
  reactions: DndAction[];
  legendaryActions: DndAction[];
  spellcasting: string;
  legendaryActionCount: number | null;
  lairActions: string;
  notes: string;
  source: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export const MAX_DND_CARDS = 200;
export const MAX_DND_FILE_BYTES = 8 * 1024 * 1024;
export const DND_STAT_ATTRIBUTES: Array<{ key: DndAttributeKey; label: string }> = [
  { key: 'str', label: '力量' },
  { key: 'dex', label: '敏捷' },
  { key: 'con', label: '体质' },
  { key: 'int', label: '智力' },
  { key: 'wis', label: '感知' },
  { key: 'cha', label: '魅力' },
];
export const DND_CHALLENGES = [
  '',
  '0',
  '1/8',
  '1/4',
  '1/2',
  ...Array.from({ length: 30 }, (_, i) => String(i + 1)),
];

const whole = (min: number, max: number) =>
  z.number().int('须填写整数').min(min, `不得小于 ${min}`).max(max, `不得大于 ${max}`);
const text = (max: number) =>
  z
    .string()
    .max(max, `最多 ${max} 个字符`)
    .refine(
      (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
      '文字中包含不支持的控制字符',
    );
const nameText = (max: number) =>
  text(max).refine((value) => value.trim().length > 0, '请填写名称');
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/, '标识符格式无效');
const attributeValue = whole(1, 30).nullable();
const bonusValue = whole(-100, 100);
const hpValue = whole(0, 100000).nullable();
const actionFields = {
  name: nameText(120),
  description: text(6000),
  attackBonus: bonusValue.nullable(),
  // These are bounded source text, never executable expressions. Rolling validates separately.
  damage: text(1000),
  saveDc: whole(0, 100).nullable(),
  saveAbility: text(120),
  uses: whole(0, 100000).nullable(),
  recharge: text(200),
};
const ActionSchema = z.object({ id: identifier, ...actionFields }).strict();
const SkillSchema = z.object({ id: identifier, name: nameText(120), value: bonusValue }).strict();
const AttributesSchema = z
  .object({
    str: attributeValue,
    dex: attributeValue,
    con: attributeValue,
    int: attributeValue,
    wis: attributeValue,
    cha: attributeValue,
  })
  .strict();
const SavesSchema = z
  .object({
    str: bonusValue.optional(),
    dex: bonusValue.optional(),
    con: bonusValue.optional(),
    int: bonusValue.optional(),
    wis: bonusValue.optional(),
    cha: bonusValue.optional(),
  })
  .strict();
const CardObjectSchema = z
  .object({
    schemaVersion: z.literal(1),
    documentType: z.literal('dnd-statblock'),
    rule: z.literal('dnd'),
    id: identifier,
    kind: z.enum(['npc', 'monster']),
    name: nameText(120),
    size: text(120),
    creatureType: text(200),
    alignment: text(120),
    description: text(4000),
    ac: whole(0, 100).nullable(),
    acNotes: text(2000),
    hp: hpValue,
    maxHp: hpValue,
    hitDice: text(240),
    speed: text(500),
    attributes: AttributesSchema,
    saves: SavesSchema,
    skills: z.array(SkillSchema).max(100, '最多 100 项技能'),
    senses: text(2000),
    languages: text(2000),
    challenge: text(4).refine(
      (value) => DND_CHALLENGES.includes(value),
      'CR 只能为 0、1/8、1/4、1/2、1–30 或空白',
    ),
    xp: whole(0, 1000000000).nullable(),
    resistances: text(4000),
    immunities: text(4000),
    vulnerabilities: text(4000),
    conditionImmunities: text(4000),
    traits: z.array(ActionSchema).max(50, '每组最多 50 项'),
    actions: z.array(ActionSchema).max(50, '每组最多 50 项'),
    reactions: z.array(ActionSchema).max(50, '每组最多 50 项'),
    legendaryActions: z.array(ActionSchema).max(50, '每组最多 50 项'),
    spellcasting: text(12000),
    legendaryActionCount: whole(0, 100).nullable(),
    lairActions: text(12000),
    notes: text(24000),
    source: text(2000),
    tags: z.array(nameText(60)).max(30, '最多 30 个标签'),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((card, ctx) => {
    if (card.hp !== null && card.maxHp !== null && card.hp > card.maxHp)
      ctx.addIssue({
        code: 'custom',
        path: ['hp'],
        message: '当前 HP 不可超过已知上限；临时生命值另行记录',
      });
    const ids = new Set<string>();
    for (const group of ['skills', 'traits', 'actions', 'reactions', 'legendaryActions'] as const) {
      for (let index = 0; index < card[group].length; index++) {
        const id = card[group][index].id;
        if (ids.has(id))
          ctx.addIssue({
            code: 'custom',
            path: [group, index, 'id'],
            message: '行项目 ID 不可重复',
          });
        ids.add(id);
      }
    }
    if (new Set(card.tags).size !== card.tags.length)
      ctx.addIssue({ code: 'custom', path: ['tags'], message: '标签不可重复' });
  });

interface StructureIssue {
  path: Array<string | number>;
  message: string;
}

/** Preflight before Zod, including direct socket/storage callers as well as JSON files. */
function inspectStructure(
  value: unknown,
  maxNodes = 5000,
  maxDepth = 8,
): StructureIssue | undefined {
  const queue: Array<{
    value: unknown;
    path: Array<string | number>;
    ancestors: ReadonlySet<object>;
  }> = [{ value, path: [], ancestors: new Set() }];
  let visited = 0;
  while (queue.length) {
    const current = queue.pop()!;
    if (++visited > maxNodes || current.path.length > maxDepth)
      return { path: current.path, message: '资料数据过大或嵌套过深' };
    if (typeof current.value !== 'object' || current.value === null) continue;
    if (current.ancestors.has(current.value))
      return { path: current.path, message: '资料不允许循环引用' };
    const prototype = Object.getPrototypeOf(current.value);
    if (!Array.isArray(current.value) && prototype !== Object.prototype && prototype !== null)
      return { path: current.path, message: '只允许普通 JSON 对象' };
    const entries = Object.entries(Object.getOwnPropertyDescriptors(current.value));
    if (entries.length > 5001) return { path: current.path, message: '单个字段包含过多条目' };
    const ancestors = new Set([...current.ancestors, current.value]);
    for (const [key, descriptor] of entries) {
      if (Array.isArray(current.value) && key === 'length') continue;
      const path = [
        ...current.path,
        Array.isArray(current.value) && /^\d+$/.test(key) ? Number(key) : key,
      ];
      if (key === '__proto__' || key === 'constructor' || key === 'prototype')
        return { path, message: '不允许的对象键名' };
      if (!('value' in descriptor)) return { path, message: '资料不允许访问器属性' };
      if (!descriptor.enumerable || (Array.isArray(current.value) && !/^(0|[1-9]\d*)$/.test(key)))
        return { path, message: '资料只允许可序列化的 JSON 字段' };
      queue.push({ value: descriptor.value, path, ancestors });
    }
    if (Object.getOwnPropertySymbols(current.value).length)
      return { path: current.path, message: '资料不允许 Symbol 键名' };
  }
}

function preflight(maxNodes = 5000, maxDepth = 8) {
  return z.unknown().superRefine((value, ctx) => {
    const issue = inspectStructure(value, maxNodes, maxDepth);
    if (issue)
      ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message, fatal: true });
  });
}

/** Independent NPC/monster data; never validated with the player Character schema. */
export const DndStatBlockSchema = preflight().pipe(CardObjectSchema);

const SourceActionSchema = z
  .object({
    name: actionFields.name,
    description: actionFields.description.optional(),
    attackBonus: actionFields.attackBonus.optional(),
    damage: actionFields.damage.optional(),
    saveDc: actionFields.saveDc.optional(),
    saveAbility: actionFields.saveAbility.optional(),
    uses: actionFields.uses.optional(),
    recharge: actionFields.recharge.optional(),
  })
  .strict();
const {
  schemaVersion: _version,
  documentType: _type,
  rule: _rule,
  id: _id,
  createdAt: _created,
  updatedAt: _updated,
  ...sourceFields
} = CardObjectSchema.shape;
const SourceCardObjectSchema = z
  .object(sourceFields)
  .partial()
  .extend({
    name: CardObjectSchema.shape.name,
    kind: CardObjectSchema.shape.kind,
    attributes: AttributesSchema.partial().optional(),
    skills: z
      .array(z.object({ name: nameText(120), value: bonusValue }).strict())
      .max(100)
      .optional(),
    traits: z.array(SourceActionSchema).max(50).optional(),
    actions: z.array(SourceActionSchema).max(50).optional(),
    reactions: z.array(SourceActionSchema).max(50).optional(),
    legendaryActions: z.array(SourceActionSchema).max(50).optional(),
  })
  .strict();
export type DndSourceCard = z.infer<typeof SourceCardObjectSchema>;

const emptyAttributes = (): DndAttributes => ({
  str: null,
  dex: null,
  con: null,
  int: null,
  wis: null,
  cha: null,
});
const newId = () => globalThis.crypto.randomUUID();

/** Only fill missing structure. Preserve source values without dice, derivation, healing or templates. */
function materializeSource(
  source: DndSourceCard,
  makeId: () => string,
  timestamp: string,
): DndStatBlock {
  const actions = (rows: DndSourceCard['actions']): DndAction[] =>
    (rows ?? []).map((row) => ({
      id: makeId(),
      name: row.name,
      description: row.description ?? '',
      attackBonus: row.attackBonus ?? null,
      damage: row.damage ?? '',
      saveDc: row.saveDc ?? null,
      saveAbility: row.saveAbility ?? '',
      uses: row.uses ?? null,
      recharge: row.recharge ?? '',
    }));
  return {
    schemaVersion: 1,
    documentType: 'dnd-statblock',
    rule: 'dnd',
    id: makeId(),
    kind: source.kind,
    name: source.name,
    size: source.size ?? '',
    creatureType: source.creatureType ?? '',
    alignment: source.alignment ?? '',
    description: source.description ?? '',
    ac: source.ac ?? null,
    acNotes: source.acNotes ?? '',
    hp: source.hp ?? null,
    maxHp: source.maxHp ?? null,
    hitDice: source.hitDice ?? '',
    speed: source.speed ?? '',
    attributes: { ...emptyAttributes(), ...source.attributes },
    saves: { ...source.saves },
    skills: (source.skills ?? []).map((skill) => ({ ...skill, id: makeId() })),
    senses: source.senses ?? '',
    languages: source.languages ?? '',
    challenge: source.challenge ?? '',
    xp: source.xp ?? null,
    resistances: source.resistances ?? '',
    immunities: source.immunities ?? '',
    vulnerabilities: source.vulnerabilities ?? '',
    conditionImmunities: source.conditionImmunities ?? '',
    traits: actions(source.traits),
    actions: actions(source.actions),
    reactions: actions(source.reactions),
    legendaryActions: actions(source.legendaryActions),
    spellcasting: source.spellcasting ?? '',
    legendaryActionCount: source.legendaryActionCount ?? null,
    lairActions: source.lairActions ?? '',
    notes: source.notes ?? '',
    source: source.source ?? '',
    tags: [...(source.tags ?? [])],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export const DndSourceCardSchema = preflight().pipe(
  SourceCardObjectSchema.superRefine((source, ctx) => {
    let index = 0;
    const result = CardObjectSchema.safeParse(
      materializeSource(source, () => `validation-${++index}`, '2000-01-01T00:00:00.000Z'),
    );
    if (!result.success)
      for (const issue of result.error.issues)
        ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  }),
);
export const DndSourceSchema = preflight(1000000, 10).pipe(
  z
    .object({
      schemaVersion: z.literal(1),
      documentType: z.literal('dnd-source'),
      rule: z.literal('dnd'),
      cards: z
        .array(DndSourceCardSchema)
        .min(1, '未提取到数据块，请补充来源内容')
        .max(MAX_DND_CARDS, '每批最多 200 张数据块'),
    })
    .strict(),
);
export type DndSourceDocument = z.infer<typeof DndSourceSchema>;

export const DndCollectionSchema = preflight(1000000, 10).pipe(
  z
    .object({
      schemaVersion: z.literal(1),
      documentType: z.literal('dnd-collection'),
      rule: z.literal('dnd'),
      cards: z
        .array(DndStatBlockSchema)
        .min(1, '资料集不能为空')
        .max(MAX_DND_CARDS, '每批最多 200 张数据块'),
    })
    .strict()
    .superRefine((document, ctx) => {
      if (new Set(document.cards.map((card) => card.id)).size !== document.cards.length)
        ctx.addIssue({ code: 'custom', path: ['cards'], message: '资料集中的数据块 ID 不可重复' });
    }),
);

function formatIssue(
  issue: { path: readonly PropertyKey[]; message: string; code?: string; keys?: readonly string[] },
  value: unknown,
): string {
  const document = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  const own = (object: object | null, key: string): unknown =>
    object ? Object.getOwnPropertyDescriptor(object, key)?.value : undefined;
  const rawCards = own(document, 'cards');
  const cards = Array.isArray(value) ? value : Array.isArray(rawCards) ? rawCards : null;
  const index =
    issue.path[0] === 'cards' && typeof issue.path[1] === 'number'
      ? issue.path[1]
      : Array.isArray(value) && typeof issue.path[0] === 'number'
        ? issue.path[0]
        : null;
  const card =
    index !== null && cards
      ? cards[index]
      : own(document, 'documentType') === 'dnd-statblock'
        ? document
        : null;
  const rawName =
    card && typeof card === 'object'
      ? Object.getOwnPropertyDescriptor(card, 'name')?.value
      : undefined;
  const name =
    typeof rawName === 'string' && rawName.trim()
      ? rawName.replace(/[\r\n\t]/g, ' ').slice(0, 120)
      : '未命名';
  const path =
    index === null ? [...issue.path] : issue.path.slice(issue.path[0] === 'cards' ? 2 : 1);
  if (issue.code === 'unrecognized_keys' && issue.keys?.length) path.push(issue.keys.join('、'));
  return `${index !== null ? `第 ${index + 1} 张「${name}」` : card ? `「${name}」` : '文档'} · ${path.map(String).join('.') || '数据块'}：${issue.message}`;
}

export function getDndStatBlockErrors(card: unknown): string[] {
  const result = DndStatBlockSchema.safeParse(card);
  return result.success
    ? []
    : [...new Set(result.error.issues.map((issue) => formatIssue(issue, card)))];
}
function requireCard(value: unknown): DndStatBlock {
  const result = DndStatBlockSchema.safeParse(value);
  if (!result.success)
    throw new Error(
      `D&D 数据块无效：${result.error.issues
        .slice(0, 5)
        .map((issue) => formatIssue(issue, value))
        .join('；')}`,
    );
  return result.data;
}

export interface DndTemplate {
  id: string;
  name: string;
  kind: DndKind;
  description: string;
  source: string;
  isOriginal: boolean;
  data: DndSourceCard;
}

const blankTemplate = (kind: DndKind): DndTemplate => ({
  id: `${kind}-blank`,
  name: kind === 'npc' ? '空白 NPC' : '空白怪物',
  kind,
  description: '按剧本填写已知数值；未知保持空白。',
  source: '本工具的空白记录模板，不包含官方生物数值。',
  isOriginal: true,
  data: { name: kind === 'npc' ? '未命名 NPC' : '未命名怪物', kind },
});
export const DND_TEMPLATES: DndTemplate[] = [
  blankTemplate('npc'),
  blankTemplate('monster'),
  {
    id: 'npc-bridge-guard',
    name: '桥灯守卫 · 原创示例',
    kind: 'npc',
    isOriginal: true,
    description: '一名守着旧桥路障的值夜人；可作为填写属性、攻击与反应的参考。',
    source: '本项目原创示例，并非 SRD 官方 Guard 数据块；未评定挑战等级。',
    data: {
      name: '桥灯守卫',
      kind: 'npc',
      size: '中型',
      creatureType: '类人生物（人类）',
      alignment: '守序中立',
      description: '提着有遮光罩的铜灯，在夜间核对过桥信物。',
      ac: 15,
      acNotes: '原创设定：加固皮甲与护臂。',
      maxHp: 19,
      hitDice: '3d8 + 6',
      speed: '步行 30 尺',
      attributes: { str: 13, dex: 12, con: 14, int: 10, wis: 13, cha: 10 },
      saves: { con: 4 },
      skills: [{ name: '察觉', value: 3 }],
      senses: '被动察觉 13',
      languages: '通用语',
      traits: [
        {
          name: '熟悉值勤路线',
          description: '熟悉旧桥路障和周边巷道；这一叙述不额外授予数值加成。',
        },
      ],
      actions: [
        {
          name: '短矛',
          description: '近战武器攻击，触及 5 尺，单一目标。命中后的伤害见伤害栏。',
          attackBonus: 3,
          damage: '1d6 + 1 穿刺伤害',
        },
      ],
      reactions: [
        {
          name: '示警',
          description: '发现闯关者时摇响桥边铜铃；是否可用反应及其他后果由 DM 按场景裁定。',
        },
      ],
      notes: '原创填写示例。当前 HP 未指定；未确定 CR、XP、抗性、免疫与传奇行动，不补成 0。',
      tags: ['原创示例', '守卫'],
    },
  },
];

export function createDndStatBlock(templateId = 'npc-blank'): DndStatBlock {
  const template = DND_TEMPLATES.find((entry) => entry.id === templateId);
  if (!template) throw new Error('未找到对应的 D&D 数据块模板');
  const source = DndSourceCardSchema.parse({ ...template.data, source: template.source });
  return materializeSource(source, newId, new Date().toISOString());
}

export function duplicateDndStatBlock(card: DndStatBlock, name?: string): DndStatBlock {
  const original = requireCard(card);
  const {
    schemaVersion: _v,
    documentType: _t,
    rule: _r,
    id: _i,
    createdAt: _c,
    updatedAt: _u,
    ...data
  } = original;
  const removeIds = (rows: DndAction[]) => rows.map(({ id: _rowId, ...row }) => row);
  const source = DndSourceCardSchema.parse({
    ...data,
    name: name ?? `${original.name.slice(0, 115)} · 副本`,
    skills: original.skills.map(({ id: _rowId, ...row }) => row),
    traits: removeIds(original.traits),
    actions: removeIds(original.actions),
    reactions: removeIds(original.reactions),
    legendaryActions: removeIds(original.legendaryActions),
  });
  return materializeSource(source, newId, new Date().toISOString());
}

function ensureFileSize(value: string): string {
  if (
    value.length > MAX_DND_FILE_BYTES ||
    new TextEncoder().encode(value).byteLength > MAX_DND_FILE_BYTES
  )
    throw new Error('D&D 资料文件不得超过 8 MiB，请按章节分批');
  return value;
}

function readFile(text: string): unknown {
  if (typeof text !== 'string') throw new Error('请选择 UTF-8 JSON 或 Markdown 文件');
  ensureFileSize(text);
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  let json = trimmed;
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    const fences = [...trimmed.matchAll(/^```json[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm)];
    if (fences.length !== 1) throw new Error('Markdown 须包含且仅包含一个完整的 json 代码块');
    json = fences[0][1];
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('无法读取 D&D 资料 JSON，请检查引号、逗号和完整的代码块');
  }
  const issue = inspectStructure(value, 1000000, 10);
  if (issue) throw new Error(formatIssue(issue, value));
  return value;
}

/** Source files allocate IDs only after the whole batch passes; complete files keep their IDs. */
export function parseDndStatBlocks(text: string): DndStatBlock[] {
  const value = readFile(text);
  if (
    value &&
    typeof value === 'object' &&
    'documentType' in value &&
    value.documentType === 'dnd-source'
  ) {
    const result = DndSourceSchema.safeParse(value);
    if (!result.success)
      throw new Error(
        result.error.issues
          .slice(0, 5)
          .map((issue) => formatIssue(issue, value))
          .join('；'),
      );
    const timestamp = new Date().toISOString();
    return result.data.cards.map((source) => materializeSource(source, newId, timestamp));
  }
  if (
    value &&
    typeof value === 'object' &&
    'documentType' in value &&
    value.documentType === 'dnd-statblock'
  )
    return [requireCard(value)];
  const input = Array.isArray(value)
    ? { schemaVersion: 1, documentType: 'dnd-collection', rule: 'dnd', cards: value }
    : value;
  const result = DndCollectionSchema.safeParse(input);
  if (!result.success)
    throw new Error(
      result.error.issues
        .slice(0, 5)
        .map((issue) => formatIssue(issue, input))
        .join('；'),
    );
  return result.data.cards;
}

const markdown = (heading: string, json: string) =>
  ensureFileSize(
    `# ${heading.replace(/[\r\n]/g, ' ')}\n\nD&D 5e（2014 / SRD 5.1）数据块备份；包含主持人私密备注。数值与骰式按保存内容保留。\n\n\`\`\`json\n${json}\n\`\`\`\n`,
  );
export const dndCardJSON = (card: DndStatBlock): string =>
  ensureFileSize(JSON.stringify(requireCard(card), null, 2));
export const dndCardMD = (card: DndStatBlock): string =>
  markdown(requireCard(card).name, dndCardJSON(card));
export function dndCollectionJSON(cards: readonly DndStatBlock[]): string {
  const input = { schemaVersion: 1, documentType: 'dnd-collection', rule: 'dnd', cards };
  const result = DndCollectionSchema.safeParse(input);
  if (!result.success)
    throw new Error(
      result.error.issues
        .slice(0, 5)
        .map((issue) => formatIssue(issue, input))
        .join('；'),
    );
  return ensureFileSize(JSON.stringify(result.data, null, 2));
}
export const dndCollectionMD = (cards: readonly DndStatBlock[]): string =>
  markdown('D&D 主持人数据块资料集', dndCollectionJSON(cards));
export const cardMD = dndCardMD;
export const collectionJSON = dndCollectionJSON;
export const collectionMD = dndCollectionMD;
