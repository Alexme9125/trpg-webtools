import { describe, expect, it } from 'vitest';
import {
  COC_OCCUPATION_RULES,
  DND_CLASS_RULES,
  CreationAllocationSchema,
  CreationPolicySchema,
  cocBudget,
  defaultCreationPolicy,
  dndSkillModifier,
  suggestAllocation,
  syncAllocation,
  validateCreation,
  type CocAllocation,
  type DndAllocation,
  type CreationPolicy,
} from '../shared/creation';
import { DND_SKILLS } from '../shared/catalog';
import { createCharacter, deriveCharacter, getCharacterErrors } from '../shared/rules';
import type { Character } from '../shared/types';

function fixture(
  rule: 'dnd' | 'coc',
  occupation = rule === 'dnd' ? '战士' : '教授',
  ancestry = '人类',
  level = 1,
): Character {
  const base = createCharacter(rule, (sides) => Math.ceil(sides / 2));
  const card = deriveCharacter({
    ...base,
    name: '分配测试',
    occupation,
    ancestry,
    level,
    attributes:
      rule === 'dnd'
        ? { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }
        : { str: 50, con: 50, siz: 60, dex: 60, app: 50, int: 60, pow: 50, edu: 60, luck: 50 },
  });
  return suggestAllocation(card, defaultCreationPolicy(rule));
}
function cocChange(card: Character, edit: (allocation: CocAllocation) => void): Character {
  const copy = structuredClone(card);
  if (copy.creation?.rule !== 'coc') throw new Error('Expected CoC allocation');
  edit(copy.creation);
  return deriveCharacter(syncAllocation(copy));
}
function dndChange(card: Character, edit: (allocation: DndAllocation) => void): Character {
  const copy = structuredClone(card);
  if (copy.creation?.rule !== 'dnd') throw new Error('Expected DND allocation');
  edit(copy.creation);
  return syncAllocation(copy);
}
function minimalCoc(occupation = '教授'): Character {
  const minimum = COC_OCCUPATION_RULES.find((profile) => profile.name === occupation)!.credit[0];
  return cocChange(fixture('coc', occupation), (allocation) => {
    allocation.occupational = { creditRating: minimum };
    allocation.personal = {};
  });
}
const errors = (card: Character, policy: CreationPolicy = defaultCreationPolicy(card.rule)) =>
  validateCreation(card, policy).join('\n');
const dndCases = [
  ['野蛮人', 2],
  ['吟游诗人', 3],
  ['牧师', 2],
  ['德鲁伊', 2],
  ['战士', 2],
  ['武僧', 2],
  ['圣武士', 2],
  ['游侠', 3],
  ['游荡者', 4],
  ['术士', 2],
  ['邪术师', 2],
  ['法师', 2],
] as const;
const cocCases = [
  '古物学家',
  '作家',
  '记者',
  '私家侦探',
  '医生',
  '教授',
  '警探',
  '艺术家',
  '神职人员',
  '军人',
  '考古学家',
];

describe('合法职业分配与建议分配', () => {
  it.each(dndCases)('DND %s 建议分配合规，职业技能数量为 %i', (occupation, count) => {
    const card = fixture('dnd', occupation);
    expect(getCharacterErrors(card)).toEqual([]);
    expect(validateCreation(card, defaultCreationPolicy('dnd'))).toEqual([]);
    expect((card.creation as DndAllocation).classSkills).toHaveLength(count);
    const short = dndChange(card, (allocation) => {
      allocation.classSkills.pop();
    });
    expect(errors(short)).toContain(`须从职业范围选择 ${count} 项技能`);
    const profile = DND_CLASS_RULES.find((entry) => entry.name === occupation)!;
    const prohibited =
      DND_SKILLS.find((skill) => !profile.skills.includes(skill.key))?.key ?? 'inventedSkill';
    const wrong = dndChange(card, (allocation) => {
      allocation.classSkills[0] = prohibited;
    });
    expect(errors(wrong)).toContain('须从职业范围选择');
  });

  it.each(cocCases)('CoC %s 建议分配符合职业、信用及两类点数预算', (occupation) => {
    const card = fixture('coc', occupation);
    expect(getCharacterErrors(card)).toEqual([]);
    expect(
      validateCreation(card, { ...defaultCreationPolicy('coc'), requireAllPoints: true }),
    ).toEqual([]);
    expect((card.creation as CocAllocation).occupationSkills).toHaveLength(8);
    const budget = cocBudget(card);
    expect(budget.spentOccupation).toBe(budget.occupational);
    expect(budget.spentPersonal).toBe(120);
  });

  it('建议分配不修改原卡，也不把受房间上限限制的余点当作已分配', () => {
    const original = minimalCoc();
    const before = structuredClone(original);
    const restricted = { ...defaultCreationPolicy('coc'), cocSkillCap: 60 };
    const result = suggestAllocation(original, restricted);
    expect(original).toEqual(before);
    expect(cocBudget(result).spentOccupation).toBeLessThanOrEqual(cocBudget(result).occupational);
    expect(cocBudget(result).spentPersonal).toBeLessThanOrEqual(cocBudget(result).personal);
  });
});

