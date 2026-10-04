import { z } from 'zod';
import { rollDice, type DieRandom } from './rules';

export type KeeperKind = 'npc' | 'monster';
export type KeeperCategory = 'human' | 'mythos' | 'deity' | 'traditional' | 'beast' | 'custom';
export type KeeperAttributeKey = 'str' | 'con' | 'siz' | 'dex' | 'app' | 'int' | 'pow' | 'edu';
export type KeeperAttributes = Record<KeeperAttributeKey, number | null>;
export type KeeperAttributeRolls = Partial<Record<KeeperAttributeKey, string>>;
export interface KeeperAttack {
  id: string;
  name: string;
  skill: number | null;
  damage: string;
  notes: string;
}
export interface KeeperSkill {
  id: string;
  name: string;
  value: number;
}
export interface KeeperCard {
  schemaVersion: 1;
  documentType: 'keeper-card';
  rule: 'coc';
  id: string;
  kind: KeeperKind;
  templateId: string | null;
  name: string;
  category: KeeperCategory;
  description: string;
  attributes: KeeperAttributes;
  attributeRolls: KeeperAttributeRolls;
  hp: number | null;
  maxHp: number | null;
  mp: number | null;
  maxMp: number | null;
  armor: number | null;
  armorNotes: string;
  movement: string;
  damageBonus: string;
  build: number | null;
  attacksPerRound: number | null;
  attacks: KeeperAttack[];
  skills: KeeperSkill[];
  specialAbilities: string;
  sanityLoss: string;
  notes: string;
  tags: string[];
  source: string;
  createdAt: string;
  updatedAt: string;
}

export const KEEPER_ATTRIBUTES: Array<{ key: KeeperAttributeKey; label: string }> = [
  { key: 'str', label: '力量' },
  { key: 'con', label: '体质' },
  { key: 'siz', label: '体型' },
  { key: 'dex', label: '敏捷' },
  { key: 'app', label: '外貌' },
  { key: 'int', label: '智力' },
  { key: 'pow', label: '意志' },
  { key: 'edu', label: '教育' },
];
export const KEEPER_CATEGORIES: Array<{ key: KeeperCategory; label: string; description: string }> =
  [
    { key: 'human', label: '人类 NPC', description: '只记录剧情需要的属性、技能与行为。' },
    {
      key: 'mythos',
      label: '神话生物',
      description: '怪物书中的神话实体分类；没有统一的强度档位。',
    },
    { key: 'deity', label: '神话神祇', description: '可使用空白属性；本工具不自动判定神祇死亡。' },
    {
      key: 'traditional',
      label: '传统恐怖生物',
      description: '幽灵、吸血鬼等传统恐怖题材的分类。',
    },
    { key: 'beast', label: '野兽', description: '动物数据与特殊行动的记录。' },
    { key: 'custom', label: '自定义', description: '由 KP 按模组或原创设定填写。' },
  ];

export interface KeeperTemplate {
  id: string;
  name: string;
  kind: KeeperKind;
  category: KeeperCategory;
  description: string;
  source: string;
  isOriginal: boolean;
  attributes: KeeperAttributes;
  attributeRolls: KeeperAttributeRolls;
  armor: number | null;
  armorNotes: string;
  movement: string;
  attacksPerRound: number;
  attacks: Array<Omit<KeeperAttack, 'id'>>;
  skills: Array<Omit<KeeperSkill, 'id'>>;
  specialAbilities: string;
  sanityLoss: string;
  tags: string[];
}

const emptyAttributes = (): KeeperAttributes => ({
  str: null,
  con: null,
  siz: null,
  dex: null,
  app: null,
  int: null,
  pow: null,
  edu: null,
});
const humanRolls: KeeperAttributeRolls = {
  str: '3d6*5',
  con: '3d6*5',
  siz: '(2d6+6)*5',
  dex: '3d6*5',
  app: '3d6*5',
  int: '(2d6+6)*5',
  pow: '3d6*5',
  edu: '(2d6+6)*5',
};

function blankTemplate(
  id: string,
  name: string,
  kind: KeeperKind,
  category: KeeperCategory,
): KeeperTemplate {
  return {
    id,
    name,
    kind,
    category,
    description: '空白资料卡；按模组或自己的设定补充。空值表示未知或不适用。',
    source: '本工具的空白记录模板；分类参考 Chaosium Bestiary，不含官方怪物数值。',
    isOriginal: true,
    attributes: emptyAttributes(),
    attributeRolls: {},
    armor: null,
    armorNotes: '',
    movement: '',
    attacksPerRound: 1,
    attacks: [],
    skills: [],
    specialAbilities: '',
    sanityLoss: '',
    tags: [],
  };
}

