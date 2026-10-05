import { z } from 'zod';
import type { Character, RuleId } from './types';
import { COC_ATTRIBUTES, COC_SKILLS, DND_ATTRIBUTES, DND_SKILLS } from './catalog';

const keys = (value: string) => value.split(' ');
const allDnd = DND_SKILLS.map((s) => s.key);
const allCoc = COC_SKILLS.filter((s) => !['creditRating', 'cthulhuMythos'].includes(s.key)).map(
  (s) => s.key,
);
const social = keys('charm fastTalk intimidate persuade');
export const DND_CLASS_RULES = [
  {
    name: '野蛮人',
    count: 2,
    skills: keys('animalHandling athletics intimidation nature perception survival'),
    saves: ['str', 'con'],
  },
  { name: '吟游诗人', count: 3, skills: allDnd, saves: ['dex', 'cha'] },
  {
    name: '牧师',
    count: 2,
    skills: keys('history insight medicine persuasion religion'),
    saves: ['wis', 'cha'],
  },
  {
    name: '德鲁伊',
    count: 2,
    skills: keys('arcana animalHandling insight medicine nature perception religion survival'),
    saves: ['int', 'wis'],
  },
  {
    name: '战士',
    count: 2,
    skills: keys(
      'acrobatics animalHandling athletics history insight intimidation perception survival',
    ),
    saves: ['str', 'con'],
  },
  {
    name: '武僧',
    count: 2,
    skills: keys('acrobatics athletics history insight religion stealth'),
    saves: ['str', 'dex'],
  },
  {
    name: '圣武士',
    count: 2,
    skills: keys('athletics insight intimidation medicine persuasion religion'),
    saves: ['wis', 'cha'],
  },
  {
    name: '游侠',
    count: 3,
    skills: keys(
      'animalHandling athletics insight investigation nature perception stealth survival',
    ),
    saves: ['str', 'dex'],
  },
  {
    name: '游荡者',
    count: 4,
    skills: keys(
      'acrobatics athletics deception insight intimidation investigation perception performance persuasion sleightOfHand stealth',
    ),
    saves: ['dex', 'int'],
  },
  {
    name: '术士',
    count: 2,
    skills: keys('arcana deception insight intimidation persuasion religion'),
    saves: ['con', 'cha'],
  },
  {
    name: '邪术师',
    count: 2,
    skills: keys('arcana deception history intimidation investigation nature religion'),
    saves: ['wis', 'cha'],
  },
  {
    name: '法师',
    count: 2,
    skills: keys('arcana history insight investigation medicine religion'),
    saves: ['int', 'wis'],
  },
];
export interface OccupationProfile {
  name: string;
  credit: [number, number];
  bonus: string[];
  groups: string[][];
  free: number;
}
export const COC_OCCUPATION_RULES: OccupationProfile[] = [
  {
    name: '古物学家',
    credit: [30, 70],
    bonus: [],
    groups: [
      ['appraise'],
      ['artCraft'],
      ['history'],
      ['libraryUse'],
      ['otherLanguage'],
      social,
      ['spotHidden'],
    ],
    free: 1,
  },
  {
    name: '作家',
    credit: [9, 30],
    bonus: [],
    groups: [
      ['artLiterature'],
      ['history'],
      ['libraryUse'],
      ['naturalWorld', 'occult'],
      ['otherLanguage'],
      ['ownLanguage'],
      ['psychology'],
    ],
    free: 1,
  },
  {
    name: '记者',
    credit: [9, 30],
    bonus: [],
    groups: [
      ['artCraft', 'artPhotography'],
      ['history'],
      ['libraryUse'],
      ['ownLanguage'],
      social,
      ['psychology'],
    ],
    free: 2,
  },
  {
    name: '私家侦探',
    credit: [9, 30],
    bonus: ['str', 'dex'],
    groups: [
      ['artPhotography'],
      ['disguise'],
      ['law'],
      ['libraryUse'],
      social,
      ['psychology'],
      ['spotHidden'],
    ],
    free: 1,
  },
  {
    name: '医生',
    credit: [30, 80],
    bonus: [],
    groups: [
      ['firstAid'],
      ['languageLatin'],
      ['medicine'],
      ['psychology'],
      ['scienceBiology'],
      ['sciencePharmacy'],
    ],
    free: 2,
  },
  {
    name: '教授',
    credit: [20, 70],
    bonus: [],
    groups: [['libraryUse'], ['otherLanguage'], ['ownLanguage'], ['psychology']],
    free: 4,
  },
  {
    name: '警探',
    credit: [20, 50],
    bonus: ['str', 'dex'],
    groups: [
      ['artActing', 'disguise'],
      ['firearmsHandgun', 'firearmsRifle'],
      ['law'],
      ['listen'],
      social,
      ['psychology'],
      ['spotHidden'],
    ],
    free: 1,
  },
  {
    name: '艺术家',
    credit: [9, 50],
    bonus: ['dex', 'pow'],
    groups: [
      ['artCraft'],
      ['history', 'naturalWorld'],
      social,
      ['otherLanguage'],
      ['psychology'],
      ['spotHidden'],
    ],
    free: 2,
  },
  {
    name: '神职人员',
    credit: [9, 60],
    bonus: [],
    groups: [
      ['accounting'],
      ['history'],
      ['libraryUse'],
      ['listen'],
      ['otherLanguage'],
      social,
      ['psychology'],
    ],
    free: 1,
  },
  {
    name: '军人',
    credit: [9, 30],
    bonus: ['str', 'dex'],
    groups: [
      ['climb', 'swim'],
      ['dodge'],
      ['fightingBrawl'],
      ['firearmsHandgun', 'firearmsRifle'],
      ['stealth'],
      ['survival'],
      ['firstAid', 'mechanicalRepair', 'otherLanguage'],
      ['firstAid', 'mechanicalRepair', 'otherLanguage'],
    ],
    free: 0,
  },
  {
    name: '考古学家',
    credit: [10, 40],
    bonus: [],
    groups: [
      ['appraise'],
      ['archaeology'],
      ['history'],
      ['otherLanguage'],
      ['libraryUse'],
      ['spotHidden'],
      ['mechanicalRepair'],
      ['navigate', 'science'],
    ],
    free: 0,
  },
];
const keySchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]{0,39}$/)
  .refine((s) => !['constructor', 'prototype'].includes(s));
