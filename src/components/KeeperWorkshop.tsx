import { useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  Copy,
  Download,
  EyeOff,
  FolderPlus,
  Layers,
  Plus,
  RefreshCw,
  Skull,
  Trash2,
  Upload,
  Users,
  ArrowRightLeft,
} from 'lucide-react';
import {
  KEEPER_ATTRIBUTES,
  KEEPER_CATEGORIES,
  KEEPER_TEMPLATES,
  createKeeperCard,
  createKeeperBatch,
  deriveKeeperCard,
  duplicateKeeperCard,
  exportKeeperCard,
  exportKeeperCards,
  getKeeperCardErrors,
  parseKeeperCards,
  rerollKeeperCard,
  type KeeperCard,
} from '../../shared/keeper';
import { Modal, Spinner } from './ui';
import { downloadFile } from '../storage';
import { KeeperImportGuide } from './KeeperImportGuide';

export function KeeperWorkshop({
  library,
  scope,
  onSave,
  onDelete,
  onTransfer,
  initialKind,
  onClose,
}: {
  library: KeeperCard[];
  scope: 'personal' | 'room';
  onSave: (cards: KeeperCard[]) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onTransfer?: (cards: KeeperCard[]) => Promise<void>;
  initialKind?: 'npc' | 'monster';
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<KeeperCard | null>(() =>
    initialKind ? createKeeperCard(initialKind) : null,
  );
  const [filter, setFilter] = useState<'all' | 'npc' | 'monster'>('all');
  const [search, setSearch] = useState('');
  const [tagText, setTagText] = useState('');
  const [section, setSection] = useState<'identity' | 'attributes' | 'abilities'>('identity');
  const [template, setTemplate] = useState('npc-bystander');
  const [batch, setBatch] = useState(false);
  const [count, setCount] = useState(5);
  const [prefix, setPrefix] = useState('');
  const [mode, setMode] = useState<'average' | 'roll'>('average');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const patch = (values: Partial<KeeperCard>) =>
    setDraft((c) => (c ? { ...c, ...values, updatedAt: new Date().toISOString() } : null));
  const choose = (card: KeeperCard) => {
    setDraft(structuredClone(card));
    setTagText(card.tags.join('、'));
    setSection('identity');
    setError('');
    setMessage('');
    setDeleting(false);
  };
  const newCard = (kind: 'npc' | 'monster') => choose(createKeeperCard(kind));
  const persist = async (cards: KeeperCard[]) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const errors = cards.flatMap(getKeeperCardErrors);
      if (errors.length) throw new Error(errors.slice(0, 4).join('；'));
      // Keep the full payload within the same 8 MiB import/transport boundary.
      if (new Blob([JSON.stringify({ type: 'keeper-save', cards })]).size > 8 * 1024 * 1024 - 1024)
        throw new Error('本批内容超过 8 MiB，请分批保存。');
      await onSave(cards);
      choose(cards[0]);
      setBatch(false);
      setMessage(
        `已保存 ${cards.length} 张资料卡至${scope === 'personal' ? '个人备团库' : '当前房间卡库'}。`,
      );
      return true;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
    return false;
  };
  const transfer = async (cards: KeeperCard[]) => {
    if (!onTransfer) return;
    setBusy(true);
    setError('');
    try {
      const errors = cards.flatMap(getKeeperCardErrors);
      if (errors.length) throw new Error(errors.slice(0, 4).join('；'));
      await onTransfer(cards);
      setMessage(
        `已将 ${cards.length} 张资料卡作为独立副本${scope === 'personal' ? '带入当前房间' : '存入个人备团库'}。`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const importFile = async (input?: File) => {
    if (!input) return;
    try {
      if (input.size > 8 * 1024 * 1024) throw new Error('资料集文件不能超过 8 MiB。');
      const cards = parseKeeperCards(await input.text()).map((c) =>
        library.some((old) => old.id === c.id) ? duplicateKeeperCard(c) : c,
      );
      await persist(cards);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (file.current) file.current.value = '';
    }
  };
  const exportFile = (format: 'json' | 'md', all = false) => {
    try {
      const output = all ? exportKeeperCards(library, format) : exportKeeperCard(draft!, format);
      downloadFile(
        output,
        `${all ? 'KP资料集' : draft!.name}.${format}`,
        format === 'json' ? 'application/json' : 'text/markdown',
      );
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const nullable = (value: string) => (value === '' ? null : Number(value));
  const cards = library.filter(
    (c) =>
      (filter === 'all' || c.kind === filter) && `${c.name} ${c.tags.join(' ')}`.includes(search),
  );
  const resource = (key: 'hp' | 'maxHp' | 'mp' | 'maxMp' | 'armor' | 'build', label: string) => (
    <label className="field" key={key}>
      {label}
      <input
        aria-label={`资料卡${label}`}
        type="number"
        min={key === 'build' ? -10 : 0}
        max={key === 'build' ? 3000 : 100000}
        value={draft?.[key] ?? ''}
        placeholder="不适用"
        onChange={(e) => patch({ [key]: nullable(e.target.value) })}
      />
    </label>
  );
  return (
    <Modal
      title="帷幕之后，万千面孔。"
      subtitle={`${scope === 'personal' ? '个人备团库 · 保存在此浏览器' : '当前房间 · 仅主持人可见'} · ${library.length} / 200 张`}
      className="keeper-workshop"
      onClose={onClose}
      footer={
        <>
          <span className="keeper-privacy">
            <EyeOff size={15} />
            {scope === 'personal' ? '个人备团库 · 建议导出备份' : '仅当前主持人可见'}
          </span>
          <div className="keeper-footer-actions">
            {draft && !showGuide && (
              <>
                <button className="text-button" onClick={() => exportFile('json')}>
                  <Download size={14} />
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
                  className="button primary"
                  disabled={busy}
                  onClick={() => void persist([draft])}
                >
                  {busy ? <Spinner /> : <Check size={16} />}保存资料卡
                </button>
              </>
            )}
          </div>
        </>
      }
    >
      <div className="keeper-toolbar">
        <div>
          <button className="text-button" onClick={() => setShowGuide(!showGuide)}>
            <BookOpen size={14} />
            {showGuide ? '返回卡库' : 'AI 提取与导入指南'}
          </button>
          <button className="button secondary compact" onClick={() => newCard('npc')}>
            <Users size={15} />
            新建 NPC
          </button>
          <button className="button secondary compact" onClick={() => newCard('monster')}>
            <Skull size={15} />
            新建怪物
          </button>
          <button className="button secondary compact" onClick={() => setBatch(!batch)}>
            <Layers size={15} />
            模板与批量
          </button>
        </div>
        <div>
          <button className="text-button" onClick={() => file.current?.click()}>
            <Upload size={14} />
            导入资料集
          </button>
          <button
            className="text-button"
            disabled={!library.length}
            onClick={() => exportFile('json', true)}
          >
            导出全部
          </button>
          <button
            className="text-button"
            disabled={!library.length}
            onClick={() => exportFile('md', true)}
          >
            MD
          </button>
          {onTransfer && (
            <button
              className="text-button"
              disabled={busy || !library.length}
              onClick={() => void transfer(library)}
            >
              <ArrowRightLeft size={14} />
              {scope === 'personal' ? '全部带入房间' : '全部存入个人库'}
            </button>
          )}
          <input
            ref={file}
            aria-label="导入KP资料文件"
            type="file"
            className="visually-hidden"
            accept=".json,.md,.markdown"
            onChange={(e) => void importFile(e.target.files?.[0])}
          />
        </div>
      </div>
      {showGuide && <KeeperImportGuide />}
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <p className="keeper-success" role="status">
          <Check size={15} />
          {message}
        </p>
      )}
      {batch && !showGuide && (
        <div className="keeper-batch">
          <div className="keeper-batch-heading">
            <BookOpen size={21} />
            <div>
              <b>从一份原型，生成不同个体。</b>
              <p>分类源自 CoC 7 怪物书；数值示例为本站原创，不是官方固定战力模板。</p>
            </div>
          </div>
          <div className="batch-grid">
            <label className="field">
              资料模板
              <select
                aria-label="资料模板"
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
              >
                {KEEPER_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              生成方式
              <select
                aria-label="生成方式"
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
              >
                <option value="average">固定参考值</option>
                <option value="roll">按属性骰式分别重掷</option>
              </select>
            </label>
            <label className="field">
              名称前缀
              <input
                maxLength={80}
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="例如：码头守卫"
              />
            </label>
            <label className="field">
              生成数量
              <input
                aria-label="生成数量"
                type="number"
                min={1}
                max={200 - library.length}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </label>
          </div>
          <p className="subtle-note">
            {KEEPER_TEMPLATES.find((t) => t.id === template)?.description}{' '}
            空白模板保留空值。已有编号再次导入会保存为副本。
          </p>
          <div className="review-actions">
            <button
              className="button secondary"
              onClick={() => {
                try {
                  choose(createKeeperCard(template, { mode }));
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              载入模板编辑
            </button>
            <button
              className="button primary"
              disabled={busy || count < 1 || count + library.length > 200}
              onClick={() => {
                try {
                  void persist(
                    createKeeperBatch(template, count, {
                      mode,
                      ...(prefix ? { name: prefix } : {}),
                    }),
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <FolderPlus size={16} />
              批量生成并保存
            </button>
          </div>
        </div>
      )}
      <div className="keeper-layout" hidden={showGuide}>
        <aside className="keeper-library">
          <input
            aria-label="搜索KP资料卡"
            placeholder="搜索名称或标签…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="keeper-filters">
            {(['all', 'npc', 'monster'] as const).map((kind) => (
              <button
                key={kind}
                className={filter === kind ? 'active' : ''}
                onClick={() => setFilter(kind)}
              >
                {kind === 'all' ? '全部' : kind === 'npc' ? 'NPC' : '怪物'}
              </button>
            ))}
          </div>
          <div className="keeper-card-list">
            {cards.map((c) => (
              <button
                className={c.id === draft?.id ? 'selected' : ''}
                key={c.id}
                onClick={() => choose(c)}
              >
                <span className={`keeper-card-icon ${c.kind}`}>
                  {c.kind === 'npc' ? <Users size={18} /> : <Skull size={18} />}
                </span>
                <span>
                  <b>{c.name}</b>
                  <small>
                    {KEEPER_CATEGORIES.find((cat) => cat.key === c.category)?.label} · HP{' '}
                    {c.hp ?? '—'}
                  </small>
                </span>
              </button>
            ))}
            {!cards.length && (
              <p className="subtle-note">这里还没有资料卡。可以新建、套用模板或导入一个资料集。</p>
            )}
          </div>
        </aside>
        <section className="keeper-editor">
          {draft ? (
            <>
              <div className="keeper-editor-heading">
                <div>
                  <span className="mini-label">
                    {draft.kind === 'npc' ? 'NON-PLAYER CHARACTER' : 'BESTIARY'}
                  </span>
                  <h3>{draft.name || '未命名资料卡'}</h3>
                </div>
                <div>
                  <button
                    className="icon-button"
                    aria-label="复制此资料卡"
                    onClick={() => {
                      try {
                        choose(duplicateKeeperCard(draft));
                        setMessage('副本已创建，请保存。');
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    <Copy size={17} />
                  </button>
                  {library.some((c) => c.id === draft.id) && (
                    <button
                      className="icon-button"
                      aria-label="删除此资料卡"
                      onClick={() => setDeleting(true)}
                    >
                      <Trash2 size={17} />
                    </button>
                  )}
                </div>
              </div>
              {deleting && (
                <div className="keeper-delete-confirm">
                  <span>删除「{draft.name}」？可先导出备份。</span>
                  <button className="text-button" onClick={() => setDeleting(false)}>
                    取消
                  </button>
                  <button
                    className="button danger compact"
                    onClick={async () => {
                      try {
                        await onDelete(draft.id);
                        setDraft(null);
                        setDeleting(false);
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    确认删除
                  </button>
                </div>
              )}
              <div className="editor-tabs">
                {(['identity', 'attributes', 'abilities'] as const).map((key, i) => (
                  <button
                    key={key}
                    className={section === key ? 'active' : ''}
                    onClick={() => setSection(key)}
                  >
                    {['面孔与秘密', '属性与骰式', '行动与能力'][i]}
                  </button>
                ))}
              </div>
              {section === 'identity' && (
                <div className="keeper-section">
                  <div className="form-grid">
                    <label className="field">
                      资料卡名称
                      <input
                        aria-label="资料卡名称"
                        maxLength={120}
                        value={draft.name}
                        onChange={(e) => patch({ name: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      分类
                      <select
                        value={draft.category}
                        onChange={(e) =>
                          patch({ category: e.target.value as KeeperCard['category'] })
                        }
                      >
                        {KEEPER_CATEGORIES.filter((c) =>
                          draft.kind === 'npc'
                            ? ['human', 'custom'].includes(c.key)
                            : c.key !== 'human',
                        ).map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="field">
                    外观与身份
                    <textarea
                      rows={3}
                      maxLength={4000}
                      value={draft.description}
                      onChange={(e) => patch({ description: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    私密笔记
                    <textarea
                      aria-label="私密笔记"
                      rows={5}
                      maxLength={24000}
                      value={draft.notes}
                      placeholder="动机、线索、弱点，或玩家尚不知道的真相…"
                      onChange={(e) => patch({ notes: e.target.value })}
                    />
                  </label>
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
                  <label className="field">
                    来源／原创说明
                    <input
                      maxLength={1000}
                      value={draft.source}
                      onChange={(e) => patch({ source: e.target.value })}
                    />
                  </label>
                </div>
              )}
              {section === 'attributes' && (
                <div className="keeper-section">
                  <div className="keeper-stat-actions">
                    <p className="subtle-note">
                      空值表示未知或不适用；怪物属性可超过 100。骰式如 3d6*5、(2d6+6)*5。
                    </p>
                    <button
                      className="button secondary compact"
                      onClick={() => {
                        try {
                          setDraft(rerollKeeperCard(draft));
                          setError('');
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      <RefreshCw size={14} />
                      按骰式重掷
                    </button>
                  </div>
                  <div className="keeper-attributes">
                    {KEEPER_ATTRIBUTES.map((a) => (
                      <div className="keeper-attribute" key={a.key}>
                        <span>
                          {a.label}
                          <small>{a.key.toUpperCase()}</small>
                        </span>
                        <input
                          aria-label={`资料卡${a.label}`}
                          type="number"
                          min={0}
                          max={100000}
                          value={draft.attributes[a.key] ?? ''}
                          placeholder="—"
                          onChange={(e) =>
                            patch({
                              attributes: {
                                ...draft.attributes,
                                [a.key]: nullable(e.target.value),
                              },
                            })
                          }
                        />
                        <input
                          aria-label={`${a.label}骰式`}
                          placeholder="可选骰式"
                          maxLength={80}
                          value={draft.attributeRolls[a.key] ?? ''}
                          onChange={(e) =>
                            patch({
                              attributeRolls: { ...draft.attributeRolls, [a.key]: e.target.value },
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                  <button
                    className="text-button recalculate"
                    onClick={() => {
                      try {
                        setDraft(deriveKeeperCard(draft));
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    根据属性重算 HP / MP / 伤害加值 / 体格
                  </button>
                  <div className="form-grid">
                    {resource('hp', '当前 HP')}
                    {resource('maxHp', 'HP 上限')}
                    {resource('mp', '当前 MP')}
                    {resource('maxMp', 'MP 上限')}
                    {resource('armor', '护甲')}
                    {resource('build', '体格')}
                    <label className="field">
                      伤害加值 DB
                      <input
                        value={draft.damageBonus}
                        maxLength={120}
                        onChange={(e) => patch({ damageBonus: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      移动方式／速率
                      <input
                        maxLength={200}
                        value={draft.movement}
                        onChange={(e) => patch({ movement: e.target.value })}
                      />
                    </label>
                  </div>
                  <label className="field">
                    护甲与抗性说明
                    <textarea
                      rows={2}
                      maxLength={2000}
                      value={draft.armorNotes}
                      onChange={(e) => patch({ armorNotes: e.target.value })}
                    />
                  </label>
                  <p className="subtle-note">
                    衍生值仅在点击重算时更新，可按剧本覆盖；重掷与重算不会自动治疗当前 HP／MP。
                  </p>
                </div>
              )}
              {section === 'abilities' && (
                <div className="keeper-section">
                  <div className="form-grid">
                    <label className="field">
                      每轮攻击次数
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={draft.attacksPerRound ?? ''}
                        onChange={(e) => patch({ attacksPerRound: nullable(e.target.value) })}
                      />
                    </label>
                    <label className="field">
                      理智损失
                      <input
                        aria-label="理智损失"
                        value={draft.sanityLoss}
                        maxLength={200}
                        placeholder="例如：0/1d4"
                        onChange={(e) => patch({ sanityLoss: e.target.value })}
                      />
                    </label>
                  </div>
                  <div className="policy-section-heading">
                    <h3>攻击方式</h3>
                    <button
                      className="button secondary compact"
                      disabled={draft.attacks.length >= 30}
                      onClick={() =>
                        patch({
                          attacks: [
                            ...draft.attacks,
                            {
                              id: crypto.randomUUID(),
                              name: '新攻击',
                              skill: 25,
                              damage: '',
                              notes: '',
                            },
                          ],
                        })
                      }
                    >
                      <Plus size={14} />
                      添加攻击
                    </button>
                  </div>
                  {draft.attacks.map((attack, i) => (
                    <div className="keeper-attack" key={attack.id}>
                      <div className="form-grid">
                        <label className="field">
                          攻击名称
                          <input
                            value={attack.name}
                            maxLength={120}
                            onChange={(e) =>
                              patch({
                                attacks: draft.attacks.map((a, n) =>
                                  i === n ? { ...a, name: e.target.value } : a,
                                ),
                              })
                            }
                          />
                        </label>
                        <label className="field">
                          攻击技能 %
                          <input
                            type="number"
                            min={0}
                            max={1000}
                            value={attack.skill ?? ''}
                            placeholder="—"
                            onChange={(e) =>
                              patch({
                                attacks: draft.attacks.map((a, n) =>
                                  i === n ? { ...a, skill: nullable(e.target.value) } : a,
                                ),
                              })
                            }
                          />
                        </label>
                        <label className="field">
                          伤害
                          <input
                            value={attack.damage}
                            maxLength={120}
                            placeholder="1d6 + DB"
                            onChange={(e) =>
                              patch({
                                attacks: draft.attacks.map((a, n) =>
                                  i === n ? { ...a, damage: e.target.value } : a,
                                ),
                              })
                            }
                          />
                        </label>
                        <label className="field">
                          行动说明
                          <input
                            value={attack.notes}
                            maxLength={2000}
                            onChange={(e) =>
                              patch({
                                attacks: draft.attacks.map((a, n) =>
                                  i === n ? { ...a, notes: e.target.value } : a,
                                ),
                              })
                            }
                          />
                        </label>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => patch({ attacks: draft.attacks.filter((_, n) => n !== i) })}
                      >
                        <Trash2 size={13} />
                        移除此攻击
                      </button>
                    </div>
                  ))}
                  <div className="policy-section-heading">
                    <h3>关键技能</h3>
                    <button
                      className="button secondary compact"
                      disabled={draft.skills.length >= 100}
                      onClick={() =>
                        patch({
                          skills: [
                            ...draft.skills,
                            { id: crypto.randomUUID(), name: '新技能', value: 50 },
                          ],
                        })
                      }
                    >
                      <Plus size={14} />
                      添加技能
                    </button>
                  </div>
                  {draft.skills.map((skill, i) => (
                    <div className="keeper-skill" key={skill.id}>
                      <input
                        aria-label={`NPC技能名称 ${i + 1}`}
                        value={skill.name}
                        maxLength={120}
                        onChange={(e) =>
                          patch({
                            skills: draft.skills.map((s, n) =>
                              i === n ? { ...s, name: e.target.value } : s,
                            ),
                          })
                        }
                      />
                      <input
                        aria-label={`NPC技能数值 ${i + 1}`}
                        type="number"
                        min={0}
                        max={1000}
                        value={skill.value}
                        onChange={(e) =>
                          patch({
                            skills: draft.skills.map((s, n) =>
                              i === n ? { ...s, value: Number(e.target.value) } : s,
                            ),
                          })
                        }
                      />
                      <button
                        className="icon-button"
                        aria-label={`移除NPC技能 ${i + 1}`}
                        onClick={() => patch({ skills: draft.skills.filter((_, n) => n !== i) })}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <label className="field">
                    特殊能力与法术
                    <textarea
                      rows={5}
                      maxLength={12000}
                      value={draft.specialAbilities}
                      onChange={(e) => patch({ specialAbilities: e.target.value })}
                    />
                  </label>
                  <p className="subtle-note">
                    NPC 与怪物按剧情需要定值，不消耗调查员职业点与兴趣点，也无需玩家卡审核。
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="keeper-empty">
              <div>
                <EyeOff size={36} strokeWidth={1} />
                <span className="mini-label">BEHIND THE SCREEN</span>
                <h3>这里，藏着故事的另一半。</h3>
                <p>
                  为即将出场的 NPC 或怪物准备资料，
                  <br />
                  或从模板一次生成一组不同个体。
                </p>
                <button className="button primary" onClick={() => setBatch(true)}>
                  <Layers size={16} />
                  浏览模板
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