const bystander: KeeperTemplate = {
  ...blankTemplate('npc-bystander', '普通路人 · 原创示例', 'npc', 'human'),
  description: '供临场交谈和简单行动使用的人类草稿；数值可直接调整，不分配调查员职业点。',
  source: '原创便捷示例，非官方固定 NPC 卡；属性基准为常用人类骰式期望值向下取整。',
  attributes: { str: 52, con: 52, siz: 65, dex: 52, app: 52, int: 65, pow: 52, edu: 65 },
  attributeRolls: humanRolls,
  armor: 0,
  movement: '7（按年龄与情境调整）',
  attacks: [{ name: '徒手', skill: 25, damage: '1d3 + DB', notes: '由 KP 判断是否需要冲突。' }],
  skills: [
    { name: '聆听', value: 35 },
    { name: '侦查', value: 35 },
  ],
  sanityLoss: '0/0',
  tags: ['原创示例', '人类'],
};
const contact: KeeperTemplate = {
  ...bystander,
  id: 'npc-contact',
  name: '档案馆联络人 · 原创示例',
  description: '熟悉旧档案和本地掌故的接触对象；可提供线索，但不会代替调查员推理。',
  skills: [
    { name: '图书馆使用', value: 65 },
    { name: '历史', value: 60 },
    { name: '心理学', value: 40 },
  ],
  tags: ['原创示例', '线索人物'],
};
const mistHound: KeeperTemplate = {
  ...blankTemplate('monster-mist-hound', '雾岸猎影 · 原创示例', 'monster', 'mythos'),
  description: '一道沿着雾岸移动的多足剪影。它追逐响声，接近光亮时会停下观察。',
  source: '本项目原创生物与数值，仅示范制卡字段；不是 Chaosium 官方怪物或平衡等级。',
  attributes: { str: 92, con: 70, siz: 112, dex: 72, app: null, int: 35, pow: 52, edu: null },
  attributeRolls: {
    str: '(3d6+8)*5',
    con: '4d6*5',
    siz: '(3d6+12)*5',
    dex: '(3d6+4)*5',
    int: '2d6*5',
    pow: '3d6*5',
  },
  armor: 2,
  armorNotes: '原创设定：外壳提供 2 点普通护甲，其他特性由 KP 决定。',
  movement: '陆地 12',
  attacks: [{ name: '利爪', skill: 45, damage: '1d6 + DB', notes: '特殊抓取请按战技裁定。' }],
  skills: [
    { name: '聆听', value: 65 },
    { name: '潜行', value: 50 },
  ],
  specialAbilities: '循声：优先接近持续的机械声；强光会令它迟疑。具体效果由 KP 裁定。',
  sanityLoss: '0/1d4',
  tags: ['原创示例', '雾岸'],
};

/** Categories follow the rulebook; these few usable examples are original. */
export const KEEPER_TEMPLATES: KeeperTemplate[] = [
  bystander,
  contact,
  blankTemplate('npc-blank', '空白 NPC', 'npc', 'human'),
  mistHound,
  blankTemplate('monster-mythos', '神话生物 · 空白', 'monster', 'mythos'),
  blankTemplate('monster-deity', '神话神祇 · 空白', 'monster', 'deity'),
  blankTemplate('monster-traditional', '传统恐怖生物 · 空白', 'monster', 'traditional'),
  blankTemplate('monster-beast', '野兽 · 空白', 'monster', 'beast'),
  blankTemplate('monster-blank', '自定义怪物 · 空白', 'monster', 'custom'),
];

interface AttributeFormula {
  count: number;
  sides: number;
  offset: number;
  multiplier: number;
  minimum: number;
  maximum: number;
  average: number;
}

