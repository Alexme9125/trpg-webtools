import { useRef, useState } from 'react';
import {
  ArrowRightLeft,
  BookOpen,
  Check,
  Copy,
  Download,
  EyeOff,
  Plus,
  Shield,
  Skull,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import {
  createDndStatBlock,
  duplicateDndStatBlock,
  parseDndStatBlocks,
  getDndStatBlockErrors,
  dndCardJSON,
  dndCardMD,
  dndCollectionJSON,
  DND_TEMPLATES,
  type DndAction,
  type DndAttributeKey,
  type DndStatBlock,
} from '../../shared/dnd';
import { downloadFile } from '../storage';
import { Modal, Spinner } from './ui';
import { DndImportGuide } from './DndImportGuide';

const attributes: [DndAttributeKey, string][] = [
  ['str', '力量'],
  ['dex', '敏捷'],
  ['con', '体质'],
  ['int', '智力'],
  ['wis', '感知'],
  ['cha', '魅力'],
];
const nullable = (value: string) => (value === '' ? null : Number(value));
const actionGroups = [
  ['traits', '特性'],
  ['actions', '动作'],
  ['reactions', '反应'],
  ['legendaryActions', '传奇动作'],
] as const;
const newAction = (): DndAction => ({
  id: crypto.randomUUID(),
  name: '',
  description: '',
  attackBonus: null,
  damage: '',
  saveDc: null,
  saveAbility: '',
  uses: null,
  recharge: '',
});

export function DndWorkshop({
  library,
  scope,
  onSave,
  onDelete,
  onTransfer,
  initialKind,
  onClose,
}: {
  library: DndStatBlock[];
  scope: 'personal' | 'room';
  onSave: (cards: DndStatBlock[]) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onTransfer?: (cards: DndStatBlock[]) => Promise<void>;
  initialKind?: 'npc' | 'monster';
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<DndStatBlock | null>(() =>
    initialKind ? createDndStatBlock(`${initialKind}-blank`) : null,
  );
  const [search, setSearch] = useState('');
  const [tagText, setTagText] = useState('');
  const [tab, setTab] = useState('identity');
  const [template, setTemplate] = useState('npc-bridge-guard');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [guide, setGuide] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const patch = (values: Partial<DndStatBlock>) =>
    setDraft((c) => (c ? { ...c, ...values, updatedAt: new Date().toISOString() } : c));
  const choose = (card: DndStatBlock) => {
    setDraft(structuredClone(card));
    setTagText(card.tags.join('、'));
    setError('');
    setMessage('');
    setDeleting(false);
    setGuide(false);
  };
  const execute = async (task: () => Promise<void>, success: string) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await task();
      setMessage(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const valid = (cards: DndStatBlock[]) => {
    const errors = cards.flatMap(getDndStatBlockErrors);
    if (errors.length) throw new Error(errors.slice(0, 4).join('；'));
    if (new Blob([JSON.stringify(cards)]).size > 8 * 1024 * 1024 - 2048)
      throw new Error('本批内容超过 8 MiB，请分批保存。');
  };
  const save = () =>
    draft &&
    execute(
      async () => {
        valid([draft]);
        await onSave([draft]);
      },
      `已保存至${scope === 'personal' ? '个人数据块库' : '房间数据块库'}。`,
    );
  const transfer = (cards: DndStatBlock[]) =>
    onTransfer &&
    execute(
      async () => {
        valid(cards);
        await onTransfer(cards);
      },
      scope === 'personal' ? '已作为独立副本带入房间。' : '已作为独立副本存入个人库。',
    );
  const exportFile = (kind: 'json' | 'md' | 'all') => {
    try {
      const content =
        kind === 'all'
          ? dndCollectionJSON(library)
          : kind === 'json'
            ? dndCardJSON(draft!)
            : dndCardMD(draft!);
      downloadFile(
        content,
        `${kind === 'all' ? 'DND数据块资料集' : draft!.name}.${kind === 'md' ? 'md' : 'json'}`,
        kind === 'md' ? 'text/markdown' : 'application/json',
      );
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const importFile = async (input?: File) => {
    if (!input) return;
    await execute(async () => {
      if (input.size > 8 * 1024 * 1024) throw new Error('文件不能超过 8 MiB。');
      const cards = parseDndStatBlocks(await input.text()).map((c) =>
        library.some((old) => old.id === c.id) ? duplicateDndStatBlock(c, c.name) : c,
      );
      valid(cards);
      await onSave(cards);
      choose(cards[0]);
      setTab('preview');
    }, '资料已导入，请核对数据块与来源。');
    if (file.current) file.current.value = '';
  };
  const textField = (key: keyof DndStatBlock, label: string, multiline = false) => (
    <label className="field" key={key}>
      {label}
      {multiline ? (
        <textarea
          aria-label={label}
          rows={3}
          value={String(draft?.[key] ?? '')}
          onChange={(e) => patch({ [key]: e.target.value })}
        />
      ) : (
        <input
          aria-label={label}
          value={String(draft?.[key] ?? '')}
          onChange={(e) => patch({ [key]: e.target.value })}
        />
      )}
    </label>
  );
  const numberField = (
    key: 'ac' | 'hp' | 'maxHp' | 'xp' | 'legendaryActionCount',
    label: string,
    max = 100000,
  ) => (
    <label className="field" key={key}>
      {label}
      <input
        type="number"
        min={0}
        max={max}
        placeholder="未知"
        value={draft?.[key] ?? ''}
        onChange={(e) => patch({ [key]: nullable(e.target.value) })}
      />
    </label>
  );
  return (
    <Modal
      title={scope === 'personal' ? 'D&D 个人数据块库' : 'D&D 房间数据块库'}
      subtitle="5e · 2014 / SRD 5.1 · NPC 与怪物独立于玩家制卡"
      className="keeper-workshop dnd-workshop"
      onClose={onClose}
      footer={
        <>
          <span className="keeper-footer-note">
            <EyeOff size={14} />
            {scope === 'personal' ? '保存在此浏览器' : '仅当前主持人可见'}
          </span>
          {draft && !guide && (
            <div className="dnd-footer-actions">
              <button className="text-button" onClick={() => exportFile('json')}>
                JSON
              </button>
              <button className="text-button" onClick={() => exportFile('md')}>
                Markdown
              </button>
              {onTransfer && (
                <button
                  className="button secondary compact"
                  disabled={busy}
                  onClick={() => void transfer([draft])}
                >
                  <ArrowRightLeft size={15} />
                  {scope === 'personal' ? '带入当前房间' : '存入个人备团库'}
                </button>
              )}
              <button
                className="button primary compact"
                disabled={busy}
                onClick={() => void save()}
              >
                {busy ? <Spinner /> : <Check size={16} />}保存数据块
              </button>
            </div>
          )}
        </>
      }
    >
      <div className="keeper-toolbar">
        <button
          className="button secondary compact"
          onClick={() => choose(createDndStatBlock('npc-blank'))}
        >
          <Users size={15} />
          新建 NPC
        </button>
        <button
          className="button secondary compact"
          onClick={() => choose(createDndStatBlock('monster-blank'))}
        >
          <Skull size={15} />
          新建怪物
        </button>
        <button className="text-button" disabled={busy} onClick={() => file.current?.click()}>
          <Upload size={15} />
          导入资料集
        </button>
        <button
          className="text-button"
          disabled={!library.length}
          onClick={() => exportFile('all')}
        >
          <Download size={15} />
          导出全部
        </button>
        {onTransfer && (
          <button
            className="text-button"
            disabled={busy || !library.length}
            onClick={() => void transfer(library)}
          >
            {scope === 'personal' ? '全部带入房间' : '全部存入个人库'}
          </button>
        )}
        <button className="text-button" onClick={() => setGuide(!guide)}>
          <BookOpen size={15} />
          {guide ? '返回数据块' : 'AI 提取与导入指南'}
        </button>
        <input
          ref={file}
          type="file"
          accept=".json,.md,.markdown,application/json,text/markdown"
          hidden
          aria-label="导入 D&D 资料集文件"
          onChange={(e) => void importFile(e.target.files?.[0])}
        />
      </div>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <p className="keeper-success" role="status">
          {message}
        </p>
      )}
      {guide && <DndImportGuide />}
      <div className="keeper-layout" hidden={guide}>
        <aside className="keeper-sidebar">
          <label className="field">
            搜索数据块
            <input
              placeholder="名称、类型或标签"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="keeper-card-list">
            {library
              .filter((c) =>
                `${c.name} ${c.creatureType} ${c.tags.join(' ')}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((card) => (
                <button
                  key={card.id}
                  className={draft?.id === card.id ? 'selected' : ''}
                  onClick={() => choose(card)}
                >
                  <span className={`keeper-card-icon ${card.kind}`}>
                    {card.kind === 'npc' ? <Users size={17} /> : <Skull size={17} />}
                  </span>
                  <span>
                    <b>{card.name}</b>
                    <small>
                      {card.creatureType || (card.kind === 'npc' ? 'NPC' : '怪物')} · CR{' '}
                      {card.challenge || '—'}
                    </small>
                  </span>
                </button>
              ))}
          </div>
          {!library.length && (
            <p className="subtle-note">还没有资料。新建空白数据块，或从示例开始。</p>
          )}
          <div className="dnd-template-picker">
            <label className="field">
              从模板开始
              <select
                aria-label="从模板开始"
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
              >
                {DND_TEMPLATES.map((t) => (
                  <option value={t.id} key={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button secondary compact"
              onClick={() => {
                choose(createDndStatBlock(template));
                setTab('identity');
              }}
            >
              <Plus size={15} />
              使用此模板
            </button>
          </div>
        </aside>
        <div className="keeper-editor">
          {!draft ? (
            <div className="dnd-empty">
              <Shield size={40} strokeWidth={1} />
              <h3>每个相遇，都有一份记录。</h3>
              <p>选择左侧资料，或制作一份新的 NPC／怪物数据块。</p>
            </div>
          ) : (
            <>
              <div className="dnd-editor-heading">
                <div>
                  <span className="mini-label">STAT BLOCK</span>
                  <h3>{draft.name || '未命名数据块'}</h3>
                </div>
                <div className="dnd-editor-actions">
                  <button
                    className="icon-button"
                    aria-label="复制当前数据块"
                    onClick={() => choose(duplicateDndStatBlock(draft))}
                  >
                    <Copy size={16} />
                  </button>
                  {library.some((c) => c.id === draft.id) && (
                    <button
                      className="icon-button danger"
                      aria-label="删除当前数据块"
                      onClick={() => setDeleting(true)}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
              {deleting && (
                <div className="dnd-delete-confirm">
                  <span>删除这份资料？已生成的参战个体会保留。</span>
                  <button
                    className="text-button danger"
                    disabled={busy}
                    onClick={() =>
                      void execute(async () => {
                        await onDelete(draft.id);
                        setDraft(null);
                        setDeleting(false);
                      }, '数据块已删除。')
                    }
                  >
                    确认删除
                  </button>
                  <button className="text-button" onClick={() => setDeleting(false)}>
                    取消
                  </button>
                </div>
              )}
              <div className="editor-tabs">
                {[
                  ['identity', '身份与防御'],
                  ['attributes', '属性与感知'],
                  ['abilities', '行动与能力'],
                  ['preview', '数据块预览'],
                ].map(([key, label]) => (
                  <button
                    className={tab === key ? 'active' : ''}
                    key={key}
                    onClick={() => setTab(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {tab === 'identity' && (
                <div className="dnd-fields">
                  {textField('name', '数据块名称')}
                  <label className="field">
                    资料类型
                    <select
                      value={draft.kind}
                      onChange={(e) => patch({ kind: e.target.value as 'npc' | 'monster' })}
                    >
                      <option value="npc">NPC</option>
                      <option value="monster">怪物</option>
                    </select>
                  </label>
                  {textField('size', '体型')}
                  {textField('creatureType', '生物类型')}
                  {textField('alignment', '阵营')}
                  {textField('challenge', '挑战等级 CR')}
                  {numberField('ac', '护甲等级 AC', 100)}
                  {textField('acNotes', '护甲说明')}
                  {numberField('maxHp', 'HP 上限')}
                  {numberField('hp', '当前 HP')}
                  {textField('hitDice', '生命骰式')}
                  {textField('speed', '速度与移动方式')}
                  {numberField('xp', '经验值 XP', 1000000000)}
                  {textField('resistances', '伤害抗性')}
                  {textField('immunities', '伤害免疫')}
                  {textField('vulnerabilities', '伤害易伤')}
                  {textField('conditionImmunities', '状态免疫')}
                  <div className="dnd-wide">
                    {textField('description', '外观与人物描述', true)}
                    {textField('source', '资料来源与页码')}
                    {textField('notes', '主持人笔记与待核对项', true)}
                    <label className="field">
                      标签（顿号分隔）
                      <input
                        value={tagText}
                        onChange={(e) => {
                          setTagText(e.target.value);
                          patch({
                            tags: e.target.value
                              .split(/[、,，]/)
                              .map((s) => s.trim())
                              .filter(Boolean),
                          });
                        }}
                      />
                    </label>
                  </div>
                </div>
              )}
              {tab === 'attributes' && (
                <>
                  <div className="dnd-attribute-grid">
                    {attributes.map(([key, label]) => (
                      <label className="field" key={key}>
                        {label} {key.toUpperCase()}
                        <input
                          aria-label={`${label}属性`}
                          type="number"
                          min={1}
                          max={30}
                          placeholder="未知"
                          value={draft.attributes[key] ?? ''}
                          onChange={(e) =>
                            patch({
                              attributes: { ...draft.attributes, [key]: nullable(e.target.value) },
                            })
                          }
                        />
                        <small>
                          调整值{' '}
                          {draft.attributes[key] === null
                            ? '—'
                            : signed(Math.floor((draft.attributes[key]! - 10) / 2))}
                        </small>
                      </label>
                    ))}
                  </div>
                  <h4>豁免加值</h4>
                  <p className="subtle-note">
                    填写数据块明确列出的总加值。空白项按属性调整值使用。
                  </p>
                  <div className="dnd-attribute-grid">
                    {attributes.map(([key, label]) => (
                      <label className="field" key={key}>
                        {label}豁免
                        <input
                          type="number"
                          min={-30}
                          max={100}
                          placeholder="未列出"
                          value={draft.saves[key] ?? ''}
                          onChange={(e) => {
                            const saves = { ...draft.saves };
                            if (e.target.value === '') delete saves[key];
                            else saves[key] = Number(e.target.value);
                            patch({ saves });
                          }}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="dnd-fields">
                    {textField('senses', '感官与被动察觉')}
                    {textField('languages', '语言')}
                  </div>
                  <div className="inventory-heading">
                    <h4>技能加值</h4>
                    <button
                      className="text-button"
                      onClick={() =>
                        patch({
                          skills: [
                            ...draft.skills,
                            { id: crypto.randomUUID(), name: '', value: 0 },
                          ],
                        })
                      }
                    >
                      <Plus size={15} />
                      添加技能
                    </button>
                  </div>
                  {draft.skills.map((skill, index) => (
                    <div className="dnd-skill-row" key={skill.id}>
                      <input
                        aria-label={`技能 ${index + 1} 名称`}
                        placeholder="例如：察觉"
                        value={skill.name}
                        onChange={(e) =>
                          patch({
                            skills: draft.skills.map((s) =>
                              s.id === skill.id ? { ...s, name: e.target.value } : s,
                            ),
                          })
                        }
                      />
                      <input
                        type="number"
                        aria-label={`技能 ${index + 1} 加值`}
                        value={skill.value}
                        onChange={(e) =>
                          patch({
                            skills: draft.skills.map((s) =>
                              s.id === skill.id ? { ...s, value: Number(e.target.value) } : s,
                            ),
                          })
                        }
                      />
                      <button
                        className="icon-button"
                        aria-label={`移除技能 ${index + 1}`}
                        onClick={() =>
                          patch({ skills: draft.skills.filter((s) => s.id !== skill.id) })
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </>
              )}
              {tab === 'abilities' && (
                <>
                  {actionGroups.map(([group, label]) => (
                    <section className="dnd-action-group" key={group}>
                      <div className="inventory-heading">
                        <h4>
                          {label}
                          <span>{draft[group].length}</span>
                        </h4>
                        <button
                          className="text-button"
                          onClick={() => patch({ [group]: [...draft[group], newAction()] })}
                        >
                          <Plus size={15} />
                          添加{label}
                        </button>
                      </div>
                      {draft[group].map((action, i) => {
                        const update = (values: Partial<DndAction>) =>
                          patch({
                            [group]: draft[group].map((a) =>
                              a.id === action.id ? { ...a, ...values } : a,
                            ),
                          });
                        return (
                          <div className="dnd-action-edit" key={action.id}>
                            <div className="dnd-action-name">
                              <label className="field">
                                {label} {i + 1} 名称
                                <input
                                  value={action.name}
                                  onChange={(e) => update({ name: e.target.value })}
                                />
                              </label>
                              <button
                                className="icon-button"
                                aria-label={`移除${label} ${i + 1}`}
                                onClick={() =>
                                  patch({ [group]: draft[group].filter((a) => a.id !== action.id) })
                                }
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                            <label className="field">
                              {label} {i + 1} 描述
                              <textarea
                                rows={3}
                                value={action.description}
                                placeholder="距离、目标、触发时机、效果及限制"
                                onChange={(e) => update({ description: e.target.value })}
                              />
                            </label>
                            <div className="dnd-fields">
                              <label className="field">
                                {label} {i + 1} 攻击加值
                                <input
                                  type="number"
                                  placeholder="不适用"
                                  value={action.attackBonus ?? ''}
                                  onChange={(e) =>
                                    update({ attackBonus: nullable(e.target.value) })
                                  }
                                />
                              </label>
                              <label className="field">
                                {label} {i + 1} 伤害骰与类型
                                <input
                                  value={action.damage}
                                  placeholder="如 1d6+2 穿刺"
                                  onChange={(e) => update({ damage: e.target.value })}
                                />
                              </label>
                              <label className="field">
                                {label} {i + 1} 豁免 DC
                                <input
                                  type="number"
                                  value={action.saveDc ?? ''}
                                  placeholder="不适用"
                                  onChange={(e) => update({ saveDc: nullable(e.target.value) })}
                                />
                              </label>
                              <label className="field">
                                {label} {i + 1} 豁免属性
                                <input
                                  value={action.saveAbility}
                                  placeholder="如 DEX"
                                  onChange={(e) => update({ saveAbility: e.target.value })}
                                />
                              </label>
                              <label className="field">
                                {label} {i + 1} 可用次数
                                <input
                                  type="number"
                                  min={0}
                                  value={action.uses ?? ''}
                                  placeholder="不限／未指定"
                                  onChange={(e) => update({ uses: nullable(e.target.value) })}
                                />
                              </label>
                              <label className="field">
                                {label} {i + 1} 恢复条件
                                <input
                                  value={action.recharge}
                                  placeholder="如 充能 5–6、每日"
                                  onChange={(e) => update({ recharge: e.target.value })}
                                />
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </section>
                  ))}
                  {textField('spellcasting', '施法能力、法术列表与法术位', true)}
                  {numberField('legendaryActionCount', '每轮传奇动作点数', 100)}
                  {textField('lairActions', '巢穴动作与区域效果', true)}
                </>
              )}
              {tab === 'preview' && <DndBlockPreview card={draft} />}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function signed(n: number) {
  return n >= 0 ? `+${n}` : String(n);
}
export function DndBlockPreview({ card }: { card: DndStatBlock }) {
  return (
    <article className="dnd-statblock">
      <header>
        <Shield size={25} strokeWidth={1.3} />
        <h3>{card.name || '未命名生物'}</h3>
        <p>{[card.size, card.creatureType, card.alignment].filter(Boolean).join(' · ')}</p>
      </header>
      <div className="dnd-statblock-basics">
        <span>
          <b>AC</b> {card.ac ?? '—'} {card.acNotes}
        </span>
        <span>
          <b>HP</b> {card.hp ?? '—'} / {card.maxHp ?? '—'} {card.hitDice && `（${card.hitDice}）`}
        </span>
        <span>
          <b>速度</b> {card.speed || '—'}
        </span>
        <span>
          <b>CR</b> {card.challenge || '—'} {card.xp !== null && `· ${card.xp} XP`}
        </span>
      </div>
      <div className="dnd-statblock-attributes">
        {attributes.map(([key]) => (
          <div key={key}>
            <span>{key.toUpperCase()}</span>
            <b>{card.attributes[key] ?? '—'}</b>
            <small>
              {card.attributes[key] === null
                ? '—'
                : signed(Math.floor((card.attributes[key]! - 10) / 2))}
            </small>
          </div>
        ))}
      </div>
      {Object.keys(card.saves).length > 0 && (
        <p>
          <b>豁免 </b>
          {attributes
            .filter(([k]) => card.saves[k] !== undefined)
            .map(([k, name]) => `${name} ${signed(card.saves[k]!)}`)
            .join('，')}
        </p>
      )}
      {card.skills.length > 0 && (
        <p>
          <b>技能 </b>
          {card.skills.map((s) => `${s.name} ${signed(s.value)}`).join('，')}
        </p>
      )}
      {(
        [
          ['resistances', '伤害抗性'],
          ['immunities', '伤害免疫'],
          ['vulnerabilities', '伤害易伤'],
          ['conditionImmunities', '状态免疫'],
          ['senses', '感官'],
          ['languages', '语言'],
        ] as const
      ).map(
        ([key, label]) =>
          card[key] && (
            <p key={key}>
              <b>{label} </b>
              {card[key]}
            </p>
          ),
      )}
      {actionGroups.map(
        ([group, label]) =>
          card[group].length > 0 && (
            <section key={group}>
              <h4>{label}</h4>
              {card[group].map((a) => (
                <div className="dnd-statblock-action" key={a.id}>
                  <b>{a.name}。</b>
                  <span>{a.description}</span>
                  <p>
                    {a.attackBonus !== null && `命中 ${signed(a.attackBonus)}；`}
                    {a.damage && `伤害 ${a.damage}；`}
                    {a.saveDc !== null && `${a.saveAbility} 豁免 DC ${a.saveDc}；`}
                    {a.uses !== null && `${a.uses} 次；`}
                    {a.recharge}
                  </p>
                </div>
              ))}
            </section>
          ),
      )}
      {card.spellcasting && (
        <section>
          <h4>施法</h4>
          <p>{card.spellcasting}</p>
        </section>
      )}
      {card.legendaryActionCount !== null && <p>传奇动作点数：{card.legendaryActionCount}</p>}
      {card.lairActions && (
        <section>
          <h4>巢穴与区域效果</h4>
          <p>{card.lairActions}</p>
        </section>
      )}
      {card.description && <p>{card.description}</p>}
      <footer>
        {card.source || '尚未填写来源'}
        {card.notes && (
          <p>
            <EyeOff size={12} /> {card.notes}
          </p>
        )}
      </footer>
    </article>
  );
}
