import { useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Check,
  Download,
  Upload,
  RefreshCw,
  Sparkles,
  Plus,
  Trash2,
  Heart,
  Shield,
  Brain,
  WandSparkles,
  Info,
  ArrowDownToLine,
  LockKeyhole,
} from 'lucide-react';
import type { Character, RuleId } from '../../shared/types';
import {
  createCharacter,
  rerollAttributes,
  reduceCocAttributes,
  deriveCharacter,
  randomTraits,
  DND_ATTRIBUTES,
  COC_ATTRIBUTES,
  DND_SKILLS,
  COC_SKILLS,
  DND_CLASSES,
  DND_ANCESTRIES,
  COC_OCCUPATIONS,
  abilityModifier,
  proficiencyBonus,
  getCharacterErrors,
  exportCharacter,
  parseCharacter,
} from '../../shared/rules';
import { downloadFile, readStored, writeStored } from '../storage';
import {
  cocAttributeCap,
  cocAttributeRollError,
  cocAttributeTotal,
  scaleCocAttributes,
} from '../../shared/coc-attributes';
import { hasAdjustments } from '../../shared/adjustments';
import { AdjustmentSummary } from './AdjustmentSummary';
import {
  defaultCreationPolicy,
  defaultAllocation,
  syncAllocation,
  type CreationPolicy,
} from '../../shared/creation';
import { AllocationEditor } from './AllocationEditor';
import { Modal, Spinner, DieIcon, ruleEdition } from './ui';

type Section = 'identity' | 'attributes' | 'skills' | 'story';
type RollLimitPreference = { enabled: boolean; max: string };
const ROLL_LIMIT_STORAGE = 'interlude-coc-attribute-cap';
function readRollLimit(): RollLimitPreference {
  const stored = readStored<unknown>(ROLL_LIMIT_STORAGE, null);
  if (stored && typeof stored === 'object' && 'enabled' in stored && 'max' in stored) {
    const { enabled, max } = stored;
    if (
      typeof enabled === 'boolean' &&
      typeof max === 'string' &&
      !cocAttributeRollError({ maxTotal: Number(max) })
    )
      return { enabled, max };
  }
  return { enabled: false, max: '500' };
}