/** Restricted stat-block notation; multiplication applies to the entire group. */
function parseAttributeFormula(expression: string): AttributeFormula {
  if (typeof expression !== 'string' || expression.length > 80)
    throw new Error('属性骰式最多 80 个字符');
  const source = expression.toLowerCase().replace(/\s+/g, '').replace(/[×x]/g, '*');
  if (/^\d+$/.test(source)) {
    const value = Number(source);
    if (!Number.isSafeInteger(value) || value > 100000)
      throw new Error('固定属性须在 0–100000 之间');
    return {
      count: 0,
      sides: 0,
      offset: value,
      multiplier: 1,
      minimum: value,
      maximum: value,
      average: value,
    };
  }
  const grouped = source.match(/^\((\d*)d(\d+)([+-]\d+)?\)(?:\*(\d+))?$/);
  const plain = source.match(/^(\d*)d(\d+)([+-]\d+)?$/);
  const scaled = source.match(/^(\d*)d(\d+)\*(\d+)$/);
  if (!grouped && !plain && !scaled)
    throw new Error('属性骰式示例：3d6*5、(2d6+6)*5、2d6+6 或固定整数');
  const parts = grouped ?? plain ?? scaled!;
  const count = parts[1] === '' ? 1 : Number(parts[1]);
  const sides = Number(parts[2]);
  const offset = scaled ? 0 : Number(parts[3] ?? 0);
  const multiplier = scaled ? Number(parts[3]) : grouped ? Number(parts[4] ?? 1) : 1;
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > 100 ||
    !Number.isSafeInteger(sides) ||
    sides < 2 ||
    sides > 1000 ||
    !Number.isSafeInteger(offset) ||
    Math.abs(offset) > 10000 ||
    !Number.isSafeInteger(multiplier) ||
    multiplier < 1 ||
    multiplier > 1000
  ) {
    throw new Error('骰式超出限制：最多 100 颗、2–1000 面、修正 ±10000、乘数 1–1000');
  }
  const minimum = (count + offset) * multiplier;
  const maximum = (count * sides + offset) * multiplier;
  if (minimum < 0 || maximum > 100000) throw new Error('属性骰式的所有可能结果须在 0–100000 之间');
  return {
    count,
    sides,
    offset,
    multiplier,
    minimum,
    maximum,
    average: Math.floor(((count * (sides + 1)) / 2 + offset) * multiplier),
  };
}

export function rollKeeperAttribute(expression: string, rng?: DieRandom): number {
  const formula = parseAttributeFormula(expression);
  if (formula.count === 0) return formula.offset;
  return (
    rollDice(
      `${formula.count}d${formula.sides}${formula.offset < 0 ? '' : '+'}${formula.offset}`,
      rng,
    ).total * formula.multiplier
  );
}

const whole = (min: number, max: number) => z.number().int('须为整数').min(min).max(max);
const text = (max: number) => z.string().max(max, `最多 ${max} 个字符`);
const nameText = (max: number) =>
  text(max).refine((value) => value.trim().length > 0, '请填写名称');
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/, '标识符格式无效');
const attributeValue = whole(0, 100000).nullable();
const resourceValue = whole(0, 100000).nullable();
const formulaShape = Object.fromEntries(
  KEEPER_ATTRIBUTES.map(({ key }) => [key, text(80).optional()]),
) as Record<KeeperAttributeKey, z.ZodOptional<z.ZodString>>;

interface StructureIssue {
  path: Array<string | number>;
  message: string;
}

function inspectStructure(
  value: unknown,
  maxNodes = 5000,
  maxDepth = 8,
): StructureIssue | undefined {
  const queue: Array<{ value: unknown; path: Array<string | number> }> = [{ value, path: [] }];
  const seen = new Set<object>();
  let visited = 0;
  while (queue.length) {
    const current = queue.pop()!;
    if (++visited > maxNodes || current.path.length > maxDepth)
      return { path: current.path, message: '资料卡的数据结构过大或嵌套过深' };
    if (typeof current.value !== 'object' || current.value === null) continue;
    if (seen.has(current.value))
      return { path: current.path, message: '资料卡不允许循环或重复对象引用' };
    seen.add(current.value);
    const entries = Object.entries(current.value);
    if (entries.length > 5000) return { path: current.path, message: '单个字段包含过多条目' };
    for (const [key, child] of entries) {
      const path = [...current.path, Array.isArray(current.value) ? Number(key) : key];
      if (key === '__proto__' || key === 'constructor' || key === 'prototype')
        return { path, message: '不允许的对象键名' };
      queue.push({ value: child, path });
    }
  }
}