describe('CoC 账本和职业约束', () => {
  it('职业点 EDU×4、兴趣点 INT×2，并拒绝分别超支', () => {
    const card = fixture('coc');
    expect(cocBudget(card)).toMatchObject({ occupational: 240, personal: 120 });
    const overOccupation = cocChange(card, (a) => {
      a.occupational[a.occupationSkills[0]] += 1;
    });
    const overPersonal = cocChange(card, (a) => {
      a.personal.accounting = (a.personal.accounting ?? 0) + 1;
    });
    expect(errors(overOccupation)).toContain('职业点超支 1 点');
    expect(errors(overPersonal)).toContain('兴趣点超支 1 点');
  });

  it('混合公式使用职业允许的属性，不接受换成其他属性扩大预算', () => {
    const card = fixture('coc', '私家侦探');
    expect((card.creation as CocAllocation).occupationAttribute).toBe('dex');
    expect(cocBudget(card).occupational).toBe(240);
    const forged = cocChange(card, (a) => {
      a.occupationAttribute = 'pow';
    });
    expect(errors(forged)).toContain('职业点公式使用了不允许的属性');
  });

  it('职业点只能分给所选八项和信用；兴趣点可以用于非职业技能', () => {
    const card = minimalCoc();
    const a = card.creation as CocAllocation;
    const outside = ['firearmsHandgun', 'fightingBrawl', 'stealth'].find(
      (key) => !a.occupationSkills.includes(key),
    )!;
    expect(
      errors(
        cocChange(card, (allocation) => {
          allocation.occupational[outside] = 1;
        }),
      ),
    ).toContain('职业点不能用于');
    expect(
      validateCreation(
        cocChange(card, (allocation) => {
          allocation.personal[outside] = 1;
        }),
        defaultCreationPolicy('coc'),
      ),
    ).toEqual([]);
    expect(
      errors(
        cocChange(card, (allocation) => {
          allocation.personal.unknownSkill = 0;
        }),
      ),
    ).toContain('兴趣点不能用于');
  });

  it('信用可以由两类点数共同分配，最终范围及各自预算仍受约束', () => {
    const card = cocChange(minimalCoc(), (a) => {
      a.occupational.creditRating = 19;
      a.personal.creditRating = 1;
    });
    expect(card.skills.creditRating).toBe(20);
    expect(validateCreation(card, defaultCreationPolicy('coc'))).toEqual([]);
    expect(cocBudget(card)).toMatchObject({ spentOccupation: 19, spentPersonal: 1 });
    expect(
      errors(
        cocChange(minimalCoc(), (a) => {
          a.personal.creditRating = 121;
        }),
      ),
    ).toContain('兴趣点超支 1 点');
  });

  it.each([19, 71])('教授信用 %i 超出20–70时拒绝，边界20/70可以保留余点', (credit) => {
    expect(
      errors(
        cocChange(minimalCoc(), (a) => {
          a.occupational.creditRating = credit;
        }),
      ),
    ).toContain('信用评级须在职业范围 20–70 内');
    for (const allowed of [20, 70])
      expect(
        validateCreation(
          cocChange(minimalCoc(), (a) => {
            a.occupational.creditRating = allowed;
          }),
          defaultCreationPolicy('coc'),
        ),
      ).toEqual([]);
  });

  it('未用完点数默认可保留，主持人启用要求用完后拒绝', () => {
    const card = minimalCoc();
    expect(validateCreation(card, defaultCreationPolicy('coc'))).toEqual([]);
    expect(errors(card, { ...defaultCreationPolicy('coc'), requireAllPoints: true })).toContain(
      '要求分完职业点与兴趣点',
    );
  });

  it('医生分别记录生物学和药学，不可用重复科学项替代', () => {
    const card = fixture('coc', '医生');
    expect((card.creation as CocAllocation).occupationSkills).toEqual(
      expect.arrayContaining(['scienceBiology', 'sciencePharmacy']),
    );
    const wrong = cocChange(card, (a) => {
      a.occupationSkills[a.occupationSkills.indexOf('sciencePharmacy')] = 'scienceBiology';
    });
    expect(errors(wrong)).toContain('八个位置须符合');
    expect(errors(wrong)).toContain('职业技能不可重复');
  });

  it('新卡神话默认0；主持人允许例外后仍须有兴趣点来源并重算SAN上限', () => {
    const card = cocChange(minimalCoc(), (a) => {
      a.personal.cthulhuMythos = 3;
    });
    expect(card.skills.cthulhuMythos).toBe(3);
    expect(card.maxSan).toBe(96);
    expect(errors(card)).toContain('克苏鲁神话须为 0');
    expect(validateCreation(card, { ...defaultCreationPolicy('coc'), allowMythos: true })).toEqual(
      [],
    );
    const forged = {
      ...minimalCoc(),
      skills: { ...minimalCoc().skills, cthulhuMythos: 3 },
      maxSan: 96,
    };
    expect(errors(forged, { ...defaultCreationPolicy('coc'), allowMythos: true })).toContain(
      '合计不一致',
    );
  });

  it('最终技能必须与基础和两类点数一致，不能直接改百分比或加入未知技能', () => {
    const card = minimalCoc();
    expect(errors({ ...card, skills: { ...card.skills, spotHidden: 99 } })).toContain('合计不一致');
    expect(errors({ ...card, skills: { ...card.skills, inventedSkill: 0 } })).toContain(
      '没有分配来源的自定义技能',
    );
    expect(errors({ ...card, maxHp: card.maxHp + 1 })).toContain('上限与属性及克苏鲁神话不一致');
  });

  it.each([-1, 1.5, 1000])('拒绝非法分配点数 %s', (value) => {
    const allocation = structuredClone(minimalCoc().creation) as CocAllocation;
    allocation.personal.spotHidden = value;
    expect(CreationAllocationSchema.safeParse(allocation).success).toBe(false);
  });

  it.each(['__proto__', 'constructor', 'prototype'])('拒绝账本中的危险对象键 %s', (key) => {
    const card = structuredClone(minimalCoc());
    const allocation = card.creation as CocAllocation;
    allocation.personal = JSON.parse(`{"${key}":1}`);
    expect(CreationAllocationSchema.safeParse(allocation).success).toBe(false);
    expect(validateCreation(card, defaultCreationPolicy('coc'))).not.toEqual([]);
  });
});

