import { z } from 'zod';
import type { Character, CheckRequest, CheckResult, DiceGroup, DiceResult, RuleId } from './types';
import { CreationAllocationSchema, defaultAllocation, syncAllocation } from './creation';
import {
  rollCocAttributes,
  scaleCocAttributes,
  type CocAttributeRollLimits,
} from './coc-attributes';
import {
  CharacterAdjustmentsSchema,
  adjustmentLabel,
  effectiveCharacter,
  getAdjustmentErrors,
  hasAdjustments,
} from './adjustments';

/** An injectable die returns a whole number in the inclusive range 1..sides. */
export type DieRandom = (sides: number) => number;

import { DND_ATTRIBUTES, COC_ATTRIBUTES, DND_SKILLS, COC_SKILLS } from './catalog';
export * from './catalog';
function secureDie(sides: number): number {
  // Rejection sampling avoids the bias produced by a plain uint32 % sides.
  const range = 0x1_0000_0000;
  const limit = range - (range % sides);
  const value = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(value);
  } while (value[0] >= limit);
  return (value[0] % sides) + 1;
}

function die(sides: number, rng: DieRandom): number {
  const value = rng(sides);
  if (!Number.isInteger(value) || value < 1 || value > sides) {
    throw new Error(`随机源必须返回 1 至 ${sides} 的整数`);
  }
  return value;
}

function requireRule(rule: unknown): asserts rule is RuleId {
  if (rule !== 'dnd' && rule !== 'coc') throw new Error('不支持的规则类型');
}