const CardObjectSchema = z
  .object({
    schemaVersion: z.literal(1),
    documentType: z.literal('keeper-card'),
    rule: z.literal('coc'),
    id: identifier,
    kind: z.enum(['npc', 'monster']),
    templateId: identifier.nullable(),
    name: nameText(120),
    category: z.enum(['human', 'mythos', 'deity', 'traditional', 'beast', 'custom']),
    description: text(4000),
    attributes: z
      .object({
        str: attributeValue,
        con: attributeValue,
        siz: attributeValue,
        dex: attributeValue,
        app: attributeValue,
        int: attributeValue,
        pow: attributeValue,
        edu: attributeValue,
      })
      .strict(),
    attributeRolls: z.object(formulaShape).strict(),
    hp: resourceValue,
    maxHp: resourceValue,
    mp: resourceValue,
    maxMp: resourceValue,
    armor: whole(0, 100000).nullable(),
    armorNotes: text(2000),
    movement: text(200),
    damageBonus: text(120),
    build: whole(-10, 3000).nullable(),
    attacksPerRound: whole(0, 100).nullable(),
    attacks: z
      .array(
        z
          .object({
            id: identifier,
            name: nameText(120),
            skill: whole(0, 1000).nullable(),
            damage: text(120),
            notes: text(2000),
          })
          .strict(),
      )
      .max(30),
    skills: z
      .array(z.object({ id: identifier, name: nameText(120), value: whole(0, 1000) }).strict())
      .max(100),
    specialAbilities: text(12000),
    sanityLoss: text(200),
    notes: text(24000),
    tags: z.array(nameText(60)).max(30),
    source: text(1000),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((card, ctx) => {
    const issue = (path: Array<string | number>, message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    if (card.kind === 'npc' && card.category !== 'human' && card.category !== 'custom')
      issue(['category'], 'NPC 请使用人类或自定义分类');
    if (card.kind === 'monster' && card.category === 'human')
      issue(['category'], '怪物请使用怪物分类');
    for (const [key, expression] of Object.entries(card.attributeRolls)) {
      if (!expression?.trim()) continue;
      try {
        parseAttributeFormula(expression);
      } catch (error) {
        issue(['attributeRolls', key], error instanceof Error ? error.message : '属性骰式无效');
      }
    }
    for (const resource of ['hp', 'mp'] as const) {
      const max = card[resource === 'hp' ? 'maxHp' : 'maxMp'];
      if (card[resource] !== null && max === null) issue([resource], '填写当前值时也须填写上限');
      if (card[resource] !== null && max !== null && card[resource] > max)
        issue([resource], '当前资源不可超过上限');
    }
    if (new Set(card.attacks.map((attack) => attack.id)).size !== card.attacks.length)
      issue(['attacks'], '攻击标识符不可重复');
    if (new Set(card.skills.map((skill) => skill.id)).size !== card.skills.length)
      issue(['skills'], '技能标识符不可重复');
    if (new Set(card.tags).size !== card.tags.length) issue(['tags'], '标签不可重复');
  });

/** Separate from CharacterSchema; safe to use directly on socket input. */
export const KeeperCardSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    const issue = inspectStructure(value);
    if (issue)
      ctx.addIssue({
        code: 'custom',
        path: issue.path,
        message: issue.message,
        fatal: true,
      });
  })
  .pipe(CardObjectSchema);

const SourceCardObjectSchema = z
  .object({
    name: CardObjectSchema.shape.name,
    kind: CardObjectSchema.shape.kind,
    category: CardObjectSchema.shape.category,
    description: CardObjectSchema.shape.description.optional(),
    attributes: CardObjectSchema.shape.attributes.partial().optional(),
    attributeRolls: CardObjectSchema.shape.attributeRolls.optional(),
    hp: resourceValue.optional(),
    maxHp: resourceValue.optional(),
    mp: resourceValue.optional(),
    maxMp: resourceValue.optional(),
    armor: CardObjectSchema.shape.armor.optional(),
    armorNotes: CardObjectSchema.shape.armorNotes.optional(),
    movement: CardObjectSchema.shape.movement.optional(),
    damageBonus: CardObjectSchema.shape.damageBonus.optional(),
    build: CardObjectSchema.shape.build.optional(),
    attacksPerRound: CardObjectSchema.shape.attacksPerRound.optional(),
    attacks: z
      .array(
        z
          .object({
            name: nameText(120),
            skill: whole(0, 1000).nullable().optional(),
            damage: text(120).optional(),
            notes: text(2000).optional(),
          })
          .strict(),
      )
      .max(30)
      .optional(),
    skills: z
      .array(z.object({ name: nameText(120), value: whole(0, 1000) }).strict())
      .max(100)
      .optional(),
    specialAbilities: CardObjectSchema.shape.specialAbilities.optional(),
    sanityLoss: CardObjectSchema.shape.sanityLoss.optional(),
    notes: CardObjectSchema.shape.notes.optional(),
    tags: CardObjectSchema.shape.tags.optional(),
    source: CardObjectSchema.shape.source.optional(),
  })
  .strict();

export type KeeperSourceCard = z.infer<typeof SourceCardObjectSchema>;

/** Materialize only explicit facts; no templates, derived stats, or dice here. */
function materializeSourceCard(
  source: KeeperSourceCard,
  makeId: () => string,
  timestamp: string,
): KeeperCard {
  return {
    schemaVersion: 1,
    documentType: 'keeper-card',
    rule: 'coc',
    id: makeId(),
    kind: source.kind,
    templateId: null,
    name: source.name,
    category: source.category,
    description: source.description ?? '',
    attributes: { ...emptyAttributes(), ...source.attributes },
    attributeRolls: { ...source.attributeRolls },
    hp: source.hp ?? null,
    maxHp: source.maxHp ?? null,
    mp: source.mp ?? null,
    maxMp: source.maxMp ?? null,
    armor: source.armor ?? null,
    armorNotes: source.armorNotes ?? '',
    movement: source.movement ?? '',
    damageBonus: source.damageBonus ?? '',
    build: source.build ?? null,
    attacksPerRound: source.attacksPerRound ?? null,
    attacks: (source.attacks ?? []).map((attack) => ({
      id: makeId(),
      name: attack.name,
      skill: attack.skill ?? null,
      damage: attack.damage ?? '',
      notes: attack.notes ?? '',
    })),
    skills: (source.skills ?? []).map((skill) => ({ ...skill, id: makeId() })),
    specialAbilities: source.specialAbilities ?? '',
    sanityLoss: source.sanityLoss ?? '',
    notes: source.notes ?? '',
    tags: [...(source.tags ?? [])],
    source: source.source ?? '',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export const KeeperSourceCardSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    const issue = inspectStructure(value);
    if (issue)
      ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message, fatal: true });
  })
  .pipe(
    SourceCardObjectSchema.superRefine((source, ctx) => {
      // Deterministic placeholder IDs validate the full card without consuming RNG.
      let validationId = 0;
      const complete = materializeSourceCard(
        source,
        () => `validation-${++validationId}`,
        '2000-01-01T00:00:00.000Z',
      );
      const result = CardObjectSchema.safeParse(complete);
      if (!result.success)
        for (const issue of result.error.issues)
          ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }),
  );