describe('DND 来源、种族和专精', () => {
  it('背景须恰选两项，重复职业项必须另外补选', () => {
    const card = dndChange(fixture('dnd'), (a) => {
      a.classSkills = ['athletics', 'history'];
      a.backgroundSkills = ['athletics', 'stealth'];
      a.replacementSkills = [];
    });
    expect(errors(card)).toContain('重复来源须补选 1 项');
    const replaced = dndChange(card, (a) => {
      a.replacementSkills = ['perception'];
    });
    expect(validateCreation(replaced, defaultCreationPolicy('dnd'))).toEqual([]);
    expect(
      errors(
        dndChange(replaced, (a) => {
          a.replacementSkills = ['athletics'];
        }),
      ),
    ).toContain('补选和额外技能不可重复');
    expect(
      errors(
        dndChange(fixture('dnd'), (a) => {
          a.backgroundSkills.pop();
        }),
      ),
    ).toContain('背景须选择 2 项');
  });

  it('精灵固定察觉，半精灵自选两项，半兽人固定威吓', () => {
    for (const [ancestry, skill] of [
      ['精灵', 'perception'],
      ['半兽人', 'intimidation'],
    ] as const) {
      const card = fixture('dnd', '战士', ancestry);
      expect(card.proficiencies).toContain(`skill:${skill}`);
      expect(validateCreation(card, defaultCreationPolicy('dnd'))).toEqual([]);
      expect(
        errors(
          dndChange(card, (a) => {
            a.ancestrySkills = ['insight'];
          }),
        ),
      ).toContain('须自选 0 项');
    }
    const halfElf = fixture('dnd', '战士', '半精灵');
    expect((halfElf.creation as DndAllocation).ancestrySkills).toHaveLength(2);
    expect(validateCreation(halfElf, defaultCreationPolicy('dnd'))).toEqual([]);
    expect(
      errors(
        dndChange(halfElf, (a) => {
          a.ancestrySkills.pop();
        }),
      ),
    ).toContain('须自选 2 项');
  });

  it('只有主持人的额外名额可增加技能或豁免，不能重复基础来源', () => {
    const card = fixture('dnd');
    const extra = dndChange(card, (a) => {
      a.extraSkills = ['insight'];
      a.extraSaves = ['dex'];
    });
    expect(errors(extra)).toContain('额外技能熟练超出');
    expect(errors(extra)).toContain('额外豁免熟练超出');
    const policy = { ...defaultCreationPolicy('dnd'), dndExtraSkills: 1, dndExtraSaves: 2 };
    expect(validateCreation(extra, policy)).toEqual([]);
    expect(
      errors(
        dndChange(extra, (a) => {
          a.extraSaves = ['dex', 'dex'];
        }),
        policy,
      ),
    ).toContain('额外豁免不可重复');
    expect(
      errors(
        dndChange(extra, (a) => {
          a.extraSaves = ['con'];
        }),
        policy,
      ),
    ).toContain('额外豁免熟练超出');
    expect(
      errors(
        dndChange(extra, (a) => {
          a.extraSkills = [a.classSkills[0]];
        }),
        policy,
      ),
    ).toContain('补选和额外技能不可重复');
  });

  it('专精只允许当前职业等级的已熟练技能，并按两倍熟练计算', () => {
    const rogue = fixture('dnd', '游荡者');
    const expert = dndChange(rogue, (a) => {
      a.expertise = ['athletics'];
    });
    expect(validateCreation(expert, defaultCreationPolicy('dnd'))).toEqual([]);
    expect(dndSkillModifier(expert, 'athletics')).toBe(6);
    const untrained = DND_SKILLS.find(
      (skill) => !rogue.proficiencies.includes(`skill:${skill.key}`),
    )!.key;
    expect(
      errors(
        dndChange(rogue, (a) => {
          a.expertise = [untrained];
        }),
      ),
    ).toContain('专精须选择已熟练技能');
    const trained = rogue.proficiencies
      .filter((value) => value.startsWith('skill:'))
      .map((value) => value.slice(6));
    expect(
      errors(
        dndChange(rogue, (a) => {
          a.expertise = trained.slice(0, 3);
        }),
      ),
    ).toContain('不能超过当前职业等级');
    expect(
      errors(
        dndChange(fixture('dnd'), (a) => {
          a.expertise = [a.classSkills[0]];
        }),
      ),
    ).toContain('不能超过当前职业等级');
    const levelSix = dndChange(fixture('dnd', '游荡者', '人类', 6), (a) => {
      a.expertise = trained.slice(0, 4);
    });
    expect(validateCreation(levelSix, defaultCreationPolicy('dnd'))).toEqual([]);
  });

  it('技能最终加值、熟练列表不能脱离记录伪造；未知职业拒绝', () => {
    const card = fixture('dnd');
    expect(errors({ ...card, skills: { ...card.skills, athletics: 99 } })).toContain(
      '不能自由填写',
    );
    expect(errors({ ...card, proficiencies: [...card.proficiencies, 'save:wis'] })).toContain(
      '熟练项与职业',
    );
    expect(errors({ ...card, occupation: '自封职业' })).toContain('请选择 SRD 5.1 支持的职业');
  });

  it.each([
    [1, 0],
    [3, 2],
    [10, 4],
  ])('吟游诗人等级%i的专精名额为%i', (level, quota) => {
    const card = fixture('dnd', '吟游诗人', '人类', level);
    const trained = card.proficiencies
      .filter((value) => value.startsWith('skill:'))
      .map((value) => value.slice(6));
    const allowed = dndChange(card, (a) => {
      a.expertise = trained.slice(0, quota);
    });
    expect(validateCreation(allowed, defaultCreationPolicy('dnd'))).toEqual([]);
    const excessive = dndChange(card, (a) => {
      a.expertise = trained.slice(0, quota + 1);
    });
    expect(errors(excessive)).toContain('不能超过当前职业等级');
  });
});