function integer(value: unknown, min: number, max: number, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name}须为 ${min} 至 ${max} 的整数`);
  }
}

/** Grammar: signed dice/integer terms joined by + or -. No code is evaluated. */
export function rollDice(expression: string, rng: DieRandom = secureDie): DiceResult {
  if (typeof expression !== 'string' || expression.length > 120)
    throw new Error('骰子表达式最多 120 个字符');
  const compact = expression.toLowerCase().replace(/\s+/g, '');
  if (!compact || !/^[+\-]?(?:\d*d\d+|\d+)(?:[+\-](?:\d*d\d+|\d+))*$/.test(compact)) {
    throw new Error('请输入如 2d6+3、d20 或 1d8+1d4-2 的表达式');
  }
  const terms = compact.match(/[+\-]?[^+\-]+/g)!;
  const parsed: Array<{ sign: number; count: number; sides: number } | { value: number }> = [];
  let diceCount = 0;
  let modifier = 0;
  // Validate the complete expression before consuming any randomness.
  for (const term of terms) {
    const sign = term.startsWith('-') ? -1 : 1;
    const unsigned = term.replace(/^[+\-]/, '');
    if (unsigned.includes('d')) {
      const [rawCount, rawSides] = unsigned.split('d');
      const count = rawCount === '' ? 1 : Number(rawCount);
      const sides = Number(rawSides);
      integer(count, 1, 100, '骰子数量');
      integer(sides, 2, 1000, '骰子面数');
      diceCount += count;
      if (diceCount > 100) throw new Error('每次最多投掷 100 颗骰子');
      parsed.push({ count, sides, sign });
    } else {
      const value = Number(unsigned);
      integer(value, 0, 10000, '固定修正值');
      modifier += sign * value;
      if (Math.abs(modifier) > 10000) throw new Error('固定修正值的合计不可超过 ±10000');
      parsed.push({ value: sign * value });
    }
  }
  const groups: DiceGroup[] = [];
  let total = modifier;
  for (const term of parsed) {
    if ('value' in term) continue;
    const rolls = Array.from({ length: term.count }, () => die(term.sides, rng));
    groups.push({ ...term, rolls });
    total += term.sign * rolls.reduce((sum, value) => sum + value, 0);
  }
  return { expression: compact, groups, modifier, total };
}

export function abilityModifier(score: number): number {
  integer(score, 1, 30, 'D&D 属性');
  return Math.floor((score - 10) / 2);
}

export function proficiencyBonus(level: number): number {
  integer(level, 1, 20, '等级');
  return 2 + Math.floor((level - 1) / 4);
}

function selectedRoll(rolls: number[], edge: CheckRequest['edge'], lowerIsBetter = false): number {
  if (edge === 'normal') return rolls[0];
  const takeLowest = (edge === 'advantage') === lowerIsBetter;
  return takeLowest ? Math.min(...rolls) : Math.max(...rolls);
}

export function rollCheck(
  rule: RuleId,
  character: Character | null,
  request: CheckRequest,
  rng: DieRandom = secureDie,
): CheckResult {
  requireRule(rule);
  if (!request || !['ability', 'skill', 'save', 'attack', 'sanity'].includes(request.kind))
    throw new Error('不支持的检定类型');
  if (!['normal', 'advantage', 'disadvantage'].includes(request.edge))
    throw new Error('检定骰选项无效');
  if (typeof request.key !== 'string' || request.key.length > 80) throw new Error('检定项目无效');
  integer(request.modifier, -100, 100, '临时修正');
  if (character && character.rule !== rule) throw new Error('人物卡与房间规则不匹配');
  if (character) character = effectiveCharacter(character);
  if (rule === 'dnd') {
    if (request.kind === 'sanity') throw new Error('D&D 5e 没有内置理智检定');
    integer(request.dc, 0, 1000, '难度等级');
    let modifier = request.modifier;
    let label =
      request.kind === 'attack'
        ? '攻击检定'
        : request.kind === 'save'
          ? '豁免检定'
          : request.kind === 'skill'
            ? '技能检定'
            : '属性检定';
    if (request.kind !== 'attack') {
      const skill = DND_SKILLS.find((entry) => entry.key === request.key);
      const attribute = DND_ATTRIBUTES.find(
        (entry) => entry.key === (request.kind === 'skill' ? skill?.attribute : request.key),
      );
      if (!attribute) throw new Error('未找到该 D&D 检定项目');
      label = `${request.kind === 'skill' ? skill!.label : attribute.label}${request.kind === 'save' ? '豁免' : '检定'}`;
      if (character) {
        modifier +=
          request.kind === 'skill'
            ? character.skills[request.key]
            : abilityModifier(character.attributes[attribute.key]);
        const proficiency = `${request.kind}:${request.key}`;
        if (request.kind === 'save' && character.proficiencies.includes(proficiency))
          modifier += proficiencyBonus(character.level);
      }
    }
    const rolls = Array.from({ length: request.edge === 'normal' ? 1 : 2 }, () => die(20, rng));
    const selected = selectedRoll(rolls, request.edge);
    const total = selected + modifier;
    const attack = request.kind === 'attack';
    const success =
      attack && selected === 20 ? true : attack && selected === 1 ? false : total >= request.dc;
    const outcome =
      attack && selected === 20
        ? '重击'
        : attack && selected === 1
          ? '自动失手'
          : success
            ? '成功'
            : '失败';
    return { label, rolls, selected, modifier, total, target: request.dc, outcome, success };
  }

  let target: number;
  let label: string;
  if (request.kind === 'sanity') {
    label = '理智检定';
    target = character?.san ?? 0;
  } else if (request.kind === 'skill' || request.kind === 'attack') {
    const skill = COC_SKILLS.find((entry) => entry.key === request.key);
    const customSkill = character && Object.hasOwn(character.skills, request.key);
    if (!skill && !customSkill && request.target === undefined)
      throw new Error('未找到该 CoC 技能');
    label = `${skill?.label ?? (request.key || '技能')}检定`;
    target = character?.skills[request.key] ?? skill?.base ?? 0;
  } else {
    const attribute = COC_ATTRIBUTES.find((entry) => entry.key === request.key);
    if (!attribute) throw new Error('未找到该 CoC 属性');
    label = `${attribute.label}检定`;
    target = character?.attributes[request.key] ?? 0;
  }
  if (request.target !== undefined) target = request.target;
  else if (!character) throw new Error('无人物卡检定时请填写目标百分比');
  integer(target, 0, request.kind === 'sanity' ? 100 : 100000, '目标百分比');
  // Ordinary SAN rolls are straight percentile rolls. Self-help and its
  // exceptional bonus die are outside this core assistance workflow.
  if (request.kind === 'sanity' && request.edge !== 'normal') {
    throw new Error('普通理智检定不使用奖励骰或惩罚骰');
  }
  // Both candidates use the same units die; 00 + 0 is 100, never zero.
  const units = die(10, rng) - 1;
  const rolls = Array.from({ length: request.edge === 'normal' ? 1 : 2 }, () => {
    const tens = (die(10, rng) - 1) * 10;
    return tens + units || 100;
  });
  const selected = selectedRoll(rolls, request.edge, true);
  if (request.kind === 'sanity') {
    const success = selected <= target;
    return {
      label,
      rolls,
      selected,
      modifier: 0,
      total: selected,
      target,
      outcome: success ? '成功' : '失败',
      success,
    };
  }
  const fumble = selected >= (target < 50 ? 96 : 100);
  const critical = selected === 1;
  const success = !fumble && (critical || selected <= target);
  const outcome = fumble
    ? '大失败'
    : critical
      ? '大成功'
      : selected <= Math.floor(target / 5)
        ? '极难成功'
        : selected <= Math.floor(target / 2)
          ? '困难成功'
          : success
            ? '普通成功'
            : '失败';
  return { label, rolls, selected, modifier: 0, total: selected, target, outcome, success };
}

const string = (max: number) => z.string().max(max, `最多 ${max} 个字符`);
const whole = (min: number, max: number) =>
  z.number().int('须为整数').min(min, `不可小于 ${min}`).max(max, `不可大于 ${max}`);
const safeKey = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]{0,39}$/, '键名只能使用小写字母开头的英文字母和数字')
  .refine((key) => key !== 'constructor' && key !== 'prototype', '不允许的键名');
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/, '标识符格式无效');
const CharacterSchema = z
  .object({
    schemaVersion: z.literal(1, { error: '只支持 schemaVersion: 1 的人物卡' }),
    id: identifier,
    rule: z.enum(['dnd', 'coc'], { error: '仅支持 dnd / coc 规则' }),
    name: string(80),
    occupation: string(80),
    ancestry: string(80),
    background: string(500),
    age: whole(1, 2000),
    level: whole(1, 20),
    attributes: z.record(safeKey, whole(1, 100)),
    skills: z.record(safeKey, whole(-100, 100)),
    proficiencies: z.array(string(80)).max(50),
    creation: CreationAllocationSchema.optional(),
    adjustments: CharacterAdjustmentsSchema.optional(),
    hp: whole(0, 9999),
    maxHp: whole(1, 9999),
    mp: whole(0, 9999),
    maxMp: whole(0, 9999),
    san: whole(0, 99),
    maxSan: whole(0, 99),
    ac: whole(0, 99),
    backstory: string(6000),
    notes: string(12000),
    traits: z.array(string(200)).max(20),
    items: z
      .array(
        z
          .object({
            id: identifier,
            name: string(120).refine((name) => name.trim().length > 0, '请填写物品名称'),
            quantity: whole(0, 9999),
            notes: string(1000),
          })
          .strict(),
      )
      .max(100),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((character, ctx) => {
    const issue = (path: Array<string | number>, message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    if (character.creation && character.creation.rule !== character.rule)
      issue(['creation'], '技能分配与人物规则不匹配');
    const expected = character.rule === 'dnd' ? DND_ATTRIBUTES : COC_ATTRIBUTES;
    const allowed = new Set(expected.map((entry) => entry.key));
    for (const { key, label } of expected) {
      if (!Object.hasOwn(character.attributes, key)) issue(['attributes', key], `缺少${label}属性`);
      else if (character.rule === 'dnd' && character.attributes[key] > 30)
        issue(['attributes', key], `${label}须在 1–30 之间`);
    }
    for (const key of Object.keys(character.attributes))
      if (!allowed.has(key)) issue(['attributes', key], '包含当前规则不使用的属性');
    if (Object.keys(character.skills).length > 100) issue(['skills'], '技能最多 100 项');
    if (character.rule === 'coc') {
      for (const [key, value] of Object.entries(character.skills))
        if (value < 0) issue(['skills', key], '技能百分比不可为负数');
      if ((character.skills.cthulhuMythos ?? 0) > 99)
        issue(['skills', 'cthulhuMythos'], '克苏鲁神话技能不可大于 99');
    }
    const dndProficiencies = new Set([
      ...DND_SKILLS.map((skill) => `skill:${skill.key}`),
      ...DND_ATTRIBUTES.map((attribute) => `save:${attribute.key}`),
    ]);
    for (const [index, proficiency] of character.proficiencies.entries()) {
      if (character.rule !== 'dnd' || !dndProficiencies.has(proficiency))
        issue(['proficiencies', index], '不支持的熟练项');
    }
    if (new Set(character.proficiencies).size !== character.proficiencies.length)
      issue(['proficiencies'], '熟练项不可重复');
    if (new Set(character.items.map((item) => item.id)).size !== character.items.length)
      issue(['items'], '物品标识符不可重复');
    if (character.hp > character.maxHp) issue(['hp'], '当前 HP 不可超过上限');
    if (character.mp > character.maxMp) issue(['mp'], '当前 MP 不可超过上限');
    if (character.san > character.maxSan) issue(['san'], '当前 SAN 不可超过上限');
    for (const error of getAdjustmentErrors(character)) issue(['adjustments'], error);
  });

const FIELD_LABELS: Record<string, string> = {
  name: '姓名',
  occupation: '职业',
  ancestry: '族裔',
  background: '背景',
  age: '年龄',
  level: '等级',
  attributes: '属性',
  skills: '技能',
  proficiencies: '熟练项',
  adjustments: '局内修正',
  backstory: '人物经历',
  notes: '笔记',
  traits: '词条',
  hp: 'HP',
  maxHp: 'HP 上限',
  mp: 'MP',
  maxMp: 'MP 上限',
  san: 'SAN',
  maxSan: 'SAN 上限',
  ac: 'AC',
  items: '物品',
  createdAt: '创建时间',
  updatedAt: '更新时间',
  id: '人物标识符',
  rule: '规则',
  schemaVersion: '格式版本',
};

function preflightCharacter(value: unknown): string | undefined {
  // Some schema parsers intentionally omit __proto__. Reject it explicitly,
  // rather than silently accepting a different document than the one supplied.
  const pending = [{ value, depth: 0 }];
  const seen = new Set<object>();
  let visited = 0;
  while (pending.length) {
    const entry = pending.pop()!;
    if (++visited > 10000 || entry.depth > 8) return '人物卡的数据结构过大或嵌套过深';
    if (typeof entry.value !== 'object' || entry.value === null) continue;
    if (seen.has(entry.value)) return '人物卡不允许循环或重复对象引用';
    seen.add(entry.value);
    for (const [key, child] of Object.entries(entry.value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype')
        return '人物卡包含不允许的对象键名';
      pending.push({ value: child, depth: entry.depth + 1 });
    }
  }
}

/** Completion checks also validate imported/untrusted objects at runtime. */
export function getCharacterErrors(character: Character): string[] {
  const preflight = preflightCharacter(character);
  if (preflight) return [preflight];
  const parsed = CharacterSchema.safeParse(character);
  if (!parsed.success) {
    return [
      ...new Set(
        parsed.error.issues.map((issue) => {
          const field = String(issue.path[0] ?? '人物卡');
          return `${FIELD_LABELS[field] ?? field}：${issue.message}`;
        }),
      ),
    ];
  }
  const errors: string[] = [];
  if (!parsed.data.name.trim()) errors.push('请填写人物姓名');
  if (!parsed.data.occupation.trim())
    errors.push(parsed.data.rule === 'dnd' ? '请选择或填写职业' : '请填写调查员职业');
  return errors;
}

const TRAITS: Record<RuleId, string[][]> = {
  dnd: [
    [
      '向每一个陌生人打招呼',
      '在紧张时擦拭一枚旧徽章',
      '习惯先听别人把话说完',
      '总为同行者留一份口粮',
      '越是危险越喜欢开玩笑',
      '遇到岔路总想画一张地图',
    ],
    [
      '想归还一件不属于自己的遗物',
      '为失踪的导师寻找线索',
      '希望让家乡重新出现在地图上',
      '欠过一个敌人救命之恩',
      '守着一个连自己也不理解的约定',
      '寻找一首没有结尾的歌',
    ],
    [
      '害怕失去伙伴的信任',
      '很难拒绝一场公平的挑战',
      '看见求助信就无法绕路',
      '对无法解释的魔法过分好奇',
      '总把自己的伤势说得很轻',
      '容易相信讲述好故事的人',
    ],
  ],
  coc: [
    [
      '做笔记时会描画同一个符号',
      '遇到沉默便下意识查看怀表',
      '习惯记住每一扇出口的位置',
      '总带着一本封面磨损的书',
      '不肯让旁人整理自己的桌面',
      '只在非常紧张时点烟',
    ],
    [
      '一封没有寄件人的来信',
      '一张多出陌生人的旧合照',
      '来自故乡的重复求救电话',
      '档案里被整页撕去的记录',
      '某位亲属留下的未竟调查',
      '一次始终无法解释的失踪',
    ],
    [
      '仍相信一切最终都有科学解释',
      '为了保护朋友愿意隐瞒真相',
      '无法放下对失踪亲人的愧疚',
      '对过分安静的房间感到不安',
      '害怕自己的记忆并不可靠',
      '相信承诺比证据更难伪造',
    ],
  ],
};

/** Original flavor prompts; independent of attributes and freely rerollable. */
export function randomTraits(rule: RuleId): string[] {
  requireRule(rule);
  return TRAITS[rule].map((choices) => choices[secureDie(choices.length) - 1]);
}

function rolledAttributes(
  rule: RuleId,
  rng: DieRandom,
  cocLimits?: CocAttributeRollLimits,
): Record<string, number> {
  if (rule === 'coc' && cocLimits) return rollCocAttributes(cocLimits, rng);
  const attributes = rule === 'dnd' ? DND_ATTRIBUTES : COC_ATTRIBUTES;
  return Object.fromEntries(
    attributes.map(({ key }) => {
      if (rule === 'dnd') {
        const values = Array.from({ length: 4 }, () => die(6, rng)).sort((a, b) => a - b);
        return [key, values.slice(1).reduce((sum, value) => sum + value, 0)];
      }
      const large = ['siz', 'int', 'edu'].includes(key);
      const sum = Array.from({ length: large ? 2 : 3 }, () => die(6, rng)).reduce(
        (total, value) => total + value,
        large ? 6 : 0,
      );
      return [key, sum * 5];
    }),
  );
}

/**
 * Recompute CoC maximum resources. Current resources never rise as a side
 * effect of editing; D&D HP/AC stay manual. Creation/reroll explicitly refill.
 */
export function deriveCharacter(character: Character): Character {
  requireRule(character.rule);
  let maxHp = character.maxHp;
  let maxMp = character.maxMp;
  let maxSan = character.maxSan;
  if (character.rule === 'coc') {
    maxHp = Math.max(1, Math.floor((character.attributes.con + character.attributes.siz) / 10));
    maxMp = Math.floor(character.attributes.pow / 5);
    maxSan = Math.max(0, 99 - (character.skills.cthulhuMythos ?? 0));
  }
  return {
    ...character,
    maxHp,
    maxMp,
    maxSan,
    hp: Math.max(0, Math.min(character.hp, maxHp)),
    mp: Math.max(0, Math.min(character.mp, maxMp)),
    san: Math.max(0, Math.min(character.san, maxSan)),
    updatedAt: new Date().toISOString(),
  };
}

/** Blank manual identity fields are intentional; readiness requires filling them. */
export function createCharacter(
  rule: RuleId,
  rng: DieRandom = secureDie,
  cocLimits?: CocAttributeRollLimits,
): Character {
  requireRule(rule);
  const now = new Date().toISOString();
  const attributes = rolledAttributes(rule, rng, cocLimits);
  const character: Character = {
    schemaVersion: 1,
    id: globalThis.crypto.randomUUID(),
    rule,
    name: '',
    occupation: '',
    ancestry: '',
    background: '',
    age: 25,
    level: 1,
    attributes,
    skills:
      rule === 'coc'
        ? Object.fromEntries(
            COC_SKILLS.map(({ key, base }) => [
              key,
              key === 'dodge'
                ? Math.floor(attributes.dex / 2)
                : key === 'ownLanguage'
                  ? attributes.edu
                  : base,
            ]),
          )
        : {},
    proficiencies: [],
    hp: 0,
    maxHp: rule === 'dnd' ? Math.max(1, 8 + abilityModifier(attributes.con)) : 1,
    mp: 0,
    maxMp: 0,
    san: 0,
    maxSan: rule === 'coc' ? 99 : 0,
    ac: rule === 'dnd' ? 10 + abilityModifier(attributes.dex) : 0,
    backstory: '',
    notes: '',
    traits: randomTraits(rule),
    items: [],
    creation: defaultAllocation(rule),
    createdAt: now,
    updatedAt: now,
  };
  const derived = deriveCharacter(syncAllocation(character));
  return {
    ...derived,
    hp: derived.maxHp,
    mp: derived.maxMp,
    san: rule === 'coc' ? Math.min(attributes.pow, derived.maxSan) : 0,
  };
}

/** Like manual attribute edits: update derived values without healing or erasing allocations. */
export function reduceCocAttributes(
  character: Character,
  limits: CocAttributeRollLimits,
): Character {
  if (character.rule !== 'coc') throw new Error('按比例降低仅适用于 CoC 调查员属性。');
  const attributes = scaleCocAttributes(character.attributes, limits);
  return deriveCharacter(syncAllocation({ ...character, attributes }));
}

/** Creation-time action: new base attributes, refilled HP/MP and initial SAN. */
export function rerollAttributes(
  character: Character,
  rng: DieRandom = secureDie,
  cocLimits?: CocAttributeRollLimits,
): Character {
  requireRule(character.rule);
  const attributes = rolledAttributes(character.rule, rng, cocLimits);
  const skills = { ...character.skills };
  if (character.rule === 'coc') {
    // Preserve allocated points above the old attribute-based skill minimums.
    skills.dodge = Math.min(
      100,
      Math.max(
        0,
        (skills.dodge ?? Math.floor(character.attributes.dex / 2)) -
          Math.floor(character.attributes.dex / 2) +
          Math.floor(attributes.dex / 2),
      ),
    );
    skills.ownLanguage = Math.min(
      100,
      Math.max(
        0,
        (skills.ownLanguage ?? character.attributes.edu) -
          character.attributes.edu +
          attributes.edu,
      ),
    );
  }
  const derived = deriveCharacter(
    syncAllocation({
      ...character,
      attributes,
      skills,
      ...(character.rule === 'dnd'
        ? {
            maxHp: Math.max(1, 8 + abilityModifier(attributes.con)),
            ac: 10 + abilityModifier(attributes.dex),
          }
        : {}),
    }),
  );
  return {
    ...derived,
    hp: derived.maxHp,
    mp: derived.maxMp,
    san: character.rule === 'coc' ? Math.min(attributes.pow, derived.maxSan) : 0,
  };
}

function completedCharacter(value: unknown, expectedRule?: RuleId): Character {
  if (expectedRule !== undefined) requireRule(expectedRule);
  const preflight = preflightCharacter(value);
  if (preflight) throw new Error(preflight);
  const parsed = CharacterSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      `人物卡格式不正确：${getCharacterErrors(value as Character)
        .slice(0, 3)
        .join('；')}`,
    );
  const character = parsed.data;
  if (expectedRule && character.rule !== expectedRule)
    throw new Error(
      `人物卡规则不匹配：当前房间使用 ${expectedRule === 'dnd' ? 'D&D 5e' : 'CoC 7'}`,
    );
  const errors = getCharacterErrors(character);
  if (errors.length) throw new Error(errors.join('；'));
  return character;
}

/** Reads this app's JSON or a Markdown document with exactly one JSON fence. */
export function parseCharacter(text: string, expectedRule?: RuleId): Character {
  if (typeof text !== 'string' || text.length > 256000)
    throw new Error('人物卡文件最多 256000 个字符');
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) throw new Error('人物卡文件为空');
  let source = trimmed;
  if (!trimmed.startsWith('{')) {
    const fences = [...trimmed.matchAll(/^(`{3,})json[ \t]*\r?\n([\s\S]*?)^\1[ \t]*$/gm)];
    if (fences.length !== 1) throw new Error('Markdown 中须包含且仅包含一个完整的 json 代码块');
    source = fences[0][2];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error('无法读取 JSON，请检查人物卡文件格式');
  }
  return completedCharacter(parsed, expectedRule);
}