const SourceDocumentObjectSchema = z
  .object({
    schemaVersion: z.literal(1),
    documentType: z.literal('keeper-source'),
    rule: z.literal('coc'),
    cards: z
      .array(KeeperSourceCardSchema)
      .min(1, '未提取到资料卡，请补充剧本内容')
      .max(200, '每批最多导入 200 张资料卡'),
  })
  .strict();
export const KeeperSourceSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    const issue = inspectStructure(value, 1_000_000, 10);
    if (issue)
      ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message, fatal: true });
  })
  .pipe(SourceDocumentObjectSchema);
export type KeeperSourceDocument = z.infer<typeof KeeperSourceSchema>;

const CollectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    documentType: z.literal('keeper-collection'),
    rule: z.literal('coc'),
    cards: z.array(KeeperCardSchema).min(1).max(200),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.cards.map((card) => card.id)).size !== value.cards.length)
      ctx.addIssue({ code: 'custom', path: ['cards'], message: '批量文件中的资料卡 ID 不可重复' });
  });

function formatImportIssue(
  issue: { path: readonly PropertyKey[]; message: string; code?: string; keys?: readonly string[] },
  document: unknown,
): string {
  const object =
    typeof document === 'object' && document !== null
      ? (document as Record<string, unknown>)
      : null;
  const cards = Array.isArray(document)
    ? document
    : Array.isArray(object?.cards)
      ? object.cards
      : null;
  const index =
    issue.path[0] === 'cards' && typeof issue.path[1] === 'number'
      ? issue.path[1]
      : Array.isArray(document) && typeof issue.path[0] === 'number'
        ? issue.path[0]
        : null;
  const card =
    index !== null && cards ? cards[index] : object?.documentType === 'keeper-card' ? object : null;
  const cardName =
    typeof card === 'object' &&
    card !== null &&
    'name' in card &&
    typeof card.name === 'string' &&
    card.name.trim()
      ? card.name.replace(/[\r\n\t]/g, ' ').slice(0, 120)
      : '未命名';
  const fieldPath =
    index === null ? [...issue.path] : issue.path.slice(issue.path[0] === 'cards' ? 2 : 1);
  if (issue.code === 'unrecognized_keys' && issue.keys?.length)
    fieldPath.push(issue.keys.join('、'));
  const context =
    index !== null ? `第 ${index + 1} 张「${cardName}」` : card ? `「${cardName}」` : '文档';
  return `${context} · ${fieldPath.map(String).join('.') || '资料卡'}：${issue.message}`;
}