const choiceList = z.array(keySchema).max(30);
const points = z
  .unknown()
  .superRefine((value, ctx) => {
    if (
      value &&
      typeof value === 'object' &&
      Object.keys(value).some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))
    ) {
      ctx.addIssue({ code: 'custom', message: '点数分配包含不允许的键名', fatal: true });
    }
  })
  .pipe(z.record(keySchema, z.number().int().min(0).max(999)));
export const CreationAllocationSchema = z.discriminatedUnion('rule', [
  z
    .object({
      rule: z.literal('coc'),
      occupationSkills: z.array(keySchema).max(8),
      occupationAttribute: z.string().max(10),
      occupational: points,
      personal: points,
    })
    .strict(),
  z
    .object({
      rule: z.literal('dnd'),
      classSkills: choiceList,
      backgroundSkills: choiceList,
      ancestrySkills: choiceList,
      replacementSkills: choiceList,
      extraSkills: choiceList,
      extraSaves: choiceList,
      expertise: choiceList,
    })
    .strict(),
]);
export type CreationAllocation = z.infer<typeof CreationAllocationSchema>;
export type CocAllocation = Extract<CreationAllocation, { rule: 'coc' }>;
export type DndAllocation = Extract<CreationAllocation, { rule: 'dnd' }>;

const fieldList = [
  ...COC_ATTRIBUTES.map((a) => `attributes.${a.key}`),
  ...DND_ATTRIBUTES.map((a) => `attributes.${a.key}`),
  ...COC_SKILLS.map((a) => `skills.${a.key}`),
  ...DND_SKILLS.map((a) => `skills.${a.key}`),
  'age',
  'level',
  'hp',
  'maxHp',
  'mp',
  'maxMp',
  'san',
  'maxSan',
  'ac',
  'attributeTotal',
];
const RangeSchema = z
  .object({
    field: z.string().refine((f) => fieldList.includes(f), '不支持的限制字段'),
    min: z.number().int().min(-100).max(9999),
    max: z.number().int().min(-100).max(9999),
  })
  .strict()
  .refine((r) => r.min <= r.max, '下限不能大于上限');
