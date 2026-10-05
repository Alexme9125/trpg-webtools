import { MAX_ARCHIVE_BYTES, type ArchiveSummary } from '../../shared/archive';
import { inspectArchive } from '../api';
import { ArchiveSummaryView } from './ArchiveSummary';
import { parseRoomConfig, MAX_ROOM_CONFIG_BYTES, type RoomConfig } from '../../shared/room-config';
import { ConfigurationSummary } from './RoomConfiguration';
import { useRef, useState, type FormEvent } from 'react';
import {
  ArrowUpRight,
  ArrowLeft,
  Plus,
  LogIn,
  Upload,
  BookOpen,
  Users,
  Sparkles,
  Check,
  MessageSquare,
  Headphones,
  FileText,
  MoreHorizontal,
  Trash2,
  Download,
  Shield,
  Eye,
} from 'lucide-react';
import type {
  Character,
  CreateRoomInput,
  JoinRoomInput,
  RuleId,
  RoomMode,
} from '../../shared/types';
import { exportCharacter, parseCharacter } from '../../shared/rules';
import { readStored, writeStored, downloadFile } from '../storage';
import { DieIcon, Spinner, Modal, ruleName, ruleEdition } from './ui';

export function RuleSelection({
  onSelect,
  onRules,
  onLibrary,
}: {
  onSelect: (rule: RuleId) => void;
  onRules: (rule: RuleId) => void;
  onLibrary: () => void;
}) {
  return (
    <div className="welcome page-enter">
      <div className="section-eyebrow">
        <span className="tiny-dash" /> YOUR NEXT CHAPTER
      </div>
      <div className="welcome-heading">
        <div>
          <h1>
            好故事，<span>从同桌开始。</span>
          </h1>
          <p>选一套规则，邀几位同伴。把想象留给你们，琐事交给幕间。</p>
        </div>
        <span className="step-indicator">
          <span className="step-current">01 选择规则</span>
          <span className="step-line" />
          <span>02 入席</span>
        </span>
      </div>
      <div className="rule-grid">
        <RuleCard rule="dnd" onSelect={onSelect} onRules={onRules} />
        <RuleCard rule="coc" onSelect={onSelect} onRules={onRules} />
      </div>
      <div className="welcome-bottom">
        <div className="welcome-note">
          <span className="note-icon">
            <Users size={21} />
          </span>
          <div>
            <h3>为你们的下一次相聚，留一张桌子。</h3>
            <p>一位主持人，几位玩家；一串房间码，就能入席。</p>
          </div>
        </div>
        <button className="text-button" onClick={onLibrary}>
          <FileText size={16} /> 整理我的角色档案 <ArrowUpRight size={16} />
        </button>
      </div>
      <div className="welcome-footer">
        <span>骰子会停下，故事不会。</span>
        <span>角色卡 · 骰子与检定 · 共同叙事</span>
      </div>
    </div>
  );
}
function RuleCard({
  rule,
  onSelect,
  onRules,
}: {
  rule: RuleId;
  onSelect: (rule: RuleId) => void;
  onRules: (rule: RuleId) => void;
}) {
  const dnd = rule === 'dnd';
  return (
    <article className={`rule-card ${rule}`}>
      <div className="rule-art" aria-hidden="true">
        <div className="art-orbit orbit-one" />
        <div className="art-orbit orbit-two" />
        <div className="art-orbit orbit-three" />
        <div className="rule-symbol">
          {dnd ? <DieIcon size={192} /> : <Eye size={175} strokeWidth={0.55} />}
        </div>
        <span className="art-spark spark-one">+</span>
        <span className="art-spark spark-two">+</span>
        <span className="art-coordinate">
          {dnd ? 'D20 / A WORLD OF POSSIBILITY' : 'D100 / INTO THE UNKNOWN'}
        </span>
      </div>
      <div className="rule-card-top">
        <span className="rule-edition">{dnd ? 'D&D 5e' : 'CoC 7th'}</span>
        <button
          onClick={() => onRules(rule)}
          className="rule-info"
          aria-label={`查看${ruleName(rule)}规则`}
        >
          <BookOpen size={17} />
        </button>
      </div>
      <div className="rule-card-copy">
        <span className="rule-kicker">{dnd ? '剑与魔法，自由冒险' : '寻觅线索，直面未知'}</span>
        <h2>
          {dnd ? (
            <>
              Dungeons
              <br />
              <em>&</em> Dragons
            </>
          ) : (
            <>
              Call of
              <br />
              Cthulhu
            </>
          )}
        </h2>
        <div className="rule-chinese">{ruleName(rule)}</div>
        <p>
          {dnd
            ? '成为故事中的英雄。让每一次选择，打开新的可能。'
            : '有些秘密，等待被发现。有些真相，最好永不知晓。'}
        </p>
      </div>
      <button className="rule-choose" onClick={() => onSelect(rule)}>
        <span>选择此规则</span>
        <span className="round-arrow">
          <ArrowUpRight size={21} />
        </span>
      </button>
    </article>
  );
}