export function getKeeperCardErrors(card: unknown): string[] {
  const parsed = KeeperCardSchema.safeParse(card);
  return parsed.success
    ? []
    : [...new Set(parsed.error.issues.map((issue) => formatImportIssue(issue, card)))];
}

function requireCard(card: unknown): KeeperCard {
  const parsed = KeeperCardSchema.safeParse(card);
  if (!parsed.success)
    throw new Error(`KP 资料卡格式不正确：${getKeeperCardErrors(card).slice(0, 3).join('；')}`);
  return parsed.data;
}

export function keeperDamageBonus(
  str: number,
  siz: number,
): { damageBonus: string; build: number } {
  if (![str, siz].every((value) => Number.isInteger(value) && value >= 0 && value <= 100000))
    throw new Error('力量与体型须为 0–100000 的整数');
  const total = str + siz;
  if (total <= 64) return { damageBonus: '-2', build: -2 };
  if (total <= 84) return { damageBonus: '-1', build: -1 };
  if (total <= 124) return { damageBonus: '0', build: 0 };
  if (total <= 164) return { damageBonus: '+1d4', build: 1 };
  if (total <= 204) return { damageBonus: '+1d6', build: 2 };
  const dice = Math.floor((total - 205) / 80) + 2;
  return { damageBonus: `+${dice}d6`, build: dice + 1 };
}

/** Explicit recalculation: known attributes set HP/MP/DB/build, never heal. */
export function deriveKeeperCard(card: KeeperCard): KeeperCard {
  const { con, siz, pow, str } = card.attributes;
  const maxHp = con !== null && siz !== null ? Math.floor((con + siz) / 10) : card.maxHp;
  const maxMp = pow !== null ? Math.floor(pow / 5) : card.maxMp;
  const combat =
    str !== null && siz !== null
      ? keeperDamageBonus(str, siz)
      : { damageBonus: card.damageBonus, build: card.build };
  return {
    ...card,
    ...combat,
    maxHp,
    maxMp,
    hp: card.hp === null || maxHp === null ? null : Math.min(card.hp, maxHp),
    mp: card.mp === null || maxMp === null ? null : Math.min(card.mp, maxMp),
    updatedAt: new Date().toISOString(),
  };
}

export interface KeeperCreateOptions {
  templateId?: string;
  mode?: 'average' | 'roll';
  rng?: DieRandom;
  name?: string;
}