export const CreationPolicySchema = z
  .object({
    rule: z.enum(['dnd', 'coc']),
    cocSkillCap: z.number().int().min(1).max(99),
    requireAllPoints: z.boolean(),
    allowInterestOnOccupation: z.boolean().default(true),
    allowMythos: z.boolean(),
    dndExtraSkills: z.number().int().min(0).max(18),
    dndExtraSaves: z.number().int().min(0).max(6),
    ranges: z.array(RangeSchema).max(100),
    allowedOccupations: z.array(z.string().trim().min(1).max(80)).max(30),
    allowedAncestries: z.array(z.string().trim().min(1).max(80)).max(30),
    notes: z.string().max(2000),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (new Set(p.ranges.map((r) => r.field)).size !== p.ranges.length)
      ctx.addIssue({ code: 'custom', message: '每个数值字段只能设置一个范围' });
    const valid = new Set(policyFields(p.rule).map((f) => f.key));
    if (p.ranges.some((r) => !valid.has(r.field)))
      ctx.addIssue({ code: 'custom', message: '包含其他规则的限制字段' });
  });
export type CreationPolicy = z.infer<typeof CreationPolicySchema>;
export function defaultCreationPolicy(rule: RuleId): CreationPolicy {
  return {
    rule,
    cocSkillCap: 99,
    requireAllPoints: false,
    allowInterestOnOccupation: true,
    allowMythos: false,
    dndExtraSkills: 0,
    dndExtraSaves: 0,
    ranges: [],
    allowedOccupations: [],
    allowedAncestries: [],
    notes: '',
  };
}
export function policyFields(rule: RuleId) {
  return [
    ...(rule === 'coc' ? COC_ATTRIBUTES : DND_ATTRIBUTES).map((a) => ({
      key: `attributes.${a.key}`,
      label: `${a.label}属性`,
    })),
    ...(rule === 'coc' ? COC_SKILLS : DND_SKILLS).map((s) => ({
      key: `skills.${s.key}`,
      label: `${s.label}${rule === 'coc' ? '技能' : '检定加值'}`,
    })),
    { key: 'attributeTotal', label: rule === 'coc' ? '八项属性总和（不含幸运）' : '六项属性总和' },
    { key: 'age', label: '年龄' },
    ...(rule === 'dnd'
      ? [
          { key: 'level', label: '等级' },
          { key: 'ac', label: '护甲 AC' },
        ]
      : [
          { key: 'san', label: '当前理智' },
          { key: 'mp', label: '当前 MP' },
          { key: 'maxMp', label: 'MP 上限' },
          { key: 'maxSan', label: 'SAN 上限' },
        ]),
    { key: 'hp', label: '当前 HP' },
    { key: 'maxHp', label: 'HP 上限' },
  ];
}
export function occupationOptions(profile?: OccupationProfile) {
  return profile ? [...profile.groups, ...Array.from({ length: profile.free }, () => allCoc)] : [];
}
export function defaultAllocation(rule: RuleId, occupation = ''): CreationAllocation {
  if (rule === 'dnd')
    return {
      rule,
      classSkills: [],
      backgroundSkills: [],
      ancestrySkills: [],
      replacementSkills: [],
      extraSkills: [],
      extraSaves: [],
      expertise: [],
    };
  const p = COC_OCCUPATION_RULES.find((p) => p.name === occupation);
  const chosen: string[] = [];
  for (const group of occupationOptions(p))
    chosen.push(group.find((s) => !chosen.includes(s)) ?? '');
  return {
    rule,
    occupationSkills: chosen,
    occupationAttribute: p?.bonus[0] ?? 'edu',
    occupational: {},
    personal: {},
  };
}
export function cocSkillBase(card: Character, key: string) {
  return key === 'dodge'
    ? Math.floor(card.attributes.dex / 2)
    : key === 'ownLanguage'
      ? card.attributes.edu
      : (COC_SKILLS.find((s) => s.key === key)?.base ?? 0);
}
export function cocBudget(card: Character) {
  const profile = COC_OCCUPATION_RULES.find((p) => p.name === card.occupation);
  const allocation = card.creation?.rule === 'coc' ? card.creation : null;
  const occupational = profile?.bonus.length
    ? 2 * card.attributes.edu +
      2 * (card.attributes[allocation?.occupationAttribute ?? profile.bonus[0]] ?? 0)
    : 4 * card.attributes.edu;
  return {
    occupational,
    personal: 2 * card.attributes.int,
    spentOccupation: Object.values(allocation?.occupational ?? {}).reduce((a, b) => a + b, 0),
    spentPersonal: Object.values(allocation?.personal ?? {}).reduce((a, b) => a + b, 0),
  };
}
export function dndAncestry(card: Character) {
  return card.ancestry === '精灵'
    ? { fixed: ['perception'], choices: 0 }
    : card.ancestry === '半兽人'
      ? { fixed: ['intimidation'], choices: 0 }
      : { fixed: [], choices: card.ancestry === '半精灵' ? 2 : 0 };
}
export function dndSaves(card: Character) {
  const base = DND_CLASS_RULES.find((c) => c.name === card.occupation)?.saves ?? [];
  if (card.occupation === '武僧' && card.level >= 14) return DND_ATTRIBUTES.map((a) => a.key);
  return card.occupation === '游荡者' && card.level >= 15 ? [...base, 'wis'] : base;
}
export function expertiseLimit(card: Character) {
  return card.occupation === '游荡者'
    ? card.level >= 6
      ? 4
      : 2
    : card.occupation === '吟游诗人' && card.level >= 3
      ? card.level >= 10
        ? 4
        : 2
      : 0;
}
export function dndSkillModifier(card: Character, key: string) {
  const skill = DND_SKILLS.find((s) => s.key === key);
  if (!skill) return 0;
  const prof = 2 + Math.floor((card.level - 1) / 4);
  const trained = card.proficiencies.includes(`skill:${key}`);
  const expert = trained && card.creation?.rule === 'dnd' && card.creation.expertise.includes(key);
  return (
    Math.floor((card.attributes[skill.attribute] - 10) / 2) +
    (expert
      ? 2 * prof
      : trained
        ? prof
        : card.occupation === '吟游诗人' && card.level >= 2
          ? Math.floor(prof / 2)
          : 0)
  );
}
export function replacementCount(card: Character) {
  if (card.creation?.rule !== 'dnd') return 0;
  const a = card.creation;
  const sources = [
    ...a.classSkills,
    ...a.backgroundSkills,
    ...dndAncestry(card).fixed,
    ...a.ancestrySkills,
  ];
  return sources.length - new Set(sources).size;
}
/** Only called by explicit editor changes, never on imported/untrusted server data. */
export function syncAllocation(card: Character): Character {
  const a = card.creation;
  if (!a || a.rule !== card.rule) return card;
  if (a.rule === 'coc')
    return {
      ...card,
      proficiencies: [],
      skills: Object.fromEntries(
        COC_SKILLS.map((s) => [
          s.key,
          cocSkillBase(card, s.key) + (a.occupational[s.key] ?? 0) + (a.personal[s.key] ?? 0),
        ]),
      ),
    };
  const proficiencies = [
    ...new Set([
      ...[
        ...a.classSkills,
        ...a.backgroundSkills,
        ...dndAncestry(card).fixed,
        ...a.ancestrySkills,
        ...a.replacementSkills,
        ...a.extraSkills,
      ].map((s) => `skill:${s}`),
      ...[...dndSaves(card), ...a.extraSaves].map((s) => `save:${s}`),
    ]),
  ];
  const updated = { ...card, proficiencies };
  return {
    ...updated,
    skills: Object.fromEntries(DND_SKILLS.map((s) => [s.key, dndSkillModifier(updated, s.key)])),
  };
}
export function skillRange(policy: CreationPolicy, key: string): { min: number; max: number } {
  return (
    policy.ranges.find((r) => r.field === `skills.${key}`) ?? { min: 0, max: policy.cocSkillCap }
  );
}
export function validateCreation(card: Character, policy: CreationPolicy): string[] {
  const errors: string[] = [];
  if (!CreationPolicySchema.safeParse(policy).success || policy.rule !== card.rule)
    return ['房间制卡规则不匹配或格式无效'];
  const parsed = CreationAllocationSchema.safeParse(card.creation);
  if (!parsed.success || parsed.data.rule !== card.rule)
    return ['请在制卡器中补齐技能分配来源；旧版卡片需重新分配后提交审核'];
  const a = parsed.data;
  const duplicate = (values: string[], label: string) => {
    if (new Set(values).size !== values.length) errors.push(`${label}不可重复选择`);
  };
  if (a.rule === 'coc') {
    const p = COC_OCCUPATION_RULES.find((p) => p.name === card.occupation);
    if (!p) errors.push('请选择已支持的职业方案，以便计算职业点与信用范围');
    else {
      const options = occupationOptions(p);
      if (
        a.occupationSkills.length !== 8 ||
        a.occupationSkills.some((s, i) => !options[i]?.includes(s))
      )
        errors.push('职业技能的八个位置须符合当前职业的选择范围');
      if ((p.bonus.length ? p.bonus : ['edu']).includes(a.occupationAttribute) === false)
        errors.push('职业点公式使用了不允许的属性');
      const credit = card.skills.creditRating ?? 0;
      if (credit < p.credit[0] || credit > p.credit[1])
        errors.push(`信用评级须在职业范围 ${p.credit[0]}–${p.credit[1]} 内`);
    }
    duplicate(a.occupationSkills, '职业技能');
    const allowed = new Set([...a.occupationSkills, 'creditRating']);
    const known = new Set(COC_SKILLS.map((s) => s.key));
    for (const [key, value] of Object.entries(a.occupational)) {
      if (!known.has(key) || (value > 0 && !allowed.has(key)))
        errors.push(`职业点不能用于 ${COC_SKILLS.find((s) => s.key === key)?.label ?? key}`);
    }
    for (const [key, value] of Object.entries(a.personal)) {
      if (!known.has(key)) errors.push('兴趣点不能用于未支持的技能');
      if (policy.allowInterestOnOccupation === false && value > 0 && allowed.has(key))
        errors.push(
          `本房间兴趣点不能用于职业技能：${COC_SKILLS.find((s) => s.key === key)?.label ?? key}`,
        );
    }
    if (!policy.allowMythos && (card.skills.cthulhuMythos ?? 0) !== 0)
      errors.push('本房间新调查员的克苏鲁神话须为 0');
    const b = cocBudget(card);
    if (b.spentOccupation > b.occupational)
      errors.push(`职业点超支 ${b.spentOccupation - b.occupational} 点`);
    if (b.spentPersonal > b.personal) errors.push(`兴趣点超支 ${b.spentPersonal - b.personal} 点`);
    if (
      policy.requireAllPoints &&
      (b.spentOccupation !== b.occupational || b.spentPersonal !== b.personal)
    )
      errors.push('本房间要求分完职业点与兴趣点');
    for (const s of COC_SKILLS) {
      const expected =
        cocSkillBase(card, s.key) + (a.occupational[s.key] ?? 0) + (a.personal[s.key] ?? 0);
      if ((card.skills[s.key] ?? cocSkillBase(card, s.key)) !== expected)
        errors.push(`${s.label}与基础值、职业点和兴趣点合计不一致`);
      const range = skillRange(policy, s.key);
      if (expected < range.min || expected > range.max)
        errors.push(`${s.label}须在 ${range.min}–${range.max} 内（当前 ${expected}）`);
    }
    if (Object.keys(card.skills).some((s) => !known.has(s)))
      errors.push('包含没有分配来源的自定义技能');
    if (
      card.maxHp !== Math.max(1, Math.floor((card.attributes.con + card.attributes.siz) / 10)) ||
      card.maxMp !== Math.floor(card.attributes.pow / 5) ||
      card.maxSan !== Math.max(0, 99 - (card.skills.cthulhuMythos ?? 0))
    )
      errors.push('HP／MP／SAN 上限与属性及克苏鲁神话不一致');
  } else {
    const cls = DND_CLASS_RULES.find((c) => c.name === card.occupation);
    if (!cls) errors.push('请选择 SRD 5.1 支持的职业');
    else if (
      a.classSkills.length !== cls.count ||
      a.classSkills.some((s) => !cls.skills.includes(s))
    )
      errors.push(`${cls.name}须从职业范围选择 ${cls.count} 项技能`);
    if (a.backgroundSkills.length !== 2) errors.push('背景须选择 2 项技能熟练');
    if (a.ancestrySkills.length !== dndAncestry(card).choices)
      errors.push(`当前种族须自选 ${dndAncestry(card).choices} 项额外技能`);
    if (a.replacementSkills.length !== replacementCount(card))
      errors.push(`重复来源须补选 ${replacementCount(card)} 项替代熟练`);
    if (a.extraSkills.length > policy.dndExtraSkills) errors.push('额外技能熟练超出主持人给定名额');
    if (
      a.extraSaves.length > policy.dndExtraSaves ||
      a.extraSaves.some(
        (s) => !DND_ATTRIBUTES.some((attr) => attr.key === s) || dndSaves(card).includes(s),
      )
    )
      errors.push('额外豁免熟练超出主持人名额或重复');
    for (const [label, values] of [
      ['职业', a.classSkills],
      ['背景', a.backgroundSkills],
      ['种族', a.ancestrySkills],
      ['替代', a.replacementSkills],
      ['额外', a.extraSkills],
      ['专精', a.expertise],
    ] as const) {
      duplicate(values, label);
      if (values.some((s) => !allDnd.includes(s))) errors.push(`${label}包含未支持的技能`);
    }
    duplicate(a.extraSaves, '额外豁免');
    const sourced = [
      ...new Set([
        ...a.classSkills,
        ...a.backgroundSkills,
        ...dndAncestry(card).fixed,
        ...a.ancestrySkills,
      ]),
    ];
    duplicate([...sourced, ...a.replacementSkills, ...a.extraSkills], '补选和额外技能');
    if (
      a.expertise.length > expertiseLimit(card) ||
      a.expertise.some((s) => !card.proficiencies.includes(`skill:${s}`))
    )
      errors.push('专精须选择已熟练技能，且不能超过当前职业等级的名额');
    const expected = syncAllocation(card);
    if ([...card.proficiencies].sort().join('|') !== [...expected.proficiencies].sort().join('|'))
      errors.push('熟练项与职业、背景、种族和主持人名额不一致');
    if (
      Object.entries(card.skills).some(
        ([s, value]) => !allDnd.includes(s) || value !== dndSkillModifier(card, s),
      )
    )
      errors.push('D&D 技能加值必须由属性、熟练和专精计算，不能自由填写');
  }
  const attrs = card.rule === 'dnd' ? DND_ATTRIBUTES : COC_ATTRIBUTES;
  for (const attr of attrs) {
    const range = policy.ranges.find((r) => r.field === `attributes.${attr.key}`) ?? {
      min: 1,
      max: card.rule === 'dnd' ? 20 : 99,
    };
    if (card.attributes[attr.key] < range.min || card.attributes[attr.key] > range.max)
      errors.push(`${attr.label}须在 ${range.min}–${range.max} 内`);
  }
  const labels = policyFields(card.rule);
  for (const range of policy.ranges) {
    let value: number;
    if (range.field.startsWith('attributes.')) continue;
    if (range.field.startsWith('skills.'))
      value =
        card.rule === 'dnd'
          ? dndSkillModifier(card, range.field.slice(7))
          : (card.skills[range.field.slice(7)] ?? 0);
    else if (range.field === 'attributeTotal')
      value = attrs
        .filter((s) => s.key !== 'luck')
        .reduce((sum, s) => sum + card.attributes[s.key], 0);
    else value = card[range.field as 'hp'];
    if (value < range.min || value > range.max)
      errors.push(
        `${labels.find((l) => l.key === range.field)?.label ?? range.field}须在 ${range.min}–${range.max} 内（当前 ${value}）`,
      );
  }
  if (policy.allowedOccupations.length && !policy.allowedOccupations.includes(card.occupation))
    errors.push('职业不在本剧本允许的列表中');
  if (policy.allowedAncestries.length && !policy.allowedAncestries.includes(card.ancestry))
    errors.push('种族／国籍不在本剧本允许的列表中');
  return [...new Set(errors)];
}
/** A convenient starting distribution, still editable and subject to review. */
export function suggestAllocation(card: Character, policy: CreationPolicy): Character {
  let result = { ...card, creation: defaultAllocation(card.rule, card.occupation) };
  if (result.creation.rule === 'dnd') {
    const cls = DND_CLASS_RULES.find((c) => c.name === card.occupation);
    const a = result.creation;
    a.classSkills = cls?.skills.slice(0, cls.count) ?? [];
    const used = [...a.classSkills, ...dndAncestry(card).fixed];
    a.backgroundSkills = allDnd.filter((s) => !used.includes(s)).slice(0, 2);
    a.ancestrySkills = allDnd
      .filter((s) => ![...used, ...a.backgroundSkills].includes(s))
      .slice(0, dndAncestry(card).choices);
    const count = replacementCount(result);
    a.replacementSkills = allDnd
      .filter((s) => ![...used, ...a.backgroundSkills, ...a.ancestrySkills].includes(s))
      .slice(0, count);
  } else {
    const a = result.creation;
    const profile = COC_OCCUPATION_RULES.find((p) => p.name === card.occupation);
    if (!profile) return syncAllocation(result);
    a.occupationAttribute = profile.bonus.reduce(
      (best, key) => (card.attributes[key] > card.attributes[best] ? key : best),
      profile.bonus[0] ?? 'edu',
    );
    const budget = cocBudget(result);
    a.occupational.creditRating = profile.credit[0];
    let remaining = budget.occupational - profile.credit[0];
    const distribute = (pool: Record<string, number>, choices: string[], amount: number) => {
      let left = amount;
      for (let pass = 0; pass < 100 && left > 0; pass++)
        for (const key of choices) {
          if (!left) break;
          const current =
            cocSkillBase(card, key) + (a.occupational[key] ?? 0) + (a.personal[key] ?? 0);
          if (current < skillRange(policy, key).max) {
            pool[key] = (pool[key] ?? 0) + 1;
            left--;
          }
        }
      return left;
    };
    remaining = distribute(a.occupational, a.occupationSkills, remaining);
    // A tight room cap can intentionally leave points unspent; validation explains it.
    void remaining;
    distribute(
      a.personal,
      policy.allowInterestOnOccupation === false
        ? allCoc.filter((key) => !a.occupationSkills.includes(key))
        : allCoc,
      budget.personal,
    );
  }
  return syncAllocation(result);
}