export function Gateway({
  rule,
  onBack,
  onCreate,
  onRestore,
  onJoin,
}: {
  rule: RuleId;
  onBack: () => void;
  onCreate: (input: CreateRoomInput) => Promise<void>;
  onRestore: (file: File, nickname: string) => Promise<void>;
  onJoin: (input: JoinRoomInput) => Promise<void>;
}) {
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [nickname, setNickname] = useState(readStored<string>('interlude-nickname', ''));
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [seatCode, setSeatCode] = useState('');
  const [archive, setArchive] = useState<{ file: File; summary: ArchiveSummary } | null>(null);
  const archiveFile = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<RoomMode>('in-room');
  const [configuration, setConfiguration] = useState<RoomConfig | null>(null);
  const configFile = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      writeStored('interlude-nickname', nickname.trim());
      if (tab === 'create' && archive) await onRestore(archive.file, nickname.trim());
      else if (tab === 'create')
        await onCreate({
          name: name.trim(),
          nickname: nickname.trim(),
          rule,
          mode,
          ...(configuration
            ? { configuration: { ...configuration, name: name.trim(), mode } }
            : {}),
        });
      else
        await onJoin({
          code: code.trim().toUpperCase(),
          nickname: nickname.trim(),
          rule,
          ...(seatCode ? { seatCode } : {}),
        });
    } catch (e) {
      setError(e instanceof Error ? e.message : '连接失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="gateway page-enter">
      <button className="text-button back-button" onClick={onBack}>
        <ArrowLeft size={17} /> 返回选择规则
      </button>
      <div className="gateway-grid">
        <div className={`gateway-intro ${rule}`}>
          <div className="section-eyebrow">{ruleEdition(rule)}</div>
          <h1>
            故事将启，
            <br />
            <span>请入席。</span>
          </h1>
          <p>
            属于你们的角色、骰子和冒险，
            <br />
            都在这一张桌上。
          </p>
          <PreviewTable />
          <div className="gateway-intro-footer">
            <Shield size={15} /> 主持人掌舵，所有人共同书写
          </div>
        </div>
        <div className="gateway-form">
          <div className="gateway-rule">
            <span className={`rule-dot ${rule}`} /> {ruleName(rule)}
            <span className="muted">{rule === 'dnd' ? '5e · 2014' : '第 7 版'}</span>
          </div>
          <div className="segmented">
            <button
              className={tab === 'create' ? 'selected' : ''}
              onClick={() => {
                setTab('create');
                setError('');
              }}
            >
              <Plus size={17} /> 创建房间
            </button>
            <button
              className={tab === 'join' ? 'selected' : ''}
              onClick={() => {
                setTab('join');
                setError('');
              }}
            >
              <LogIn size={17} /> 加入房间
            </button>
          </div>
          <form onSubmit={submit}>
            <label className="field">
              你的称呼
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="让同伴知道怎么称呼你"
                required
                maxLength={20}
                autoComplete="nickname"
              />
            </label>
            {tab === 'create' ? (
              <>
                <div className="gateway-archive">
                  <button
                    className="button secondary full compact"
                    type="button"
                    disabled={busy}
                    onClick={() => archiveFile.current?.click()}
                  >
                    <Upload size={16} /> 从全局存档续团
                  </button>
                  <input
                    ref={archiveFile}
                    className="visually-hidden"
                    type="file"
                    accept=".zip"
                    aria-label="全局存档文件"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setBusy(true);
                      setError('');
                      try {
                        if (file.size > MAX_ARCHIVE_BYTES) throw new Error('存档不能超过 32 MiB。');
                        const summary = await inspectArchive(file);
                        if (summary.rule !== rule)
                          throw new Error('存档规则与所选规则不匹配，请返回选择对应规则。');
                        setArchive({ file, summary });
                        setConfiguration(null);
                        setName(summary.name);
                      } catch (err) {
                        setError((err as Error).message);
                      } finally {
                        setBusy(false);
                        if (archiveFile.current) archiveFile.current.value = '';
                      }
                    }}
                  />
                  {archive && (
                    <div className="gateway-archive-preview">
                      <b>{archive.summary.name}</b>
                      <small>已载入：{archive.file.name}</small>
                      <p>保存于 {new Date(archive.summary.exportedAt).toLocaleString('zh-CN')}</p>
                      <ArchiveSummaryView value={archive.summary} />
                      <p>将创建新房间并恢复原阶段。稍后向每位玩家分发各自的席位恢复码。</p>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => setArchive(null)}
                      >
                        移除存档，创建新故事
                      </button>
                    </div>
                  )}
                </div>
                {!archive && (
                  <div className="gateway-config">
                    <button
                      className="text-button"
                      type="button"
                      disabled={busy}
                      onClick={() => configFile.current?.click()}
                    >
                      <Upload size={15} />
                      从配置文件创建
                    </button>
                    <input
                      ref={configFile}
                      className="visually-hidden"
                      type="file"
                      accept=".json,.md,.markdown"
                      aria-label="新房间配置文件"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          if (file.size > MAX_ROOM_CONFIG_BYTES)
                            throw new Error('房间配置不能超过 128 KiB。');
                          const config = parseRoomConfig(await file.text());
                          if (config.rule !== rule)
                            throw new Error('配置规则与所选规则不匹配，请返回选择对应规则。');
                          setConfiguration(config);
                          setArchive(null);
                          setName(config.name);
                          setMode(config.mode);
                          setError('');
                        } catch (err) {
                          setError((err as Error).message);
                        } finally {
                          if (configFile.current) configFile.current.value = '';
                        }
                      }}
                    />
                    {configuration && (
                      <>
                        <details>
                          <summary>已载入配置：{configuration.name}</summary>
                          <ConfigurationSummary value={{ ...configuration, name, mode }} />
                        </details>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setConfiguration(null)}
                        >
                          移除配置，使用默认制卡要求
                        </button>
                      </>
                    )}
                  </div>
                )}
                <label className="field">
                  房间名称
                  <input
                    value={name}
                    disabled={!!archive}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={rule === 'dnd' ? '例如：雾港的来信' : '例如：钟声响起之前'}
                    required
                    maxLength={60}
                  />
                </label>
                {!archive && (
                  <fieldset className="mode-field">
                    <legend>这次在哪里演绎故事？</legend>
                    <button
                      type="button"
                      aria-pressed={mode === 'in-room'}
                      className={`mode-option ${mode === 'in-room' ? 'selected' : ''}`}
                      onClick={() => setMode('in-room')}
                    >
                      <MessageSquare size={20} />
                      <span>
                        <b>就在这里</b>
                        <small>文字叙事、公共记录和主持人灵感小窗</small>
                      </span>
                      <span className="radio-mark">
                        {mode === 'in-room' && <Check size={12} />}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-pressed={mode === 'external'}
                      className={`mode-option ${mode === 'external' ? 'selected' : ''}`}
                      onClick={() => setMode('external')}
                    >
                      <Headphones size={20} />
                      <span>
                        <b>在其他地方</b>
                        <small>线下或语音跑团，这里专注制卡与掷骰</small>
                      </span>
                      <span className="radio-mark">
                        {mode === 'external' && <Check size={12} />}
                      </span>
                    </button>
                  </fieldset>
                )}
              </>
            ) : (
              <>
                <label className="field">
                  房间码
                  <input
                    className="room-code-input"
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                    }
                    placeholder="6 位房间码"
                    required
                    minLength={6}
                    maxLength={6}
                    autoComplete="off"
                  />
                </label>
                <label className="field">
                  席位恢复码（续团时填写）
                  <input
                    value={seatCode}
                    onChange={(e) =>
                      setSeatCode(e.target.value.toUpperCase().replace(/[^A-F0-9]/g, ''))
                    }
                    placeholder="由主持人提供，普通新玩家留空"
                    maxLength={16}
                    minLength={16}
                    autoComplete="off"
                  />
                  <small>恢复原角色、资源和行动状态；每个恢复码只可用一次。</small>
                </label>
                <div className="form-note">
                  <Users size={20} />
                  <p>
                    向主持人索取房间码。
                    <br />
                    请确保你与房间选择了同一套规则。
                  </p>
                </div>
              </>
            )}
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary full" disabled={busy} type="submit">
              {busy ? <Spinner /> : tab === 'create' ? <Plus size={18} /> : <LogIn size={18} />}
              {busy
                ? '正在连接…'
                : tab === 'create'
                  ? archive
                    ? '恢复存档，继续故事'
                    : '创建房间，成为主持人'
                  : '加入房间'}
            </button>
            <p className="form-footnote">无需注册 · 使用本浏览器可自动重回房间</p>
          </form>
        </div>
      </div>
    </div>
  );
}
function PreviewTable() {
  return (
    <div className="preview-table" aria-label="圆桌席位示意">
      <div className="preview-glass">
        <DieIcon size={60} />
        <span>TAKE A SEAT</span>
      </div>
      {[0, 1, 2, 3].map((n) => (
        <div className={`preview-seat seat-${n}`} key={n}>
          <span>{n === 0 ? <Sparkles size={17} /> : <Users size={16} />}</span>
          <small>{n === 0 ? '主持人' : '玩家席'}</small>
        </div>
      ))}
    </div>
  );
}