export function CharacterEditor({
  rule,
  initial,
  onSave,
  onClose,
  inRoom = false,
  policy,
}: {
  rule: RuleId;
  initial?: Character;
  onSave: (card: Character) => Promise<void>;
  onClose: () => void;
  inRoom?: boolean;
  policy?: CreationPolicy;
}) {
  const dnd = rule === 'dnd';
  const [rollLimit, setRollLimit] = useState(readRollLimit);
  const cocLimits = useMemo(() => {
    if (dnd) return undefined;
    const ranges = policy?.ranges.filter(
      ({ field }) => field === 'attributeTotal' || field.startsWith('attributes.'),
    );
    return rollLimit.enabled || ranges?.length
      ? { maxTotal: rollLimit.enabled ? Number(rollLimit.max) : undefined, ranges }
      : undefined;
  }, [dnd, rollLimit, policy]);
  const rollLimitError = useMemo(
    () => (cocLimits ? cocAttributeRollError(cocLimits) : null),
    [cocLimits],
  );
  const [draft] = useState(() => {
    if (initial) return { card: structuredClone(initial), rolled: false, error: '' };
    try {
      return { card: createCharacter(rule, undefined, cocLimits), rolled: true, error: '' };
    } catch (error) {
      // Incompatible room ranges must not produce a random card outside those ranges.
      // Keep a clearly marked manual draft so the user can still fill/import a card.
      return {
        card: createCharacter(rule, () => 1),
        rolled: false,
        error: `${(error as Error).message} 当前为手填底稿，尚未生成骰点。`,
      };
    }
  });
  const [card, setCard] = useState<Character>(draft.card);
  const [section, setSection] = useState<Section>(draft.error ? 'attributes' : 'identity');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [rollCount, setRollCount] = useState(draft.rolled ? 1 : 0);
  const [rollError, setRollError] = useState(draft.error);
  const [attributeNotice, setAttributeNotice] = useState('');
  const [manualDraft, setManualDraft] = useState(!!draft.error);
  const [rolled, setRolled] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const attrs = dnd ? DND_ATTRIBUTES : COC_ATTRIBUTES;
  const hostTotalRange = policy?.ranges.find(({ field }) => field === 'attributeTotal');
  const attributeTotal = dnd ? 0 : cocAttributeTotal(card.attributes);
  const effectiveCap = cocLimits ? cocAttributeCap(cocLimits) : undefined;
  const overCap = effectiveCap !== undefined && attributeTotal > effectiveCap;
  const reduction = useMemo(() => {
    if (!overCap || !cocLimits) return null;
    try {
      return { attributes: scaleCocAttributes(card.attributes, cocLimits), error: '' };
    } catch (error) {
      return { attributes: null, error: (error as Error).message };
    }
  }, [overCap, cocLimits, card.attributes]);
  const changeRollLimit = (next: RollLimitPreference) => {
    if (hostTotalRange) return;
    setRollLimit(next);
    setRollError('');
    setAttributeNotice('');
    if (!cocAttributeRollError({ maxTotal: Number(next.max) }))
      writeStored(ROLL_LIMIT_STORAGE, next);
    else if (!next.enabled) writeStored(ROLL_LIMIT_STORAGE, { enabled: false, max: '500' });
  };
  const patch = (values: Partial<Character>) =>
    setCard((c) =>
      deriveCharacter(
        syncAllocation({
          ...c,
          ...values,
          ...(values.occupation !== undefined && values.occupation !== c.occupation
            ? { creation: defaultAllocation(rule, values.occupation) }
            : {}),
          ...(values.level !== undefined
            ? { level: Math.max(1, Math.min(20, Math.trunc(values.level) || 1)) }
            : {}),
          updatedAt: new Date().toISOString(),
        }),
      ),
    );
  const setAttribute = (key: string, value: number) => {
    setAttributeNotice('');
    setCard((c) =>
      deriveCharacter(
        syncAllocation({
          ...c,
          attributes: {
            ...c.attributes,
            [key]: Math.max(1, Math.min(dnd ? 30 : 100, Math.trunc(value) || 1)),
          },
        }),
      ),
    );
  };
  const reduceAttributes = () => {
    if (!cocLimits) return;
    try {
      const next = reduceCocAttributes(card, cocLimits);
      setCard(next);
      setRollError('');
      setManualDraft(false);
      setAttributeNotice(
        `已按比例降低：${attributeTotal} → ${cocAttributeTotal(next.attributes)}。基础技能与资源上限已同步，请复核职业点和兴趣点分配。`,
      );
    } catch (error) {
      setRollError((error as Error).message);
    }
  };
  const randomize = () => {
    try {
      const next = rerollAttributes(card, undefined, cocLimits);
      setCard(next);
      setRollError('');
      setAttributeNotice('');
      setManualDraft(false);
      setRollCount((v) => v + 1);
      setRolled(true);
      setTimeout(() => setRolled(false), 450);
    } catch (error) {
      setRollError((error as Error).message);
    }
  };
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    const invalid = getCharacterErrors(card);
    setErrors(invalid);
    if (invalid.length) {
      setSection('identity');
      return;
    }
    setBusy(true);
    try {
      await onSave({ ...card, updatedAt: new Date().toISOString() });
    } catch (error) {
      setErrors([(error as Error).message]);
    } finally {
      setBusy(false);
    }
  };
  const exportFile = (format: 'json' | 'md') => {
    try {
      downloadFile(
        exportCharacter(card, format),
        `${card.name || '角色卡'}.${format}`,
        format === 'json' ? 'application/json' : 'text/markdown',
      );
      setErrors([]);
    } catch (e) {
      setErrors([(e as Error).message]);
    }
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 256000) throw new Error('角色卡不能超过 256 KB。');
      setCard(parseCharacter(await file.text(), rule));
      setRollCount(0);
      setRollError('');
      setAttributeNotice('');
      setManualDraft(false);
      setErrors([]);
    } catch (e) {
      setErrors([(e as Error).message]);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const tabs: [Section, string][] = [
    ['identity', '角色资料'],
    ['attributes', '属性与状态'],
    ['skills', '技能与熟练'],
    ['story', '故事与行囊'],
  ];
  return (
    <Modal
      title={initial ? `角色卡 · ${initial.name}` : '让一个角色，成为你。'}
      subtitle={`${ruleEdition(rule)} · ${inRoom ? '保存后提交主持人审核' : '保存到你的角色档案'}`}
      onClose={onClose}
      className="character-editor"
      footer={
        <>
          <div className="export-buttons">
            <button className="text-button" onClick={() => fileRef.current?.click()}>
              <Upload size={15} /> 导入
            </button>
            <button className="text-button" onClick={() => exportFile('json')}>
              <Download size={15} /> JSON
            </button>
            <button className="text-button" onClick={() => exportFile('md')}>
              Markdown
            </button>
          </div>
          <button className="button primary" onClick={() => void save()} disabled={busy}>
            {busy ? <Spinner /> : <Check size={17} />}
            {busy ? '正在保存…' : inRoom ? '保存并提交审核' : '保存角色卡'}
          </button>
        </>
      }
    >
      <div className="editor-layout">
        <aside className={`editor-summary ${rule}`}>
          <div className="editor-portrait">
            <DieIcon size={84} />
            <span>{card.name.slice(0, 1) || '?'}</span>
          </div>
          <h3>{card.name || '未命名的角色'}</h3>
          <p>{card.occupation || (dnd ? '一位未来的冒险者' : '一位未来的调查员')}</p>
          <span className="pill">
            {dnd
              ? `Lv.${card.level} · 熟练 +${proficiencyBonus(card.level)}`
              : `${card.age} 岁 · 调查员`}
          </span>
          <div className="editor-mini-stats">
            <div>
              <Heart size={15} />
              <span>生命</span>
              <b>
                {card.hp} / {card.maxHp}
              </b>
            </div>
            <div>
              {dnd ? <Shield size={15} /> : <Brain size={15} />}
              <span>{dnd ? '护甲' : '理智'}</span>
              <b>{dnd ? card.ac : card.san}</b>
            </div>
            {!dnd && (
              <div>
                <WandSparkles size={15} />
                <span>魔法</span>
                <b>
                  {card.mp} / {card.maxMp}
                </b>
              </div>
            )}
          </div>
          <div className="editor-legend">
            <span>
              <i className="dot-manual" /> 手动填写
            </span>
            <span>
              <i className="dot-random" /> 可随机生成
            </span>
          </div>
          <button className="button secondary full" onClick={() => fileRef.current?.click()}>
            <Upload size={15} /> 从文件导入
          </button>
          <input
            ref={fileRef}
            type="file"
            className="visually-hidden"
            accept=".json,.md,.markdown"
            aria-label="导入角色卡文件"
            onChange={(e) => void importFile(e.target.files?.[0])}
          />
        </aside>
        <div className="editor-main">
          {hasAdjustments(card) && (
            <details className="editor-adjustment-note">
              <summary>这张卡带有局内修正 · 此页编辑制卡原始值</summary>
              <AdjustmentSummary card={card} />
            </details>
          )}
          <div className="editor-tabs">
            {tabs.map(([key, label]) => (
              <button
                key={key}
                className={section === key ? 'active' : ''}
                onClick={() => setSection(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {errors.length > 0 && (
            <div className="inline-error" role="alert">
              {errors.map((err, i) => (
                <div key={i}>{err}</div>
              ))}
            </div>
          )}
          {section === 'identity' && (
            <div className="editor-section page-enter">
              <div className="editor-section-heading">
                <div>
                  <h3>先认识一下，你是谁？</h3>
                  <p>姓名与职业为必填项，其余资料可慢慢补全。</p>
                </div>
                <span className="field-tag manual">手动填写</span>
              </div>
              <div className="form-grid">
                <label className="field">
                  角色姓名 <span className="required">*</span>
                  <input
                    value={card.name}
                    onChange={(e) => patch({ name: e.target.value })}
                    placeholder={dnd ? '你的名字，将成为传说的开头' : '写下调查员的姓名'}
                    maxLength={40}
                    required
                  />
                </label>
                <label className="field">
                  {dnd ? '职业' : '调查员职业'} <span className="required">*</span>
                  <select
                    value={card.occupation}
                    onChange={(e) => patch({ occupation: e.target.value })}
                    required
                  >
                    <option value="">请选择职业</option>
                    {!(dnd ? DND_CLASSES : COC_OCCUPATIONS).includes(card.occupation) &&
                      card.occupation && (
                        <option value={card.occupation}>{card.occupation}（旧卡，需重选）</option>
                      )}
                    {(dnd ? DND_CLASSES : COC_OCCUPATIONS).map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <small>更换职业会重置技能分配。</small>
                </label>
                {dnd ? (
                  <>
                    <label className="field">
                      种族
                      <input
                        list="character-ancestries"
                        value={card.ancestry}
                        onChange={(e) => patch({ ancestry: e.target.value })}
                        placeholder="选择或填写种族"
                        maxLength={60}
                      />
                      <datalist id="character-ancestries">
                        {DND_ANCESTRIES.map((value) => (
                          <option key={value} value={value} />
                        ))}
                      </datalist>
                    </label>
                    <label className="field">
                      职业等级
                      <input
                        type="number"
                        value={card.level}
                        min={1}
                        max={20}
                        onChange={(e) => patch({ level: Number(e.target.value) })}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label className="field">
                      年龄
                      <input
                        type="number"
                        min={15}
                        max={100}
                        value={card.age}
                        onChange={(e) => patch({ age: Number(e.target.value) })}
                      />
                    </label>
                    <label className="field">
                      出生地 / 国籍
                      <input
                        value={card.ancestry}
                        maxLength={60}
                        placeholder="例如：阿卡姆"
                        onChange={(e) => patch({ ancestry: e.target.value })}
                      />
                    </label>
                  </>
                )}
                <label className="field span-two">
                  {dnd ? '背景' : '时代与生活背景'}
                  <input
                    value={card.background}
                    onChange={(e) => patch({ background: e.target.value })}
                    maxLength={200}
                    placeholder={
                      dnd ? '例如：流浪的学者、退役的士兵' : '例如：1920 年代，在城市报社工作的记者'
                    }
                  />
                </label>
              </div>
              <div className="helper-callout">
                <Info size={18} />
                <p>
                  {dnd
                    ? '熟练按职业、背景和种族分配；额外能力由主持人授予名额。种族加值与装备请依规则填写，随后接受剧本范围检查。'
                    : '年龄修正请按规则填写。职业点与兴趣点在「技能与熟练」分别分配，信用评级、技能上限和剧本范围自动检查。'}
                </p>
              </div>
              <button
                className="button secondary next-step"
                onClick={() => setSection('attributes')}
              >
                接下来，看看属性 <ArrowRightSmall />
              </button>
            </div>
          )}
          {section === 'attributes' && (
            <div className="editor-section page-enter">
              <div className="editor-section-heading">
                <div>
                  <h3>命运，允许多掷几次。</h3>
                  <p>
                    {dnd
                      ? '4D6 去掉最低骰 · 属性加值可直接修改'
                      : '属性按 CoC 7 生成 · 年龄等修正请手动填写'}
                  </p>
                </div>
                <button
                  className="button secondary"
                  onClick={randomize}
                  disabled={!!rollLimitError}
                >
                  <RefreshCw size={15} className={rolled ? 'spin' : ''} /> 重掷全部
                </button>
              </div>
              {!dnd && (
                <div className="coc-attribute-cap">
                  <div className="coc-cap-controls">
                    <label className={`coc-cap-toggle ${hostTotalRange ? 'room-controlled' : ''}`}>
                      <input
                        type="checkbox"
                        aria-label="启用属性点上限"
                        checked={!!hostTotalRange || rollLimit.enabled}
                        disabled={!!hostTotalRange}
                        onChange={(event) =>
                          changeRollLimit({ ...rollLimit, enabled: event.target.checked })
                        }
                      />
                      <span>
                        属性点上限
                        <small>
                          {hostTotalRange ? (
                            <>
                              <LockKeyhole size={11} /> 主持人规定 · 不含幸运
                            </>
                          ) : (
                            '八项属性总和 · 不含幸运'
                          )}
                        </small>
                      </span>
                    </label>
                    <label className="coc-cap-input">
                      总和上限
                      <input
                        type="number"
                        min={hostTotalRange ? undefined : 195}
                        max={hostTotalRange ? undefined : 720}
                        step={1}
                        disabled={!hostTotalRange && !rollLimit.enabled}
                        readOnly={!!hostTotalRange}
                        value={hostTotalRange?.max ?? rollLimit.max}
                        aria-invalid={!hostTotalRange && rollLimit.enabled && !!rollLimitError}
                        aria-describedby="coc-cap-help"
                        onChange={(event) =>
                          changeRollLimit({ ...rollLimit, max: event.target.value })
                        }
                      />
                    </label>
                    <div className={`coc-cap-total ${overCap ? 'over-cap' : ''}`}>
                      <span>当前总和</span>
                      <output aria-label="八项属性总和">{attributeTotal}</output>
                      <small>
                        {effectiveCap !== undefined && !rollLimitError
                          ? `上限 ${effectiveCap}`
                          : '八项属性'}
                      </small>
                    </div>
                  </div>
                  <p id="coc-cap-help">
                    {hostTotalRange
                      ? '本房间直接采用主持人的上限，个人设置不影响本房间。超限卡片可按比例降低或重新掷骰。'
                      : '启用后，新骰点不会超过上限。设置会在本机记住；手填和导入的数值保留。'}
                  </p>
                  {hostTotalRange && (
                    <p className="coc-cap-room">
                      主持人要求：总和 {hostTotalRange.min}–{hostTotalRange.max}
                      ，调整范围需由主持人操作。
                    </p>
                  )}
                  {policy?.ranges.some(({ field }) => field.startsWith('attributes.')) && (
                    <p className="coc-cap-room">骰点同时遵守主持人设置的各项属性范围。</p>
                  )}
                  {rollLimitError || rollError ? (
                    <p className="coc-cap-error" role="alert">
                      {rollLimitError || rollError}
                    </p>
                  ) : (
                    overCap && (
                      <p className="coc-cap-error" role="status">
                        当前总和超出上限 {attributeTotal - effectiveCap!} 点。
                      </p>
                    )
                  )}
                  {reduction && (
                    <div className="coc-cap-resolution">
                      <p>
                        {reduction.attributes
                          ? `按当前数值的 ${((effectiveCap! / attributeTotal) * 100).toFixed(1)}% 降低，逐项向下取整到 5 的倍数；总和将为 ${cocAttributeTotal(reduction.attributes)}，幸运保持不变。`
                          : reduction.error}
                      </p>
                      <div className="coc-cap-actions">
                        <button
                          className="button secondary"
                          onClick={reduceAttributes}
                          disabled={!reduction.attributes}
                        >
                          <ArrowDownToLine size={15} />
                          按比例降低
                        </button>
                        <button
                          className="button secondary"
                          onClick={randomize}
                          disabled={!!rollLimitError}
                        >
                          <RefreshCw size={15} />
                          重新掷骰
                        </button>
                      </div>
                    </div>
                  )}
                  {hostTotalRange && attributeTotal < hostTotalRange.min && (
                    <p className="coc-cap-error" role="status">
                      当前总和低于主持人下限 {hostTotalRange.min}，可重掷或手动调整。
                    </p>
                  )}
                  {attributeNotice && (
                    <p className="coc-cap-notice" role="status">
                      {attributeNotice}
                    </p>
                  )}
                  {manualDraft && <p className="coc-cap-error">当前为手填底稿，尚未生成骰点。</p>}
                </div>
              )}
              <div className={`attributes-grid ${rolled ? 'rerolling' : ''}`}>
                {attrs.map((attr) => (
                  <label key={attr.key} className="attribute-box">
                    <span>
                      {attr.label}
                      <small>{attr.key.toUpperCase()}</small>
                    </span>
                    <input
                      aria-label={`${attr.label}属性`}
                      type="number"
                      min={dnd ? 1 : 1}
                      max={dnd ? 30 : 99}
                      value={card.attributes[attr.key] ?? 0}
                      onChange={(e) => setAttribute(attr.key, Number(e.target.value))}
                    />
                    <em>
                      {dnd
                        ? `${abilityModifier(card.attributes[attr.key]) >= 0 ? '+' : ''}${abilityModifier(card.attributes[attr.key])} 调整值`
                        : `${Math.floor(card.attributes[attr.key] / 2)} / ${Math.floor(card.attributes[attr.key] / 5)}`}
                    </em>
                  </label>
                ))}
              </div>
              <div className="roll-footnote">
                <span className="field-tag random">
                  <Sparkles size={12} /> 随机生成 · 可手动修改
                </span>
                <span>{rollCount > 0 ? `第 ${rollCount} 组` : '尚未重掷'} · 重掷不限次数</span>
              </div>
              <div className="section-divider" />
              <div className="editor-section-heading">
                <div>
                  <h3>状态与资源</h3>
                  <p>
                    {dnd
                      ? '生命上限与护甲请按职业、等级和装备填写。'
                      : '生命与魔法上限按属性自动计算；理智上限为 99 − 克苏鲁神话。'}
                  </p>
                </div>
              </div>
              <div className="form-grid resource-form">
                <label className="field">
                  当前生命
                  <input
                    type="number"
                    min={0}
                    max={card.maxHp}
                    value={card.hp}
                    onChange={(e) => patch({ hp: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  生命上限{!dnd && <span className="auto-label">自动</span>}
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={card.maxHp}
                    readOnly={!dnd}
                    onChange={(e) =>
                      patch({
                        maxHp: Number(e.target.value),
                        hp: Math.min(card.hp, Number(e.target.value)),
                      })
                    }
                  />
                </label>
                {dnd ? (
                  <label className="field">
                    护甲等级 AC
                    <input
                      type="number"
                      min={0}
                      max={40}
                      value={card.ac}
                      onChange={(e) => patch({ ac: Number(e.target.value) })}
                    />
                  </label>
                ) : (
                  <>
                    <label className="field">
                      当前理智 SAN
                      <input
                        type="number"
                        min={0}
                        max={card.maxSan}
                        value={card.san}
                        onChange={(e) => patch({ san: Number(e.target.value) })}
                      />
                    </label>
                    <label className="field">
                      当前魔法 MP
                      <input
                        type="number"
                        min={0}
                        max={card.maxMp}
                        value={card.mp}
                        onChange={(e) => patch({ mp: Number(e.target.value) })}
                      />
                    </label>
                  </>
                )}
              </div>
            </div>
          )}
          {section === 'skills' && (
            <div className="editor-section page-enter">
              <AllocationEditor
                card={card}
                policy={policy ?? defaultCreationPolicy(rule)}
                onChange={(next) => setCard(deriveCharacter(next))}
              />
            </div>
          )}
          {section === 'story' && (
            <div className="editor-section page-enter">
              <div className="editor-section-heading">
                <div>
                  <h3>数值之外，还有故事。</h3>
                  <p>给角色一点小习惯、一个执念，或一段未说出口的过去。</p>
                </div>
                <button
                  className="button secondary"
                  onClick={() => patch({ traits: randomTraits(rule) })}
                >
                  <Sparkles size={15} /> 刷新词条
                </button>
              </div>
              <div className="trait-list">
                {card.traits.map((trait, index) => (
                  <label key={index} className="trait-item">
                    <span>{['性格', '牵绊', '秘密'][index] || '特质'}</span>
                    <input
                      aria-label={`角色词条${index + 1}`}
                      value={trait}
                      maxLength={200}
                      onChange={(e) =>
                        patch({
                          traits: card.traits.map((v, i) => (i === index ? e.target.value : v)),
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <span className="subtle-note">词条可无限刷新，也可以改成你自己的答案。</span>
              <label className="field story-field">
                人物经历
                <textarea
                  value={card.backstory}
                  maxLength={4000}
                  onChange={(e) => patch({ backstory: e.target.value })}
                  rows={3}
                  placeholder="是什么让你踏上这段旅程？"
                />
              </label>
              <label className="field">
                {dnd ? '特性、法术与其他笔记' : '重要之人、症状与其他笔记'}
                <textarea
                  value={card.notes}
                  maxLength={4000}
                  onChange={(e) => patch({ notes: e.target.value })}
                  rows={3}
                  placeholder="记下规则特性，或任何需要记住的事情。"
                />
              </label>
              <div className="section-divider" />
              <div className="editor-section-heading">
                <div>
                  <h3>出发时，带上什么？</h3>
                  <p>装备数量与备注可随时修改。</p>
                </div>
                <button
                  className="text-button"
                  onClick={() =>
                    patch({
                      items: [
                        ...card.items,
                        { id: crypto.randomUUID(), name: '', quantity: 1, notes: '' },
                      ],
                    })
                  }
                  disabled={card.items.length >= 50}
                >
                  <Plus size={16} /> 物品
                </button>
              </div>
              <div className="editor-items">
                {card.items.map((item, index) => (
                  <div className="editor-item" key={item.id}>
                    <input
                      aria-label={`物品${index + 1}名称`}
                      placeholder="物品名称"
                      value={item.name}
                      maxLength={60}
                      onChange={(e) =>
                        patch({
                          items: card.items.map((i) =>
                            i.id === item.id ? { ...i, name: e.target.value } : i,
                          ),
                        })
                      }
                    />
                    <input
                      type="number"
                      aria-label={`物品${index + 1}数量`}
                      min={1}
                      max={999}
                      value={item.quantity}
                      onChange={(e) =>
                        patch({
                          items: card.items.map((i) =>
                            i.id === item.id ? { ...i, quantity: Number(e.target.value) } : i,
                          ),
                        })
                      }
                    />
                    <input
                      aria-label={`物品${index + 1}备注`}
                      placeholder="备注"
                      value={item.notes}
                      maxLength={200}
                      onChange={(e) =>
                        patch({
                          items: card.items.map((i) =>
                            i.id === item.id ? { ...i, notes: e.target.value } : i,
                          ),
                        })
                      }
                    />
                    <button
                      className="icon-button"
                      aria-label={`删除物品${index + 1}`}
                      onClick={() => patch({ items: card.items.filter((i) => i.id !== item.id) })}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
                {!card.items.length && (
                  <p className="subtle-note">行囊还是空的。加入一件随身物品吧。</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
function ArrowRightSmall() {
  return <span aria-hidden="true">→</span>;
}
