import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, CircleAlert, RefreshCw, ShieldCheck } from 'lucide-react';
import type { Character } from '../../shared/types';
import { COC_SKILLS, DND_SKILLS, DND_ATTRIBUTES } from '../../shared/rules';
import {
  COC_OCCUPATION_RULES,
  DND_CLASS_RULES,
  cocBudget,
  cocSkillBase,
  defaultAllocation,
  dndAncestry,
  dndSaves,
  dndSkillModifier,
  expertiseLimit,
  occupationOptions,
  replacementCount,
  skillRange,
  suggestAllocation,
  syncAllocation,
  validateCreation,
  type CreationPolicy,
  type DndAllocation,
} from '../../shared/creation';

export function ValidationSummary({
  errors,
  compact = false,
}: {
  errors: string[];
  compact?: boolean;
}) {
  return (
    <div className={`validation-summary ${errors.length ? 'needs-work' : 'valid'}`} role="status">
      {errors.length ? <CircleAlert size={17} /> : <ShieldCheck size={17} />}
      <div>
        <b>{errors.length ? `还有 ${errors.length} 项需要调整` : '数值检查通过'}</b>
        {errors.length > 0 && (
          <ul>
            {errors.slice(0, compact ? 3 : 7).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {errors.length > (compact ? 3 : 7) && (
          <details>
            <summary>查看其余限制</summary>
            <ul>
              {errors.slice(compact ? 3 : 7).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </details>
        )}
        {!errors.length && <p>入席前仍需主持人审核角色设定。</p>}
      </div>
    </div>
  );
}
export function AllocationEditor({
  card,
  policy,
  onChange,
}: {
  card: Character;
  policy: CreationPolicy;
  onChange: (card: Character) => void;
}) {
  const [search, setSearch] = useState('');
  const budgetRef = useRef<HTMLDivElement>(null);
  const [floatingBudget, setFloatingBudget] = useState(false);
  const [budgetOffset, setBudgetOffset] = useState(60);
  const a = card.creation;
  useEffect(() => {
    const overview = budgetRef.current;
    const scrollRoot = overview?.closest('.modal-content');
    const tabs = scrollRoot?.querySelector('.editor-tabs');
    const lastCounter = overview?.children[1];
    if (!overview || !scrollRoot || !lastCounter || a?.rule !== 'coc') return;
    let observer: IntersectionObserver | undefined;
    const update = () => {
      const offset = Math.ceil(tabs?.getBoundingClientRect().height ?? 52);
      setBudgetOffset(offset + 8);
      observer?.disconnect();
      observer = new IntersectionObserver(
        () => {
          setFloatingBudget(
            lastCounter.getBoundingClientRect().bottom <=
              scrollRoot.getBoundingClientRect().top + offset,
          );
        },
        { root: scrollRoot, rootMargin: `-${offset}px 0px 0px 0px`, threshold: [0, 1] },
      );
      observer.observe(lastCounter);
    };
    const resize = new ResizeObserver(update);
    resize.observe(scrollRoot);
    if (tabs) resize.observe(tabs);
    update();
    return () => {
      observer?.disconnect();
      resize.disconnect();
    };
  }, [a?.rule, card.id]);
  const set = (creation: NonNullable<Character['creation']>) =>
    onChange(syncAllocation({ ...card, creation }));
  const errors = validateCreation(card, policy);
  if (!a || a.rule !== card.rule)
    return (
      <div className="legacy-allocation">
        <CircleAlert size={24} />
        <h3>这张旧卡没有记录技能来源</h3>
        <p>原数值仍保留在卡中。开始重新分配会按规则基础值重建技能，建议先导出旧卡备份。</p>
        <button
          className="button primary"
          onClick={() => set(defaultAllocation(card.rule, card.occupation))}
        >
          开始重新分配
        </button>
      </div>
    );
  const recommend = () => onChange(suggestAllocation(card, policy));
  const header = (
    <div className="allocation-heading">
      <div>
        <span className="mini-label">CHARACTER ALLOCATION</span>
        <h3>每一份能力，都有来处。</h3>
        <p>
          {card.rule === 'coc'
            ? '基础值 + 职业投入 + 兴趣投入 = 最终技能值'
            : '按来源选择熟练项，检定加值自动计算。'}
        </p>
      </div>
      <button className="button secondary compact" onClick={recommend}>
        <RefreshCw size={14} />
        建议分配
      </button>
    </div>
  );
  if (a.rule === 'coc') {
    const profile = COC_OCCUPATION_RULES.find((p) => p.name === card.occupation);
    const budget = cocBudget(card);
    const occupied = new Set([...a.occupationSkills, 'creditRating']);
    const restrictedInterest = policy.allowInterestOnOccupation === false;
    const invalidInterest =
      restrictedInterest && [...occupied].some((key) => (a.personal[key] ?? 0) > 0);
    const updatePoints = (key: string, pool: 'occupational' | 'personal', value: number) =>
      set({
        ...a,
        [pool]: { ...a[pool], [key]: Math.max(0, Math.min(99, Math.trunc(value) || 0)) },
      });
    return (
      <div className="allocation-editor">
        {header}
        <div
          className="point-budgets"
          ref={budgetRef}
          style={{ scrollMarginTop: budgetOffset + 8 }}
        >
          <Budget
            label="职业点"
            spent={budget.spentOccupation}
            total={budget.occupational}
            detail={
              profile?.bonus.length
                ? `EDU × 2 + ${a.occupationAttribute.toUpperCase()} × 2`
                : 'EDU × 4'
            }
          />
          <Budget
            label="兴趣点"
            spent={budget.spentPersonal}
            total={budget.personal}
            detail="INT × 2"
          />
          <div className="point-budget">
            <span>信用评级</span>
            <b>{profile ? `${profile.credit[0]}–${profile.credit[1]}` : '先选职业'}</b>
            <small>合计须在职业范围内</small>
          </div>
        </div>
        <div
          className={`budget-follow ${floatingBudget ? 'is-visible' : ''}`}
          style={{ top: budgetOffset }}
          aria-hidden={!floatingBudget}
        >
          <div
            className="budget-float"
            role={floatingBudget ? 'status' : undefined}
            aria-label="剩余分配点数"
          >
            <div className={budget.spentOccupation > budget.occupational ? 'over-budget' : ''}>
              <span>职业点剩余</span>
              <strong>{budget.occupational - budget.spentOccupation}</strong>
            </div>
            <div className={budget.spentPersonal > budget.personal ? 'over-budget' : ''}>
              <span>兴趣点剩余</span>
              <strong>{budget.personal - budget.spentPersonal}</strong>
            </div>
            <button
              className="icon-button small"
              tabIndex={floatingBudget ? 0 : -1}
              aria-label="返回点数总览"
              onClick={() =>
                budgetRef.current?.scrollIntoView({
                  block: 'start',
                  behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
                    ? 'instant'
                    : 'smooth',
                })
              }
            >
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
        <details className="allocation-options" open={!profile}>
          <summary>
            职业技能范围 <span>{profile?.name ?? '请先在角色资料中选择职业'} · 八项技能</span>
          </summary>
          {profile && (
            <>
              {profile.bonus.length > 0 && (
                <label className="field">
                  职业点计算属性
                  <select
                    value={a.occupationAttribute}
                    onChange={(e) => set({ ...a, occupationAttribute: e.target.value })}
                  >
                    {profile.bonus.map((key) => (
                      <option key={key} value={key}>
                        {key.toUpperCase()} · {card.attributes[key]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="occupation-slots">
                {occupationOptions(profile).map((options, i) => (
                  <label className="field" key={i}>
                    职业技能 {i + 1}
                    <select
                      aria-label={`职业技能 ${i + 1}`}
                      value={a.occupationSkills[i] ?? ''}
                      onChange={(e) => {
                        const selections = [...a.occupationSkills];
                        selections[i] = e.target.value;
                        set({ ...a, occupationSkills: selections });
                      }}
                    >
                      <option value="">请选择</option>
                      {options.map((key) => (
                        <option key={key} value={key}>
                          {COC_SKILLS.find((s) => s.key === key)?.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <p className="subtle-note">
                自选位置不能重复；更换技能后，原技能的职业投入需移回允许范围。记者按调查记者、军人按士兵／陆战队员处理。
              </p>
            </>
          )}
        </details>
        <div className="allocation-filter">
          <input
            aria-label="搜索分配技能"
            placeholder="搜索技能名称…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span>技能上限 {policy.cocSkillCap} · 单项范围优先</span>
        </div>
        {restrictedInterest && (
          <div className="allocation-policy-note">
            <p>本房间专点专用：兴趣点不能投入职业技能或信用评级。</p>
            {invalidInterest && (
              <button
                className="button secondary compact"
                onClick={() =>
                  set({
                    ...a,
                    personal: Object.fromEntries(
                      Object.entries(a.personal).map(([key, value]) => [
                        key,
                        occupied.has(key) ? 0 : value,
                      ]),
                    ),
                  })
                }
              >
                退回职业技能上的兴趣点
              </button>
            )}
          </div>
        )}
        <div className="allocation-ledger">
          <div className="allocation-row ledger-head">
            <span>技能 / 基础</span>
            <span>职业点</span>
            <span>兴趣点</span>
            <span>合计</span>
          </div>
          {COC_SKILLS.filter((s) => s.label.includes(search)).map((skill) => {
            const base = cocSkillBase(card, skill.key),
              total = card.skills[skill.key] ?? base;
            const range = skillRange(policy, skill.key);
            const mythosLocked = skill.key === 'cthulhuMythos' && !policy.allowMythos;
            return (
              <div
                className={`allocation-row ${total > range.max || total < range.min ? 'out-of-range' : ''}`}
                key={skill.key}
              >
                <span className="allocation-skill">
                  <b>{skill.label}</b>
                  <small>
                    基础 {base} · 范围 {range.min}–{range.max}
                    {occupied.has(skill.key) && ' · 职业'}
                  </small>
                </span>
                <input
                  aria-label={`${skill.label}职业点`}
                  type="number"
                  min={0}
                  max={Math.max(0, range.max - base - (a.personal[skill.key] ?? 0))}
                  disabled={!occupied.has(skill.key) || mythosLocked}
                  value={a.occupational[skill.key] ?? 0}
                  onChange={(e) => updatePoints(skill.key, 'occupational', Number(e.target.value))}
                />
                <input
                  aria-label={`${skill.label}兴趣点`}
                  type="number"
                  min={0}
                  max={Math.max(0, range.max - base - (a.occupational[skill.key] ?? 0))}
                  disabled={mythosLocked || (restrictedInterest && occupied.has(skill.key))}
                  value={a.personal[skill.key] ?? 0}
                  onChange={(e) => updatePoints(skill.key, 'personal', Number(e.target.value))}
                />
                <strong aria-label={`${skill.label}最终值`}>{total}</strong>
              </div>
            );
          })}
        </div>
        <p className="subtle-note">
          {policy.requireAllPoints
            ? '主持人要求用完两类点数。'
            : '可以保留未分配点数；超支无法通过。'}{' '}
          专业技能分别分配，额外专长请与主持人约定并记录；此处不会把同一技能的点数用于多个专长。
        </p>
        <ValidationSummary errors={errors} />
      </div>
    );
  }
  const cls = DND_CLASS_RULES.find((c) => c.name === card.occupation);
  const ancestry = dndAncestry(card);
  const toggle = (field: keyof Omit<DndAllocation, 'rule'>, key: string) =>
    set({
      ...a,
      [field]: a[field].includes(key) ? a[field].filter((s) => s !== key) : [...a[field], key],
    });
  const group = (
    label: string,
    field: keyof Omit<DndAllocation, 'rule'>,
    choices: string[],
    limit: number,
    helper?: string,
  ) => (
    <fieldset className="proficiency-group">
      <legend>
        {label}
        <span>
          {a[field].length} / {limit}
        </span>
      </legend>
      {helper && <p>{helper}</p>}
      <div className="proficiency-choices">
        {choices.map((key) => {
          const checked = a[field].includes(key);
          return (
            <label key={key} className={checked ? 'selected' : ''}>
              <input
                type="checkbox"
                checked={checked}
                disabled={!checked && a[field].length >= limit}
                onChange={() => toggle(field, key)}
              />
              <span>
                {
                  (field === 'extraSaves' ? DND_ATTRIBUTES : DND_SKILLS).find((s) => s.key === key)
                    ?.label
                }
              </span>
              {checked && <Check size={13} />}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
  return (
    <div className="allocation-editor">
      {header}
      <div className="fixed-saves">
        <ShieldCheck size={18} />
        <span>职业豁免熟练</span>
        <b>
          {dndSaves(card)
            .map((key) => DND_ATTRIBUTES.find((s) => s.key === key)?.label)
            .join(' / ') || '请先选择职业'}
        </b>
      </div>
      {group(
        '职业技能',
        'classSkills',
        cls?.skills ?? [],
        cls?.count ?? 0,
        '从本职业允许的技能中选择。',
      )}
      {group(
        '背景技能',
        'backgroundSkills',
        DND_SKILLS.map((s) => s.key),
        2,
        '按 SRD 自定义背景选择两项；背景故事由主持人审核。',
      )}
      {ancestry.fixed.length > 0 && (
        <p className="helper-callout">
          种族自动获得：
          {ancestry.fixed.map((s) => DND_SKILLS.find((k) => k.key === s)?.label).join('、')}
        </p>
      )}
      {ancestry.choices > 0 &&
        group(
          '种族自选技能',
          'ancestrySkills',
          DND_SKILLS.map((s) => s.key),
          ancestry.choices,
        )}
      {(replacementCount(card) > 0 || a.replacementSkills.length > 0) &&
        group(
          '重复来源的替代熟练',
          'replacementSkills',
          DND_SKILLS.map((s) => s.key),
          replacementCount(card),
          '同一熟练来自多个来源时，选择其他技能替代。',
        )}
      {(policy.dndExtraSkills > 0 || a.extraSkills.length > 0) &&
        group(
          '主持人额外技能名额',
          'extraSkills',
          DND_SKILLS.map((s) => s.key),
          policy.dndExtraSkills,
        )}
      {(policy.dndExtraSaves > 0 || a.extraSaves.length > 0) &&
        group(
          '主持人额外豁免名额',
          'extraSaves',
          DND_ATTRIBUTES.map((s) => s.key).filter((s) => !dndSaves(card).includes(s)),
          policy.dndExtraSaves,
        )}
      {(expertiseLimit(card) > 0 || a.expertise.length > 0) &&
        group(
          '技能专精',
          'expertise',
          DND_SKILLS.filter((s) => card.proficiencies.includes(`skill:${s.key}`)).map((s) => s.key),
          expertiseLimit(card),
          '熟练加值翻倍；工具专精可记在笔记中，因此无需用满技能名额。',
        )}
      <div className="derived-skills">
        {DND_SKILLS.map((s) => (
          <span key={s.key}>
            {s.label}
            <b>
              {dndSkillModifier(card, s.key) >= 0 ? '+' : ''}
              {dndSkillModifier(card, s.key)}
            </b>
          </span>
        ))}
      </div>
      <p className="subtle-note">
        其他职业特性、专长或兼职带来的熟练，需主持人授予额外名额并审核；不会自动授予未经确认的能力。
      </p>
      <ValidationSummary errors={errors} />
    </div>
  );
}
function Budget({
  label,
  spent,
  total,
  detail,
}: {
  label: string;
  spent: number;
  total: number;
  detail: string;
}) {
  return (
    <div className={`point-budget ${spent > total ? 'over-budget' : ''}`}>
      <span>{label}剩余</span>
      <b>
        {total - spent}
        <small> / {total}</small>
      </b>
      <small>
        {detail} · 已用 {spent}
      </small>
      <div className="budget-track">
        <i style={{ width: `${Math.min(100, (spent / Math.max(total, 1)) * 100)}%` }} />
      </div>
    </div>
  );
}