export function Library({
  cards,
  onCreate,
  onEdit,
  onImport,
  onDelete,
}: {
  cards: Character[];
  onCreate: (rule: RuleId) => void;
  onEdit: (card: Character) => void;
  onImport: (card: Character) => void;
  onDelete: (id: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | RuleId>('all');
  const [newCard, setNewCard] = useState(false);
  const [removing, setRemoving] = useState<Character | null>(null);
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 256000) throw new Error('角色卡不能超过 256 KB。');
      onImport(parseCharacter(await file.text()));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const filtered = cards.filter((c) => filter === 'all' || c.rule === filter);
  return (
    <div className="library page-enter">
      <div className="section-eyebrow">CHARACTER ARCHIVE</div>
      <div className="page-heading">
        <div>
          <h1>
            每个名字，<span>都有来处。</span>
          </h1>
          <p>收藏你的角色，下次冒险时，再次相见。</p>
        </div>
        <div className="button-row">
          <button className="button secondary" onClick={() => fileRef.current?.click()}>
            <Upload size={17} /> 导入角色卡
          </button>
          <button className="button primary" onClick={() => setNewCard(true)}>
            <Plus size={17} /> 新建角色
          </button>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".json,.md,.markdown,application/json,text/markdown"
        className="visually-hidden"
        aria-label="导入角色文件"
        onChange={(e) => void importFile(e.target.files?.[0])}
      />
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="library-filter">
        <div className="tabs">
          {(['all', 'dnd', 'coc'] as const).map((v) => (
            <button key={v} className={filter === v ? 'active' : ''} onClick={() => setFilter(v)}>
              {v === 'all' ? '全部角色' : v === 'dnd' ? 'D&D' : 'CoC'}
            </button>
          ))}
        </div>
        <span>{filtered.length} 位角色 · 保存在此浏览器</span>
      </div>
      {filtered.length ? (
        <div className="character-grid">
          {filtered.map((card) => (
            <article key={card.id} className="character-card">
              <div className="character-card-top">
                <span className={`character-avatar ${card.rule}`}>
                  {card.name.slice(0, 1) || '?'}
                </span>
                <span className="pill">{ruleEdition(card.rule)}</span>
              </div>
              <h2>{card.name}</h2>
              <p>
                {card.ancestry && `${card.ancestry} · `}
                {card.occupation}
                {card.rule === 'dnd' && ` · Lv.${card.level}`}
              </p>
              <div className="character-card-stats">
                <span>
                  <small>生命</small>
                  {card.hp}
                  <em> / {card.maxHp}</em>
                </span>
                <span>
                  <small>{card.rule === 'dnd' ? '护甲等级' : '理智'}</small>
                  {card.rule === 'dnd' ? card.ac : card.san}
                </span>
                <span>
                  <small>物品</small>
                  {card.items.length}
                </span>
              </div>
              <div className="character-card-bottom">
                <button className="text-button" onClick={() => onEdit(card)}>
                  打开角色卡 <ArrowUpRight size={15} />
                </button>
                <div>
                  <button
                    className="icon-button"
                    aria-label={`导出${card.name}`}
                    onClick={() =>
                      downloadFile(
                        exportCharacter(card, 'json'),
                        `${card.name}.json`,
                        'application/json',
                      )
                    }
                  >
                    <Download size={16} />
                  </button>
                  <button
                    className="icon-button danger-text"
                    aria-label={`删除${card.name}`}
                    onClick={() => setRemoving(card)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-library">
          <span className="empty-icon">
            <FileText size={35} strokeWidth={1} />
          </span>
          <h2>故事的主角，还没有登场。</h2>
          <p>从一张新角色卡开始，或导入之前导出的 JSON / Markdown 文件。</p>
          <button className="button primary" onClick={() => setNewCard(true)}>
            <Plus size={16} /> 创造第一个角色
          </button>
        </div>
      )}
      <div className="library-tip">
        <FileText size={18} />
        <p>角色档案存储在当前浏览器。离开这台设备前，记得导出一份 JSON 或 Markdown 备份。</p>
      </div>
      {newCard && (
        <Modal title="为哪段故事创造角色？" onClose={() => setNewCard(false)}>
          <div className="new-character-options">
            {(['dnd', 'coc'] as const).map((rule) => (
              <button
                key={rule}
                className={`new-character-option ${rule}`}
                onClick={() => {
                  setNewCard(false);
                  onCreate(rule);
                }}
              >
                <DieIcon size={40} />
                <span>
                  <b>{ruleName(rule)}</b>
                  <small>{ruleEdition(rule)}</small>
                </span>
                <Plus size={20} />
              </button>
            ))}
          </div>
        </Modal>
      )}
      {removing && (
        <Modal
          title="移除这份角色档案？"
          onClose={() => setRemoving(null)}
          footer={
            <>
              <button className="button secondary" onClick={() => setRemoving(null)}>
                保留
              </button>
              <button
                className="button danger"
                onClick={() => {
                  onDelete(removing.id);
                  setRemoving(null);
                }}
              >
                移除档案
              </button>
            </>
          }
        >
          <p>将从此浏览器中移除「{removing.name}」。已导出的文件和房间内的角色不受影响。</p>
        </Modal>
      )}
    </div>
  );
}

export function RulesModal({ rule, onClose }: { rule: RuleId; onClose: () => void }) {
  const dnd = rule === 'dnd';
  return (
    <Modal
      title={`${ruleName(rule)} · 规则速览`}
      subtitle={dnd ? 'D&D 5e（2014）/ SRD 5.1' : 'Call of Cthulhu · 第 7 版'}
      onClose={onClose}
      className="rules-modal"
    >
      <div className="rules-intro">
        <DieIcon size={50} />
        <p>
          {dnd
            ? '以 D20 为核心的奇幻冒险。这里协助制卡与运算，具体行动由主持人与玩家共同裁定。'
            : '以 D100 为核心的调查与悬疑。这里协助记录属性、技能与理智，故事中的未知由守密人揭晓。'}
        </p>
      </div>
      <div className="rules-sections">
        <section>
          <span className="mini-label">角色生成</span>
          <h3>{dnd ? '六项属性，四投取三' : '八项属性，加上幸运'}</h3>
          <p>
            {dnd
              ? '每项属性掷 4D6，去掉最低一枚后求和。属性调整值 = 向下取整（属性 − 10）÷ 2。可以不限次数重掷。种族加值、职业特性、生命上限与护甲由你填写。'
              : '力量、体质、敏捷、外貌、意志和幸运：3D6 × 5；体型、智力、教育：（2D6 + 6）× 5。生命 =（体质 + 体型）÷ 10 向下取整，魔法 = 意志 ÷ 5。'}
          </p>
        </section>
        <section>
          <span className="mini-label">检定</span>
          <h3>{dnd ? 'D20 + 调整值，与难度对比' : '掷出不超过目标值的百分骰'}</h3>
          <p>
            {dnd
              ? '达到 DC 即成功。优势掷两枚 D20 取高，劣势取低。熟练技能与豁免加熟练加值；自然 1 / 20 的自动失败或命中仅用于攻击检定。'
              : '不超过技能值为普通成功，一半为困难成功，五分之一为极难成功。1 为大成功；目标小于 50 时 96–100 大失败，否则 100 大失败。奖励／惩罚骰共用个位，额外掷十位骰。'}
          </p>
        </section>
        <section>
          <span className="mini-label">保留给你们的决定</span>
          <h3>运算交给工具，裁定留给同桌。</h3>
          <p>
            {dnd
              ? '职业、背景、种族的技能熟练分开选择，专精受职业等级名额限制。其他特性带来的额外名额由 DM 设置；法术、装备与升级效果请结合规则书记录。卡片数值合规并通过 DM 审核后才能开场。'
              : '技能按基础值、职业点和兴趣点分配，系统检查预算、信用区间与本团上限。年龄修正、伤害加值、移动及精神状态由守密人裁定。卡片数值合规并通过 KP 审核后才能开场；KP 另有独立的 NPC 与怪物卡库。'}
          </p>
        </section>
      </div>
      <div className="rules-links">
        <a
          href={
            dnd
              ? 'https://www.dndbeyond.com/srd'
              : 'https://www.chaosium.com/call-of-cthulhu-resources/'
          }
          target="_blank"
          rel="noreferrer"
        >
          <BookOpen size={15} /> 官方规则资料 <ArrowUpRight size={14} />
        </a>
        <a href="https://github.com/AgnesSummer/TRPG" target="_blank" rel="noreferrer">
          参考资料仓库 <ArrowUpRight size={14} />
        </a>
      </div>
    </Modal>
  );
}