export function createKeeperCard(
  kindOrTemplateId: KeeperKind | string,
  options: KeeperCreateOptions = {},
): KeeperCard {
  const requestedKind =
    kindOrTemplateId === 'npc' || kindOrTemplateId === 'monster' ? kindOrTemplateId : null;
  const templateId =
    options.templateId ??
    (requestedKind === 'npc'
      ? 'npc-blank'
      : requestedKind === 'monster'
        ? 'monster-blank'
        : kindOrTemplateId);
  const template = KEEPER_TEMPLATES.find((entry) => entry.id === templateId);
  if (!template || (requestedKind && requestedKind !== template.kind))
    throw new Error('未找到对应的 KP 资料模板');
  if (options.mode !== undefined && options.mode !== 'average' && options.mode !== 'roll')
    throw new Error('请选择固定参考值或按骰式生成');
  const timestamp = new Date().toISOString();
  const attributes = { ...template.attributes };
  if (options.mode === 'roll') {
    for (const { key } of KEEPER_ATTRIBUTES) {
      const expression = template.attributeRolls[key];
      if (expression?.trim()) attributes[key] = rollKeeperAttribute(expression, options.rng);
    }
  }
  const card = deriveKeeperCard({
    schemaVersion: 1,
    documentType: 'keeper-card',
    rule: 'coc',
    id: globalThis.crypto.randomUUID(),
    kind: template.kind,
    templateId: template.id,
    name: options.name ?? template.name,
    category: template.category,
    description: template.description,
    attributes,
    attributeRolls: { ...template.attributeRolls },
    hp: null,
    maxHp: null,
    mp: null,
    maxMp: null,
    armor: template.armor,
    armorNotes: template.armorNotes,
    movement: template.movement,
    damageBonus: '',
    build: null,
    attacksPerRound: template.attacksPerRound,
    attacks: template.attacks.map((attack) => ({ ...attack, id: globalThis.crypto.randomUUID() })),
    skills: template.skills.map((skill) => ({ ...skill, id: globalThis.crypto.randomUUID() })),
    specialAbilities: template.specialAbilities,
    sanityLoss: template.sanityLoss,
    notes: '',
    tags: [...template.tags],
    source: template.source,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return requireCard({ ...card, hp: card.maxHp, mp: card.maxMp });
}

/** Rebuild a specimen using its saved formulas, preserving current resource loss. */
export function rerollKeeperCard(card: KeeperCard, rng?: DieRandom): KeeperCard {
  const valid = requireCard(card);
  const attributes = { ...valid.attributes };
  for (const { key } of KEEPER_ATTRIBUTES) {
    const expression = valid.attributeRolls[key];
    if (expression?.trim()) attributes[key] = rollKeeperAttribute(expression, rng);
  }
  return requireCard(deriveKeeperCard({ ...valid, attributes }));
}

/** Deep independent copy with new card/attack/skill IDs; never changes original. */
export function duplicateKeeperCard(card: KeeperCard, name?: string): KeeperCard {
  const valid = requireCard(card);
  const timestamp = new Date().toISOString();
  return requireCard({
    ...valid,
    id: globalThis.crypto.randomUUID(),
    name: name ?? `${valid.name.slice(0, 115)} · 副本`,
    attributes: { ...valid.attributes },
    attributeRolls: { ...valid.attributeRolls },
    tags: [...valid.tags],
    attacks: valid.attacks.map((attack) => ({ ...attack, id: globalThis.crypto.randomUUID() })),
    skills: valid.skills.map((skill) => ({ ...skill, id: globalThis.crypto.randomUUID() })),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function createKeeperBatch(
  templateId: string,
  count: number,
  options: KeeperCreateOptions & { startIndex?: number } = {},
): KeeperCard[] {
  if (!Number.isInteger(count) || count < 1 || count > 200)
    throw new Error('每批可生成 1–200 张 KP 资料卡');
  const startIndex = options.startIndex ?? 1;
  if (!Number.isInteger(startIndex) || startIndex < 1 || startIndex > 999999)
    throw new Error('起始编号须在 1–999999 之间');
  const template = KEEPER_TEMPLATES.find(
    (entry) => entry.id === (options.templateId ?? templateId),
  );
  if (!template) throw new Error('未找到对应的 KP 资料模板');
  const prefix = options.name ?? template.name;
  if (!prefix.trim() || prefix.length > 110) throw new Error('批量名称须为 1–110 个字符');
  return Array.from({ length: count }, (_, index) =>
    createKeeperCard(templateId, {
      ...options,
      name: `${prefix} ${String(startIndex + index).padStart(2, '0')}`,
    }),
  );
}

function readKeeperFile(text: string): unknown {
  if (
    typeof text !== 'string' ||
    text.length > 8_000_000 ||
    new TextEncoder().encode(text).byteLength > 8 * 1024 * 1024
  )
    throw new Error('KP 资料文件最多 8000000 个字符，且 UTF-8 文件不得超过 8 MiB');
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) throw new Error('KP 资料文件为空');
  let json = trimmed;
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    const fences = [...trimmed.matchAll(/^(`{3,})json[ \t]*\r?\n([\s\S]*?)^\1[ \t]*$/gm)];
    if (fences.length !== 1) throw new Error('Markdown 中须有且仅有一个完整的 json 代码块');
    json = fences[0][2];
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('无法读取 KP 资料 JSON，请检查引号、逗号和完整的代码块');
  }
  const issue = inspectStructure(value, 1_000_000, 10);
  if (issue) throw new Error(`KP 资料格式不正确：${formatImportIssue(issue, value)}`);
  return value;
}

export function parseKeeperCards(text: string): KeeperCard[] {
  const value = readKeeperFile(text);
  if (
    typeof value === 'object' &&
    value !== null &&
    'documentType' in value &&
    value.documentType === 'keeper-source'
  ) {
    const parsedSource = KeeperSourceSchema.safeParse(value);
    if (!parsedSource.success)
      throw new Error(
        `KP 来源格式不正确：${parsedSource.error.issues
          .slice(0, 5)
          .map((issue) => formatImportIssue(issue, value))
          .join('；')}`,
      );
    const timestamp = new Date().toISOString();
    return parsedSource.data.cards.map((source) =>
      materializeSourceCard(source, () => globalThis.crypto.randomUUID(), timestamp),
    );
  }
  const isCollection =
    typeof value === 'object' &&
    value !== null &&
    'documentType' in value &&
    value.documentType === 'keeper-collection';
  const collection = Array.isArray(value)
    ? { schemaVersion: 1, documentType: 'keeper-collection', rule: 'coc', cards: value }
    : isCollection
      ? value
      : { schemaVersion: 1, documentType: 'keeper-collection', rule: 'coc', cards: [value] };
  const parsed = CollectionSchema.safeParse(collection);
  if (!parsed.success)
    throw new Error(
      `KP 资料格式不正确：${parsed.error.issues
        .slice(0, 3)
        .map((issue) => formatImportIssue(issue, collection))
        .join('；')}`,
    );
  return parsed.data.cards;
}

export function parseKeeperCard(text: string): KeeperCard {
  const cards = parseKeeperCards(text);
  if (cards.length !== 1) throw new Error('该文件含多张资料卡，请使用批量导入');
  return cards[0];
}

function markdownSummary(card: KeeperCard): string {
  const label = (value: number | null) => (value === null ? '—' : String(value));
  const heading = card.name.replace(/[\r\n]/g, ' ');
  return `## ${heading}\n\n${card.kind === 'npc' ? 'NPC' : '怪物'} · ${KEEPER_CATEGORIES.find((entry) => entry.key === card.category)?.label}\n\n${KEEPER_ATTRIBUTES.map(({ key }) => `${key.toUpperCase()} ${label(card.attributes[key])}`).join(' · ')}\n\nHP ${label(card.hp)}/${label(card.maxHp)} · MP ${label(card.mp)}/${label(card.maxMp)} · DB ${card.damageBonus || '—'} · 体格 ${label(card.build)}\n\n`;
}

function boundedOutput(value: string): string {
  if (value.length > 8_000_000 || new TextEncoder().encode(value).byteLength > 8 * 1024 * 1024)
    throw new Error('资料集超过文件大小限制，请减少数量后分批导出');
  return value;
}

export function exportKeeperCard(card: KeeperCard, format: 'json' | 'md'): string {
  const valid = requireCard(card);
  const json = JSON.stringify(valid, null, 2);
  if (format === 'json') return boundedOutput(`${json}\n`);
  if (format !== 'md') throw new Error('只支持 JSON 或 Markdown 导出');
  return boundedOutput(
    `# CoC 7 · KP 私密资料\n\n${markdownSummary(valid)}完整属性、攻击、能力和私密笔记均在下方 JSON 中。请仅向获授权的 KP 传递此文件；再次导入以 JSON 为准。\n\n\`\`\`json\n${json}\n\`\`\`\n`,
  );
}

export function exportKeeperCards(cards: KeeperCard[], format: 'json' | 'md'): string {
  const collection = CollectionSchema.parse({
    schemaVersion: 1,
    documentType: 'keeper-collection',
    rule: 'coc',
    cards,
  });
  const json = JSON.stringify(collection, null, 2);
  if (format === 'json') return boundedOutput(`${json}\n`);
  if (format !== 'md') throw new Error('只支持 JSON 或 Markdown 导出');
  return boundedOutput(
    `# CoC 7 · KP 私密资料集\n\n共 ${cards.length} 张资料卡。完整记录包含私密笔记；再次导入以 JSON 为准。\n\n${collection.cards.map(markdownSummary).join('')}\`\`\`json\n${json}\n\`\`\`\n`,
  );
}