describe('主持人范围与旧卡', () => {
  it('DND属性超过默认20须由主持人显式扩展，CoC技能100须明确单项范围', () => {
    const card = fixture('dnd');
    const higher = syncAllocation({ ...card, attributes: { ...card.attributes, str: 22 } });
    expect(getCharacterErrors(higher)).toEqual([]);
    expect(errors(higher)).toContain('力量须在 1–20 内');
    expect(
      validateCreation(higher, {
        ...defaultCreationPolicy('dnd'),
        ranges: [{ field: 'attributes.str', min: 1, max: 30 }],
      }),
    ).toEqual([]);
    const skill100 = cocChange(minimalCoc(), (a) => {
      a.personal.ownLanguage = 40;
    });
    expect(errors(skill100)).toContain('母语须在 0–99 内');
    expect(
      validateCreation(skill100, {
        ...defaultCreationPolicy('coc'),
        ranges: [{ field: 'skills.ownLanguage', min: 0, max: 100 }],
      }),
    ).toEqual([]);
  });

  it('单项技能上下限均生效；CoC总和排除幸运，DND六项属性总和为72', () => {
    const coc = minimalCoc();
    expect(
      validateCreation(coc, {
        ...defaultCreationPolicy('coc'),
        ranges: [
          { field: 'skills.spotHidden', min: 25, max: 25 },
          { field: 'attributeTotal', min: 440, max: 440 },
        ],
      }),
    ).toEqual([]);
    expect(
      errors(coc, {
        ...defaultCreationPolicy('coc'),
        ranges: [{ field: 'skills.spotHidden', min: 26, max: 40 }],
      }),
    ).toContain('侦查须在 26–40');
    expect(
      errors(coc, {
        ...defaultCreationPolicy('coc'),
        ranges: [{ field: 'skills.spotHidden', min: 0, max: 24 }],
      }),
    ).toContain('侦查须在 0–24');
    const lucky = { ...coc, attributes: { ...coc.attributes, luck: 90 } };
    expect(
      validateCreation(lucky, {
        ...defaultCreationPolicy('coc'),
        ranges: [{ field: 'attributeTotal', min: 440, max: 440 }],
      }),
    ).toEqual([]);
    expect(
      errors(fixture('dnd'), {
        ...defaultCreationPolicy('dnd'),
        ranges: [{ field: 'attributeTotal', min: 0, max: 71 }],
      }),
    ).toContain('当前 72');
  });

  it.each(
    [
      [
        { field: 'attributes.str', min: 1, max: 50 },
        { field: 'attributes.str', min: 1, max: 90 },
      ],
      [{ field: 'madeUpField', min: 0, max: 1 }],
      [{ field: 'attributes.wis', min: 1, max: 99 }],
      [{ field: 'hp', min: 20, max: 10 }],
      [{ field: 'attributes.constructor', min: 1, max: 99 }],
    ].map((ranges) => ({ ranges })),
  )('政策拒绝重复、未知、其他规则、倒置或危险范围 $ranges', ({ ranges }) => {
    expect(
      CreationPolicySchema.safeParse({ ...defaultCreationPolicy('coc'), ranges }).success,
    ).toBe(false);
  });

  it('限制职业／种族列表，旧卡缺分配记录或记录规则错误时不能审核', () => {
    const card = fixture('dnd');
    expect(
      errors(card, { ...defaultCreationPolicy('dnd'), allowedOccupations: ['法师'] }),
    ).toContain('职业不在本剧本');
    expect(
      errors(card, { ...defaultCreationPolicy('dnd'), allowedAncestries: ['精灵'] }),
    ).toContain('种族／国籍不在');
    const legacy = structuredClone(card);
    delete legacy.creation;
    expect(getCharacterErrors(legacy)).toEqual([]);
    expect(errors(legacy)).toContain('旧版卡片需重新分配');
    expect(errors({ ...card, creation: fixture('coc').creation })).toContain('旧版卡片需重新分配');
    expect(errors(card, defaultCreationPolicy('coc'))).toContain('规则不匹配');
  });
});