export function exportCharacter(character: Character, format: 'json' | 'md'): string {
  const valid = completedCharacter(character);
  const json = JSON.stringify(valid, null, 2);
  if (format === 'json') return `${json}\n`;
  if (format !== 'md') throw new Error('只支持 JSON 或 Markdown 导出');
  const heading = valid.name.replace(/[\r\n]/g, ' ');
  const effective = effectiveCharacter(valid);
  const clean = (text: string) => text.replace(/[\r\n|`]/g, ' ');
  const adjustments = hasAdjustments(valid)
    ? `\n\n## 局内修正\n\n属性表保留制卡原始值。以下修正已经计入检定，临时效果需要主持人手动结束。\n\n${valid.adjustments!.permanent.map((entry) => `- 长期 · ${adjustmentLabel(valid, entry.target, entry.key)} ${entry.amount >= 0 ? '+' : ''}${entry.amount}${entry.reason ? ` · ${clean(entry.reason)}` : ''}`).join('\n')}\n${valid.adjustments!.temporary.map((effect) => `- 临时 · ${clean(effect.name)} · ${effect.enabled ? '生效中' : '已停用'} · ${effect.changes.map((entry) => `${adjustmentLabel(valid, entry.target, entry.key)} ${entry.amount >= 0 ? '+' : ''}${entry.amount}`).join('、')} · 结束条件：${clean(effect.endCondition) || '主持人手动结束'}`).join('\n')}\n\n当前生效属性：${(valid.rule === 'dnd' ? DND_ATTRIBUTES : COC_ATTRIBUTES).map(({ key, label }) => `${label} ${effective.attributes[key]}`).join(' · ')}`
    : '';
  const rows = (valid.rule === 'dnd' ? DND_ATTRIBUTES : COC_ATTRIBUTES)
    .map(({ key, label }) => `| ${label} | ${valid.attributes[key]} |`)
    .join('\n');
  return `# ${heading} · 人物卡\n\n规则：${valid.rule === 'dnd' ? 'D&D 5e (2014) · SRD 5.1' : 'Call of Cthulhu 7'}\n\n职业：${valid.occupation.replace(/[\r\n]/g, ' ')}\n\n| 属性 | 数值 |\n| --- | ---: |\n${rows}\n\nHP ${valid.hp}/${valid.maxHp}${valid.rule === 'coc' ? ` · MP ${valid.mp}/${valid.maxMp} · SAN ${valid.san}/${valid.maxSan}` : ` · AC ${valid.ac}`}${adjustments}\n\n## 可再次导入的数据\n\n下方 JSON 是完整、可移植的人物记录；上方摘要仅供阅读。重新导入时以 JSON 为准。\n\n\`\`\`json\n${json}\n\`\`\`\n`;
}
