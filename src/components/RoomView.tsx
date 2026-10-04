import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import {
  BookOpen,
  Copy,
  Check,
  Crown,
  Users,
  Plus,
  FileText,
  Play,
  Pause,
  LogOut,
  Heart,
  Brain,
  Shield,
  WandSparkles,
  Dices,
  Crosshair,
  Backpack,
  Send,
  EyeOff,
  Globe,
  Sparkles,
  X,
  Download,
  Headphones,
  MessageSquare,
  SlidersHorizontal,
  ChevronRight,
  Trash2,
  Minus,
  ArrowUpRight,
  CheckCheck,
  Clock3,
  ClipboardCheck,
} from 'lucide-react';
import type {
  Character,
  CheckRequest,
  Edge,
  Inspiration,
  Member,
  Room,
  RoomAction,
  RoomEvent,
  Session,
  Visibility,
} from '../../shared/types';
import {
  COC_ATTRIBUTES,
  COC_SKILLS,
  DND_ATTRIBUTES,
  DND_SKILLS,
  abilityModifier,
  exportCharacter,
  proficiencyBonus,
} from '../../shared/rules';
import { getInspiration } from '../api';
import { validateCreation, dndSkillModifier } from '../../shared/creation';
import { ReviewDesk, isApproved, reviewLabel } from './ReviewDesk';
import { ValidationSummary } from './AllocationEditor';
import { downloadFile } from '../storage';
import { DieIcon, Modal, Spinner, hostName, ruleEdition } from './ui';
const EncounterPanel = lazy(() => import('./EncounterPanel'));

interface Props {
  room: Room;
  session: Session;
  connected: boolean;
  aiConfigured: boolean;
  library: Character[];
  onAction: (action: RoomAction) => Promise<void>;
  onEdit: (card: Character | null) => void;
  onRules: () => void;
  onHostToolkit: () => void;
  notify: (message: string, type?: 'success' | 'error') => void;
}
export function RoomView({
  room,
  session,
  connected,
  aiConfigured,
  library,
  onAction,
  onEdit,
  onRules,
  onHostToolkit,
  notify,
}: Props) {
  const me = room.members.find((m) => m.id === session.memberId)!;
  const isHost = me?.role === 'host';
  const [tool, setTool] = useState<'dice' | 'check' | 'inventory'>('dice');
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showHost, setShowHost] = useState(false);
  const [showEncounter, setShowEncounter] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showInspiration, setShowInspiration] = useState(false);
  const [leave, setLeave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mobileTab, setMobileTab] = useState<'table' | 'tools' | 'party'>('table');
  const run = async (action: RoomAction) => {
    if (!connected) {
      notify('连接尚未恢复，请稍候。', 'error');
      return false;
    }
    try {
      await onAction(action);
      return true;
    } catch (error) {
      notify((error as Error).message, 'error');
      return false;
    }
  };
  if (!me) return null;
  const players = room.members.filter((m) => m.role === 'player');
  const readyCount = room.members.filter((m) => m.ready && m.online).length;
  const canStart =
    room.members.every(
      (m) =>
        m.ready &&
        m.online &&
        (m.role === 'host' ||
          (m.character &&
            isApproved(m, room) &&
            validateCreation(m.character, room.creationPolicy).length === 0)),
    ) && players.length > 0;
  const card = isHost ? null : me.character;
  const cardErrors = card ? validateCreation(card, room.creationPolicy) : [];
  const focused = room.members.find((m) => m.id === selectedMember);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      notify('房间码已复制。');
    } catch {
      notify(`房间码：${room.code}，可长按选择复制。`);
    }
  };
  return (
    <div className="room-view page-enter">
      <div className="room-heading">
        <div className="room-title">
          <span className={`room-rule-mark ${room.rule}`}>
            <DieIcon size={24} />
          </span>
          <div>
            <h1>{room.name}</h1>
            <p>
              {ruleEdition(room.rule)}
              <span>·</span>
              {room.mode === 'in-room' ? '房内演绎' : '外部演绎'}
            </p>
          </div>
          <span className={`status-pill ${room.phase === 'active' ? 'live' : ''}`}>
            <i />
            {room.phase === 'active' ? '故事进行中' : '准备入席'}
          </span>
        </div>
        <div className="room-heading-actions">
          <button className="room-code" onClick={() => void copy()} title="复制房间码">
            <span>房间码</span>
            <b>{room.code}</b>
            <Copy size={14} />
          </button>
          <button className="icon-button" onClick={onRules} aria-label="规则速览">
            <BookOpen size={19} />
          </button>
          <button className="icon-button" onClick={() => setLeave(true)} aria-label="离开房间">
            <LogOut size={19} />
          </button>
        </div>
      </div>
      <div className="mobile-room-tabs">
        <button
          className={mobileTab === 'table' ? 'active' : ''}
          onClick={() => setMobileTab('table')}
        >
          <ArmchairIcon /> 圆桌与记录
        </button>
        <button
          className={mobileTab === 'tools' ? 'active' : ''}
          onClick={() => setMobileTab('tools')}
        >
          <Dices size={17} /> 局内工具
        </button>
        <button
          className={mobileTab === 'party' ? 'active' : ''}
          onClick={() => setMobileTab('party')}
        >
          <Users size={17} /> 同桌伙伴
        </button>
      </div>
      <div className={`room-grid mobile-${mobileTab}`}>
        <aside className="party-panel panel">
          <div className="panel-heading">
            <h2>同桌伙伴</h2>
            <span>{room.members.length} / 8</span>
          </div>
          <div className="member-list">
            {room.members.map((member) => (
              <button
                className={`member-row ${member.id === me.id ? 'is-me' : ''}`}
                key={member.id}
                onClick={() => setSelectedMember(member.id)}
              >
                <Avatar member={member} />
                <span className="member-copy">
                  <b>
                    {member.name}
                    {member.id === me.id && <small>你</small>}
                  </b>
                  <span>
                    {member.role === 'host'
                      ? hostName(room.rule)
                      : member.character?.name || '正在准备角色'}
                  </span>
                </span>
                <span className={`member-status ${member.ready ? 'ready' : ''}`}>
                  {!member.online ? (
                    <span className="offline-dot" title="已离线" />
                  ) : member.ready ? (
                    <Check size={15} />
                  ) : (
                    <Clock3 size={13} />
                  )}
                </span>
              </button>
            ))}
          </div>
          <button className="invite-row" onClick={() => void copy()}>
            <Plus size={16} /> 复制房间码，邀请同伴
          </button>
          <div className="party-divider" />
          {isHost ? (
            <div className="host-workbench">
              <span className="mini-label">BEHIND THE SCREEN</span>
              <h3>你是故事的引路人。</h3>
              <p>主持人无需玩家角色。先设置制卡要求，再审核同伴的故事与数值。</p>
              <button className="button primary full compact" onClick={() => setShowReview(true)}>
                <ClipboardCheck size={16} />
                角色卡审核{' '}
                <small>
                  {players.filter((m) => isApproved(m, room)).length}/{players.length}
                </small>
              </button>
              <button className="button secondary full compact" onClick={onHostToolkit}>
                <BookOpen size={16} />
                主持人工具集
              </button>
            </div>
          ) : (
            <>
              <div className="panel-heading">
                <h2>我的角色</h2>
                {card && (
                  <button
                    className="icon-button small"
                    onClick={() =>
                      downloadFile(
                        exportCharacter(card, 'json'),
                        `${card.name}.json`,
                        'application/json',
                      )
                    }
                    aria-label="导出当前角色"
                  >
                    <Download size={15} />
                  </button>
                )}
              </div>
              {card ? (
                <div className="my-character">
                  <div className={`my-character-avatar ${room.rule}`}>{card.name.slice(0, 1)}</div>
                  <h3>{card.name}</h3>
                  <p>
                    {card.occupation}
                    {room.rule === 'dnd' && ` · Lv.${card.level}`}
                  </p>
                  <div className="my-resources">
                    <ResourceControl
                      label="生命"
                      icon={<Heart size={13} />}
                      value={card.hp}
                      max={card.maxHp}
                      onChange={(value) =>
                        void run({ type: 'resource', memberId: me.id, resource: 'hp', value })
                      }
                    />
                    <ResourceControl
                      label={room.rule === 'dnd' ? '护甲' : '理智'}
                      icon={room.rule === 'dnd' ? <Shield size={13} /> : <Brain size={13} />}
                      value={room.rule === 'dnd' ? card.ac : card.san}
                      max={room.rule === 'dnd' ? undefined : card.maxSan}
                      onChange={
                        room.rule === 'dnd'
                          ? undefined
                          : (value) =>
                              void run({
                                type: 'resource',
                                memberId: me.id,
                                resource: 'san',
                                value,
                              })
                      }
                    />
                  </div>
                  <button
                    className="button secondary full compact"
                    onClick={() =>
                      room.phase === 'lobby' ? onEdit(card) : setSelectedMember(me.id)
                    }
                  >
                    <FileText size={15} />
                    {room.phase === 'lobby' ? '编辑角色卡' : '查看角色卡'}
                  </button>
                </div>
              ) : (
                <div className="no-character">
                  <div className="empty-icon small">
                    <FileText size={26} strokeWidth={1.2} />
                  </div>
                  <h3>{'主角，该你登场了。'}</h3>
                  <p>创建角色，或从档案带来一位老朋友。</p>
                  <button
                    className="button primary full compact"
                    onClick={() => onEdit(null)}
                    disabled={room.phase !== 'lobby'}
                  >
                    <Plus size={15} /> 创建角色
                  </button>
                </div>
              )}
              {room.phase === 'lobby' && (
                <button className="text-button load-character" onClick={() => setShowLibrary(true)}>
                  <FileText size={14} /> 从档案载入
                </button>
              )}
              {card && (
                <div className={`my-review-status ${isApproved(me, room) ? 'approved' : ''}`}>
                  <ClipboardCheck size={15} />
                  <b>{reviewLabel(me, room)}</b>
                  {me.review.note && <p>{me.review.note}</p>}
                </div>
              )}
              {card && cardErrors.length > 0 && room.phase === 'lobby' && (
                <ValidationSummary errors={cardErrors} compact />
              )}
              <button className="text-button load-character" onClick={() => setShowReview(true)}>
                <SlidersHorizontal size={14} />
                查看本桌制卡要求
              </button>
            </>
          )}
          <div className="party-ready">
            <span>
              {me.ready
                ? '你已经准备好了'
                : card || isHost
                  ? '准备好后，告诉大家'
                  : '完成制卡后即可准备'}
            </span>
            <button
              className={`button full ${me.ready ? 'secondary ready-button' : 'primary'}`}
              disabled={
                room.phase === 'active' ||
                (!isHost && (!card || cardErrors.length > 0)) ||
                !connected
              }
              onClick={() => void run({ type: 'ready', ready: !me.ready })}
            >
              {me.ready ? <CheckCheck size={17} /> : <Check size={17} />}
              {room.phase === 'active' ? '已入席' : me.ready ? '已准备 · 点击取消' : '我准备好了'}
            </button>
          </div>
        </aside>
        <section className="table-column">
          <div className="table-panel panel">
            <div className="table-panel-heading">
              <span className="mini-label">OUR LITTLE WORLD</span>
              <span>
                {readyCount} / {room.members.length} 人已准备
              </span>
            </div>
            <RoundTable room={room} me={me} onMember={setSelectedMember} />
            <div className="table-bottom">
              <div>
                <span className={`connection-dot ${connected ? '' : 'offline'}`} />
                <span>
                  {room.phase === 'active'
                    ? room.scene.title || '故事正慢慢展开'
                    : players.length === 0
                      ? '把空着的座位，留给你的同伴。'
                      : canStart
                        ? '大家都已准备好，等待主持人开启故事。'
                        : players.some((p) => !isApproved(p, room))
                          ? '等待角色卡通过数值检查与主持人审核。'
                          : '同伴正在准备，故事很快就要开始。'}
                </span>
              </div>
              {isHost && (
                <button
                  className={`button compact ${room.phase === 'active' ? 'secondary' : 'primary'}`}
                  disabled={!connected || busy || (room.phase === 'lobby' && !canStart)}
                  onClick={async () => {
                    setBusy(true);
                    await run({ type: room.phase === 'active' ? 'pause' : 'start' });
                    setBusy(false);
                  }}
                >
                  {busy ? (
                    <Spinner />
                  ) : room.phase === 'active' ? (
                    <Pause size={15} />
                  ) : (
                    <Play size={15} />
                  )}
                  {room.phase === 'active' ? '返回准备' : '开启故事'}
                </button>
              )}
            </div>
          </div>
          <StoryLog room={room} me={me} run={run} notify={notify} />
        </section>
        <aside className="tools-panel panel">
          <div className="panel-heading">
            <h2>桌边工具</h2>
            <span className="utility-label">TOOLKIT</span>
          </div>
          <div className="tool-tabs">
            {(
              [
                ['dice', Dices, '掷骰'],
                ['check', Crosshair, '检定'],
                ['inventory', Backpack, '行囊'],
              ] as const
            ).map(([key, Icon, label]) => (
              <button
                key={key}
                className={tool === key ? 'active' : ''}
                onClick={() => setTool(key)}
              >
                <Icon size={17} />
                {label}
              </button>
            ))}
          </div>
          <div className="tool-content">
            {tool === 'dice' && <DiceTool room={room} me={me} run={run} />}
            {tool === 'check' && <CheckTool room={room} me={me} run={run} />}
            {tool === 'inventory' && <InventoryTool room={room} me={me} run={run} />}
          </div>
          {isHost && (
            <div className="host-tool-links">
              <button onClick={() => setShowReview(true)}>
                <ClipboardCheck size={18} />
                <span>
                  审核与制卡要求<small>分配核对、剧本范围与审核意见</small>
                </span>
                <ChevronRight size={16} />
              </button>
              <button onClick={onHostToolkit}>
                <BookOpen size={18} />
                <span>
                  主持人工具集<small>个人备团库、NPC／怪物与剧本导入</small>
                </span>
                <ChevronRight size={16} />
              </button>

              <button aria-label="场景与回合" onClick={() => setShowHost(true)}>
                <SlidersHorizontal size={18} />
                <span>
                  场景与回合<small>场景、演出方式与战斗记录</small>
                </span>
                <ChevronRight size={16} />
              </button>
              {room.mode === 'in-room' && (
                <button className="inspiration-link" onClick={() => setShowInspiration(true)}>
                  <Sparkles size={19} />
                  <span>
                    灵感小窗<small>故事卡住时，一点新的可能</small>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              )}
            </div>
          )}
          {!isHost && (
            <div className="host-tool-links">
              <button aria-label="本场战斗" onClick={() => setShowEncounter(true)}>
                <Shield size={18} />
                <span>
                  本场战斗<small>公开的行动顺序与角色状态</small>
                </span>
                <ChevronRight size={16} />
              </button>
            </div>
          )}
          <div className="tool-tip">
            <DieIcon size={20} />
            <span>
              骰子给出可能，
              <br />
              你们决定故事。
            </span>
          </div>
        </aside>
      </div>
      {showReview && (
        <ReviewDesk room={room} isHost={isHost} run={run} onClose={() => setShowReview(false)} />
      )}
      {showLibrary && !isHost && (
        <Modal
          title="带一位老朋友入席"
          subtitle={`只展示 ${ruleEdition(room.rule)} 的角色`}
          onClose={() => setShowLibrary(false)}
        >
          <div className="load-library-list">
            {library
              .filter((c) => c.rule === room.rule)
              .map((character) => (
                <button
                  key={character.id}
                  onClick={async () => {
                    if (await run({ type: 'character', character })) {
                      setShowLibrary(false);
                      notify(`「${character.name}」已入席。`);
                    }
                  }}
                >
                  <span className={`character-avatar ${character.rule}`}>
                    {character.name.slice(0, 1)}
                  </span>
                  <span>
                    <b>{character.name}</b>
                    <small>{character.occupation}</small>
                  </span>
                  <Plus size={17} />
                </button>
              ))}
            {!library.some((c) => c.rule === room.rule) && (
              <div className="empty-state">
                <FileText size={30} />
                <p>还没有这套规则的角色。可以创建新角色，或在制卡器中导入文件。</p>
                <button
                  className="button primary"
                  onClick={() => {
                    setShowLibrary(false);
                    onEdit(null);
                  }}
                >
                  创建 / 导入角色
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}
      {focused && (
        <MemberModal
          member={focused}
          me={me}
          room={room}
          onClose={() => setSelectedMember(null)}
          run={run}
        />
      )}
      {showHost && isHost && (
        <HostTools
          room={room}
          run={run}
          onClose={() => setShowHost(false)}
          onOpenLibrary={() => {
            setShowHost(false);
            onHostToolkit();
          }}
        />
      )}
      {showEncounter && !isHost && (
        <Modal
          title="本场战斗"
          subtitle="主持人公布的行动顺序与状态。"
          className="scene-modal"
          onClose={() => setShowEncounter(false)}
        >
          <Suspense
            fallback={
              <div className="toolkit-loading">
                <Spinner />
              </div>
            }
          >
            <EncounterPanel room={room} isHost={false} run={run} />
          </Suspense>
        </Modal>
      )}
      {showInspiration && isHost && (
        <InspirationWindow
          session={session}
          configured={aiConfigured}
          onClose={() => setShowInspiration(false)}
          room={room}
          notify={notify}
        />
      )}
      {leave && (
        <Modal
          title="暂别这张桌子？"
          onClose={() => setLeave(false)}
          footer={
            <>
              <button className="button secondary" onClick={() => setLeave(false)}>
                继续留在这里
              </button>
              <button className="button danger" onClick={() => void run({ type: 'leave' })}>
                离开房间
              </button>
            </>
          }
        >
          <p>
            {isHost
              ? '离开后，会由一位在线玩家接任主持人；如果没有其他在线玩家，房间将关闭。'
              : '离开会释放你的座位。请先导出要保留的角色和记录；故事开始后将无法重新加入。'}
          </p>
          <p className="subtle-note">如果只是暂时离开，直接关闭页面即可，下次打开会自动重连。</p>
        </Modal>
      )}
    </div>
  );
}
function ArmchairIcon() {
  return <Users size={17} />;
}
function Avatar({ member, large = false }: { member: Member; large?: boolean }) {
  return (
    <span
      className={`avatar ${large ? 'large' : ''} ${!member.online ? 'offline' : ''}`}
      style={{ '--avatar-color': member.color } as CSSProperties}
    >
      {member.name.slice(0, 1)}
      {member.role === 'host' && (
        <span className="avatar-crown">
          <Crown size={10} />
        </span>
      )}
    </span>
  );
}
function RoundTable({
  room,
  me,
  onMember,
}: {
  room: Room;
  me: Member;
  onMember: (id: string) => void;
}) {
  const latest = [...room.log].reverse().find((e) => e.roll || e.check);
  const angle = (degrees: number) => ({
    left: `${50 + 40 * Math.cos((degrees * Math.PI) / 180)}%`,
    top: `${50 + 39 * Math.sin((degrees * Math.PI) / 180)}%`,
  });
  const emptyAngles =
    room.members.length === 1 ? [0, 90, 180] : room.members.length === 2 ? [0, 180] : [];
  return (
    <div className="round-table-stage">
      <div className="table-aura" />
      <div className="table-orbit" />
      <div className="glass-table">
        <div className="table-inlay" />
        <div className="table-center">
          {latest ? (
            <>
              <span className="table-result-eyebrow">
                {latest.name} · {latest.check ? latest.check.label : latest.roll?.expression}
              </span>
              <div key={latest.id} className="table-result">
                {latest.check?.total ?? latest.roll?.total}
              </div>
              <span className="table-result-caption">
                {latest.check?.outcome ?? '让命运落定'}
                {latest.visibility === 'host' && ' · 暗骰'}
              </span>
            </>
          ) : (
            <>
              <DieIcon size={54} />
              <span className="table-brand">幕 间</span>
              <span className="table-brand-caption">THE STORY IS OURS</span>
            </>
          )}
        </div>
      </div>
      {room.members.map((member, i) => (
        <button
          key={member.id}
          className={`table-seat ${member.id === me.id ? 'own-seat' : ''}`}
          style={angle(-90 + (360 * i) / room.members.length)}
          onClick={() => onMember(member.id)}
        >
          <Avatar member={member} large />
          <span className="seat-label">
            {member.character?.name || member.name}
            {member.id === me.id && <i>你</i>}
          </span>
          <small className={member.ready ? 'is-ready' : ''}>
            {!member.online
              ? '暂时离线'
              : member.role === 'host'
                ? room.rule === 'dnd'
                  ? 'DM · 主持人'
                  : 'KP · 主持人'
                : member.ready
                  ? '已准备'
                  : '准备中'}
          </small>
        </button>
      ))}
      {emptyAngles.map((deg) => (
        <div key={deg} className="empty-table-seat" style={angle(deg)}>
          <span>
            <Plus size={16} />
          </span>
          <small>虚位以待</small>
        </div>
      ))}
    </div>
  );
}
function ResourceControl({
  label,
  icon,
  value,
  max,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  value: number;
  max?: number;
  onChange?: (value: number) => void;
}) {
  return (
    <div className="resource-control">
      <span>
        {icon}
        {label}
      </span>
      <div>
        {onChange && (
          <button
            className="icon-button"
            aria-label={`减少${label}`}
            onClick={() => onChange(Math.max(0, value - 1))}
            disabled={value <= 0}
          >
            <Minus size={12} />
          </button>
        )}
        <b>
          {value}
          {max !== undefined && <small>/{max}</small>}
        </b>
        {onChange && (
          <button
            className="icon-button"
            aria-label={`增加${label}`}
            onClick={() => onChange(Math.min(max ?? 999, value + 1))}
            disabled={value >= (max ?? 999)}
          >
            <Plus size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

type Run = (action: RoomAction) => Promise<boolean>;
function StoryLog({
  room,
  me,
  run,
  notify,
}: {
  room: Room;
  me: Member;
  run: Run;
  notify: Props['notify'];
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | 'rolls'>('all');
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  useEffect(() => {
    const element = scrollRef.current;
    if (element && atBottom.current) element.scrollTop = element.scrollHeight;
  }, [room.log.length]);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!message.trim() || busy) return;
    setBusy(true);
    if (await run({ type: 'message', content: message.trim() })) setMessage('');
    setBusy(false);
  };
  const log = room.log.filter(
    (event) => filter === 'all' || event.type === 'roll' || event.type === 'check',
  );
  const exportLog = () => {
    const text = `# ${room.name}\n\n规则：${ruleEdition(room.rule)}\n\n${room.log.map((event) => `- ${new Date(event.createdAt).toLocaleString('zh-CN')} · ${event.name}${event.visibility === 'host' ? '（主持人暗骰）' : ''}：${event.content}`).join('\n')}`;
    downloadFile(text, `${room.name}-跑团记录.md`, 'text/markdown');
    notify('已导出当前保留的房间记录（最近 300 条）。');
  };
  return (
    <div className="story-panel panel">
      <div className="story-heading">
        <div className="tabs">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            {room.mode === 'external' ? '桌面记录' : '故事记录'}
          </button>
          <button className={filter === 'rolls' ? 'active' : ''} onClick={() => setFilter('rolls')}>
            骰子记录
          </button>
        </div>
        <button
          className="icon-button"
          onClick={exportLog}
          title="导出最近 300 条记录"
          aria-label="导出房间记录"
        >
          <Download size={16} />
        </button>
      </div>
      {(room.scene.title || room.scene.description) && (
        <div className="current-scene">
          <span className="mini-label">此刻的场景</span>
          <h3>{room.scene.title || '当前场景'}</h3>
          {room.scene.description && <p>{room.scene.description}</p>}
        </div>
      )}
      <div
        className="story-scroll"
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70;
        }}
        role="log"
        aria-label="房间公开记录"
        aria-live="polite"
      >
        {log.length ? (
          log.map((event) => <EventEntry event={event} room={room} key={event.id} />)
        ) : (
          <div className="empty-log">
            <DieIcon size={29} />
            <p>{filter === 'rolls' ? '掷出第一枚骰子，让命运作答。' : '故事将在这里留下痕迹。'}</p>
          </div>
        )}
      </div>
      {room.mode === 'in-room' ? (
        <form className="chat-form" onSubmit={send}>
          <textarea
            aria-label="公开叙事内容"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(e);
              }
            }}
            placeholder={
              room.phase === 'lobby'
                ? '全员准备，故事开始后即可发言…'
                : me.role === 'host'
                  ? '描述眼前的场景，让故事继续…'
                  : '你的角色，会说什么、做什么？'
            }
            disabled={room.phase !== 'active'}
            maxLength={2000}
            rows={2}
          />
          <div className="chat-footer">
            <span>
              <Globe size={12} /> 房间内所有人可见 <span className="enter-hint">· Enter 发送</span>
            </span>
            <button
              type="submit"
              className="send-button"
              disabled={busy || !message.trim() || room.phase !== 'active'}
              aria-label="发送公开消息"
            >
              {busy ? <Spinner /> : <Send size={16} />}
            </button>
          </div>
        </form>
      ) : (
        <div className="external-mode-note">
          <Headphones size={17} />
          <span>你们在外部演绎故事。这里记录骰子与检定，陪伴每一次选择。</span>
        </div>
      )}
    </div>
  );
}
function EventEntry({ event, room }: { event: RoomEvent; room: Room }) {
  if (event.type === 'system')
    return (
      <div className="system-event">
        <span />
        <p>{event.content}</p>
        <span />
      </div>
    );
  const member = room.members.find((m) => m.id === event.memberId);
  return (
    <article className={`log-event ${event.type}`}>
      <span className="log-avatar" style={{ background: member?.color ?? '#bbcbbb' }}>
        {event.name.slice(0, 1)}
      </span>
      <div className="event-body">
        <div className="event-author">
          <b>{event.name}</b>
          {member?.role === 'host' && (
            <span className="host-label">{room.rule === 'dnd' ? 'DM' : 'KP'}</span>
          )}
          <time>
            {new Date(event.createdAt).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </time>
          {event.visibility === 'host' && (
            <span className="private-label">
              <EyeOff size={11} /> 仅主持人
            </span>
          )}
        </div>
        {event.type === 'chat' ? (
          <p className="chat-text">{event.content}</p>
        ) : (
          <div
            className={`roll-event ${event.check ? (event.check.success ? 'success' : 'failure') : ''}`}
          >
            <span className="roll-event-icon">
              {event.check ? <Crosshair size={18} /> : <DieIcon size={24} />}
            </span>
            <div>
              <b>{event.check?.label ?? event.roll?.expression}</b>
              <span>
                {event.check
                  ? `${event.check.rolls.join(' / ')}${event.check.modifier ? ` ${event.check.modifier >= 0 ? '+' : ''}${event.check.modifier}` : ''} · 目标 ${event.check.target} · ${event.check.outcome}`
                  : event.roll?.groups.map((g) => `[${g.rolls.join(', ')}]`).join(' ') +
                    (event.roll?.modifier
                      ? ` ${event.roll.modifier >= 0 ? '+' : ''}${event.roll.modifier}`
                      : '')}
              </span>
            </div>
            <strong>{event.check?.total ?? event.roll?.total}</strong>
          </div>
        )}
      </div>
    </article>
  );
}

function VisibilitySwitch({
  isHost,
  value,
  onChange,
}: {
  isHost: boolean;
  value: Visibility;
  onChange: (v: Visibility) => void;
}) {
  return isHost ? (
    <div className="visibility-switch">
      <button className={value === 'public' ? 'active' : ''} onClick={() => onChange('public')}>
        <Globe size={13} /> 公开
      </button>
      <button className={value === 'host' ? 'active' : ''} onClick={() => onChange('host')}>
        <EyeOff size={13} /> 主持人暗骰
      </button>
    </div>
  ) : (
    <span className="roll-visibility">
      <Globe size={13} /> 结果对全体同伴可见
    </span>
  );
}
function DiceTool({ room, me, run }: { room: Room; me: Member; run: Run }) {
  const [expression, setExpression] = useState(room.rule === 'dnd' ? '1d20' : '1d100');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [rolling, setRolling] = useState(false);
  const latest = [...room.log].reverse().find((e) => e.memberId === me.id && e.roll);
  const roll = async (expr = expression) => {
    if (rolling) return;
    setRolling(true);
    setExpression(expr);
    await run({ type: 'roll', expression: expr, visibility });
    setTimeout(() => setRolling(false), 450);
  };
  return (
    <div className="dice-tool">
      <span className="mini-label">选一颗骰子</span>
      <div className="quick-dice">
        {[4, 6, 8, 10, 12, 20, 100].map((sides) => (
          <button
            key={sides}
            disabled={rolling}
            className={expression === `1d${sides}` ? 'selected' : ''}
            onClick={() => void roll(`1d${sides}`)}
            aria-label={`掷 D${sides}`}
          >
            <DieIcon size={26} />
            <span>D{sides}</span>
          </button>
        ))}
      </div>
      <div className={`dice-result-display ${rolling ? 'is-rolling' : ''}`}>
        <div className="dice-result-ring">
          <DieIcon size={91} />
          <b key={latest?.id}>{rolling ? '·' : (latest?.roll?.total ?? '—')}</b>
        </div>
        <span>
          {rolling
            ? '命运正在转动…'
            : latest?.roll
              ? `${latest.roll.expression} · ${latest.roll.groups.map((g) => g.rolls.join(' + ')).join(' / ')}`
              : '下一次可能，就在手中'}
        </span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void roll();
        }}
      >
        <label className="field dice-input-label">
          自定义掷骰
          <input
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            placeholder="例如：2d6+3"
            maxLength={120}
            aria-label="自定义骰子表达式"
            autoComplete="off"
          />
        </label>
        <span className="subtle-note">支持 2d6+3、1d20、1d8+1d4-2</span>
        <button
          className="button primary full roll-button"
          type="submit"
          disabled={rolling || !expression.trim()}
        >
          <Dices size={18} />
          {rolling ? '掷骰中…' : '让骰子决定'}
        </button>
      </form>
      <VisibilitySwitch isHost={me.role === 'host'} value={visibility} onChange={setVisibility} />
    </div>
  );
}
function CheckTool({ room, me, run }: { room: Room; me: Member; run: Run }) {
  const dnd = room.rule === 'dnd';
  const [kind, setKind] = useState<CheckRequest['kind']>('skill');
  const [key, setKey] = useState(dnd ? 'perception' : 'spotHidden');
  const [dc, setDc] = useState(15);
  const [modifier, setModifier] = useState(0);
  const [target, setTarget] = useState(50);
  const [edge, setEdge] = useState<Edge>('normal');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [busy, setBusy] = useState(false);
  const options =
    kind === 'skill' ? (dnd ? DND_SKILLS : COC_SKILLS) : dnd ? DND_ATTRIBUTES : COC_ATTRIBUTES;
  const card = me.role === 'host' ? null : me.character;
  let preview = modifier;
  if (dnd && card && kind !== 'attack') {
    const attr =
      kind === 'skill' ? (DND_SKILLS.find((s) => s.key === key)?.attribute ?? 'wis') : key;
    preview +=
      kind === 'skill'
        ? dndSkillModifier(card, key)
        : abilityModifier(card.attributes[attr] ?? 10) +
          (kind === 'save' && card.proficiencies.includes(`save:${key}`)
            ? proficiencyBonus(card.level)
            : 0);
  }
  const cocTarget = card
    ? kind === 'sanity'
      ? card.san
      : kind === 'skill'
        ? (card.skills[key] ?? COC_SKILLS.find((skill) => skill.key === key)?.base ?? 0)
        : card.attributes[key]
    : target;
  return (
    <div className="check-tool">
      <label className="field">
        检定类型
        <select
          value={kind}
          onChange={(e) => {
            const v = e.target.value as CheckRequest['kind'];
            setKind(v);
            setKey(v === 'skill' ? (dnd ? 'perception' : 'spotHidden') : 'str');
          }}
        >
          {dnd ? (
            <>
              <option value="skill">技能检定</option>
              <option value="ability">属性检定</option>
              <option value="save">豁免检定</option>
              <option value="attack">攻击检定</option>
            </>
          ) : (
            <>
              <option value="skill">技能检定</option>
              <option value="ability">属性检定</option>
              <option value="sanity">理智检定</option>
            </>
          )}
        </select>
      </label>
      {kind !== 'attack' && kind !== 'sanity' && (
        <label className="field">
          {kind === 'skill' ? '选择技能' : '选择属性'}
          <select value={key} onChange={(e) => setKey(e.target.value)}>
            {options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
                {!dnd && card
                  ? ` · ${kind === 'skill' ? (card.skills[option.key] ?? 0) : card.attributes[option.key]}`
                  : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {dnd ? (
        <div className="form-grid">
          <label className="field">
            {kind === 'attack' ? '目标 AC' : '难度 DC'}
            <input
              type="number"
              min={0}
              max={100}
              value={dc}
              onChange={(e) => setDc(Number(e.target.value))}
            />
          </label>
          <label className="field">
            {kind === 'attack' ? '攻击加值' : !card ? '检定加值' : '临时加值'}
            <input
              type="number"
              min={-100}
              max={100}
              value={modifier}
              onChange={(e) => setModifier(Number(e.target.value))}
            />
          </label>
        </div>
      ) : (
        !card && (
          <label className="field">
            目标百分比
            <input
              type="number"
              min={0}
              max={kind === 'sanity' ? 100 : 100000}
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
            />
            {kind !== 'sanity' && <small>NPC／怪物可超过 100；困难与极难阈值按原值计算。</small>}
          </label>
        )
      )}
      <div className="check-preview">
        <Crosshair size={21} />
        <div>
          <span>
            {dnd ? '本次检定' : kind === 'sanity' ? '当前理智 · 成功目标' : '普通 / 困难 / 极难'}
          </span>
          <b>
            {dnd
              ? `D20 ${preview >= 0 ? '+' : '−'} ${Math.abs(preview)} ≥ ${dc}`
              : kind === 'sanity'
                ? `D100 ≤ ${cocTarget ?? 0}`
                : `${cocTarget ?? 0} / ${Math.floor((cocTarget ?? 0) / 2)} / ${Math.floor((cocTarget ?? 0) / 5)}`}
          </b>
        </div>
      </div>
      {kind !== 'sanity' && (
        <>
          <span className="mini-label">{dnd ? '本次骰况' : '奖励与惩罚骰'}</span>
          <div className="edge-options">
            {(
              [
                ['normal', '正常'],
                ['advantage', dnd ? '优势' : '奖励骰'],
                ['disadvantage', dnd ? '劣势' : '惩罚骰'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={edge === value ? 'selected' : ''}
                onClick={() => setEdge(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
      <button
        className="button primary full"
        disabled={busy || (me.role !== 'host' && !card)}
        onClick={async () => {
          setBusy(true);
          await run({
            type: 'check',
            check: {
              kind,
              key,
              dc,
              modifier,
              edge: kind === 'sanity' ? 'normal' : edge,
              ...(!dnd && !card ? { target } : {}),
            },
            visibility,
          });
          setBusy(false);
        }}
      >
        {busy ? <Spinner /> : <Crosshair size={17} />} 进行检定
      </button>
      <VisibilitySwitch isHost={me.role === 'host'} value={visibility} onChange={setVisibility} />
      <p className="tool-explainer">
        {!card && me.role !== 'host'
          ? '请先创建或载入角色卡。'
          : dnd
            ? kind === 'attack'
              ? '攻击加值请填写完整数值。自然 20 命中，自然 1 失手。'
              : '自动计入角色属性与熟练。普通属性、技能和豁免没有自然 1 / 20 自动成败。'
            : kind === 'sanity'
              ? '普通理智检定只判断成功或失败，不使用奖励／惩罚骰。损失与后续状态由守密人裁定。'
              : '奖励／惩罚骰使用同一个个位骰。返回成功等级后，由守密人依情境裁定。'}
      </p>
    </div>
  );
}
function InventoryTool({ room, me, run }: { room: Room; me: Member; run: Run }) {
  const [targetId, setTargetId] = useState(me.id);
  const member = room.members.find((m) => m.id === targetId) ?? me;
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (
      await run({
        type: 'item-add',
        memberId: member.id,
        item: { id: crypto.randomUUID(), name: name.trim(), quantity, notes: notes.trim() },
      })
    ) {
      setName('');
      setNotes('');
      setQuantity(1);
      setAdding(false);
    }
    setBusy(false);
  };
  return (
    <div className="inventory-tool">
      {me.role === 'host' && (
        <label className="field">
          查看 / 给予物品
          <select value={member.id} onChange={(e) => setTargetId(e.target.value)}>
            {room.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.character ? ` · ${m.character.name}` : ' · 未制卡'}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="inventory-heading">
        <span className="mini-label">
          {member.id === me.id ? '我的行囊' : `${member.name}的行囊`}
        </span>
        <span>{member.character?.items.length ?? 0} 件</span>
      </div>
      {member.character ? (
        <>
          <div className="inventory-items">
            {member.character.items.length ? (
              member.character.items.map((item) => (
                <div className="inventory-item" key={item.id}>
                  <span className="item-icon">
                    <Backpack size={17} />
                  </span>
                  <div>
                    <b>
                      {item.name}
                      <small>× {item.quantity}</small>
                    </b>
                    {item.notes && <p>{item.notes}</p>}
                  </div>
                  <button
                    className="icon-button"
                    onClick={() =>
                      void run({ type: 'item-remove', memberId: member.id, itemId: item.id })
                    }
                    aria-label={`移除${item.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            ) : (
              <div className="empty-state small">
                <Backpack size={33} strokeWidth={1} />
                <p>
                  行囊还是空的，
                  <br />
                  加入一件旅途需要的物品吧。
                </p>
              </div>
            )}
          </div>
          {adding ? (
            <form className="add-item-form" onSubmit={add}>
              <label className="field">
                物品名称
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                  placeholder="例如：旧日记、治疗药水"
                />
              </label>
              <div className="form-grid">
                <label className="field">
                  数量
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    required
                  />
                </label>
                <label className="field">
                  备注
                  <input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    maxLength={200}
                    placeholder="用途 / 效果"
                  />
                </label>
              </div>
              <div className="button-row">
                <button
                  type="button"
                  className="button secondary compact"
                  onClick={() => setAdding(false)}
                >
                  取消
                </button>
                <button className="button primary compact" type="submit" disabled={busy}>
                  {busy ? <Spinner /> : <Plus size={14} />} 放入行囊
                </button>
              </div>
            </form>
          ) : (
            <button className="button secondary full" onClick={() => setAdding(true)}>
              <Plus size={16} /> 添加物品
            </button>
          )}
        </>
      ) : (
        <div className="empty-state small">
          <Backpack size={30} strokeWidth={1} />
          <p>
            载入角色卡后，
            <br />
            就可以整理行囊了。
          </p>
        </div>
      )}
    </div>
  );
}

function MemberModal({
  member,
  me,
  room,
  onClose,
  run,
}: {
  member: Member;
  me: Member;
  room: Room;
  onClose: () => void;
  run: Run;
}) {
  const card = member.character;
  const canEdit = me.id === member.id || me.role === 'host';
  const [confirm, setConfirm] = useState<'kick' | 'transfer-host' | null>(null);
  return (
    <Modal
      title={card?.name ?? member.name}
      subtitle={`${member.name} · ${member.role === 'host' ? hostName(room.rule) : '玩家'}${!member.online ? ' · 离线' : ''}`}
      onClose={onClose}
    >
      <div className="member-detail">
        {card ? (
          <>
            <div className="member-detail-intro">
              <span className={`character-avatar ${card.rule}`}>{card.name.slice(0, 1)}</span>
              <div>
                <h3>{card.occupation}</h3>
                <p>
                  {card.ancestry}{' '}
                  {card.rule === 'dnd' ? `· Lv.${card.level} · AC ${card.ac}` : `· ${card.age} 岁`}
                </p>
              </div>
              <button
                className="icon-button"
                onClick={() =>
                  downloadFile(
                    exportCharacter(card, 'json'),
                    `${card.name}.json`,
                    'application/json',
                  )
                }
                aria-label="导出角色卡"
              >
                <Download size={18} />
              </button>
            </div>
            <div className="detail-resource-grid">
              {(
                ['hp', ...(card.rule === 'coc' ? ['mp', 'san'] : [])] as ('hp' | 'mp' | 'san')[]
              ).map((resource) => (
                <ResourceControl
                  key={resource}
                  label={{ hp: '生命', mp: '魔法', san: '理智' }[resource]}
                  icon={
                    resource === 'hp' ? (
                      <Heart size={14} />
                    ) : resource === 'san' ? (
                      <Brain size={14} />
                    ) : (
                      <WandSparkles size={14} />
                    )
                  }
                  value={card[resource]}
                  max={card[resource === 'hp' ? 'maxHp' : resource === 'mp' ? 'maxMp' : 'maxSan']}
                  onChange={
                    canEdit
                      ? (value) =>
                          void run({ type: 'resource', memberId: member.id, resource, value })
                      : undefined
                  }
                />
              ))}
            </div>
            <div className="detail-attrs">
              {(card.rule === 'dnd' ? DND_ATTRIBUTES : COC_ATTRIBUTES).map((attr) => (
                <div key={attr.key}>
                  <span>{attr.label}</span>
                  <b>{card.attributes[attr.key]}</b>
                </div>
              ))}
            </div>
            <div className="detail-traits">
              {card.traits.map((trait, i) => (
                <p key={i}>
                  <Sparkles size={13} />
                  {trait}
                </p>
              ))}
            </div>
            {card.backstory && (
              <section>
                <h4>人物经历</h4>
                <p className="pre-wrap">{card.backstory}</p>
              </section>
            )}
            {card.notes && (
              <section>
                <h4>角色笔记</h4>
                <p className="pre-wrap">{card.notes}</p>
              </section>
            )}
            <span className="subtle-note">角色卡资料对房间内所有成员可见。</span>
          </>
        ) : (
          <div className="empty-state">
            <FileText size={30} />
            <p>{member.role === 'host' ? '主持人不需要角色卡。' : '这位同伴还在准备角色。'}</p>
          </div>
        )}
        {me.role === 'host' && member.id !== me.id && room.phase === 'lobby' && (
          <div className="member-management">
            {confirm ? (
              <>
                <p>
                  {confirm === 'kick'
                    ? `将「${member.name}」移出房间？`
                    : `将主持人身份移交给「${member.name}」？所有人将重新准备。`}
                </p>
                <div className="button-row">
                  <button className="button secondary compact" onClick={() => setConfirm(null)}>
                    取消
                  </button>
                  <button
                    className="button danger compact"
                    onClick={async () => {
                      if (await run({ type: confirm, memberId: member.id })) onClose();
                    }}
                  >
                    确认{confirm === 'kick' ? '移出' : '移交'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <button
                  className="text-button"
                  onClick={() => setConfirm('transfer-host')}
                  disabled={!member.online}
                >
                  <Crown size={14} /> 移交主持人
                </button>
                <button className="text-button danger-text" onClick={() => setConfirm('kick')}>
                  移出房间
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
function HostTools({
  room,
  run,
  onClose,
  onOpenLibrary,
}: {
  room: Room;
  run: Run;
  onClose: () => void;
  onOpenLibrary: () => void;
}) {
  const [title, setTitle] = useState(room.scene.title);
  const [description, setDescription] = useState(room.scene.description);
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState<'scene' | 'encounter'>('scene');
  return (
    <Modal
      title="场景与回合"
      subtitle="公布此刻的场景，记录每一位参战者。"
      onClose={onClose}
      className="host-modal scene-modal"
    >
      <div className="editor-tabs scene-tabs">
        <button className={section === 'scene' ? 'active' : ''} onClick={() => setSection('scene')}>
          场景设置
        </button>
        <button
          className={section === 'encounter' ? 'active' : ''}
          onClick={() => setSection('encounter')}
        >
          行动与状态{room.encounter.round > 0 ? ` · 第 ${room.encounter.round} 轮` : ''}
        </button>
      </div>
      {section === 'scene' && (
        <>
          <div className="host-section">
            <h3>演出方式</h3>
            <div className="segmented">
              <button
                disabled={room.phase !== 'lobby'}
                className={room.mode === 'in-room' ? 'selected' : ''}
                onClick={() => void run({ type: 'mode', mode: 'in-room' })}
              >
                <MessageSquare size={16} /> 房内演绎
              </button>
              <button
                disabled={room.phase !== 'lobby'}
                className={room.mode === 'external' ? 'selected' : ''}
                onClick={() => void run({ type: 'mode', mode: 'external' })}
              >
                <Headphones size={16} /> 外部演绎
              </button>
            </div>
            <p className="subtle-note">
              {room.phase === 'active'
                ? '返回准备阶段后可以切换演出方式。'
                : '在其他地方语音或线下演绎时，关闭房内叙事，保留骰子与角色工具。'}
            </p>
          </div>
          <form
            className="host-section"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              if (await run({ type: 'scene', title, description })) onClose();
              setBusy(false);
            }}
          >
            <h3>当前场景</h3>
            <label className="field">
              场景名称
              <input
                value={title}
                maxLength={100}
                placeholder="例如：雨夜里的旧宅"
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="field">
              场景描述
              <textarea
                value={description}
                maxLength={4000}
                rows={4}
                placeholder="把此刻所有人都能看见的场景写在这里。"
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <button className="button primary" type="submit" disabled={busy}>
              {busy ? <Spinner /> : <Check size={16} />} 公布场景
            </button>
          </form>
          <button className="scene-encounter-link" onClick={() => setSection('encounter')}>
            <Shield size={23} strokeWidth={1.4} />
            <span>
              <b>前往行动与状态</b>
              <small>加入 NPC／怪物，排定顺序，记录本场变化。</small>
            </span>
            <ChevronRight size={18} />
          </button>
        </>
      )}
      {section === 'encounter' && (
        <Suspense
          fallback={
            <div className="toolkit-loading">
              <Spinner />
            </div>
          }
        >
          <EncounterPanel room={room} isHost run={run} onOpenLibrary={onOpenLibrary} />
        </Suspense>
      )}
    </Modal>
  );
}
function InspirationWindow({
  session,
  configured,
  onClose,
  room,
  notify,
}: {
  session: Session;
  configured: boolean;
  onClose: () => void;
  room: Room;
  notify: Props['notify'];
}) {
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<Inspiration | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generate = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setResult(await getInspiration(session, prompt.trim()));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="给故事，留一扇窗。"
      subtitle="灵感小窗 · 仅主持人可见"
      onClose={onClose}
      className="inspiration-modal"
    >
      <div className="inspiration-intro">
        <span className="inspiration-orb">
          <Sparkles size={28} strokeWidth={1.1} />
        </span>
        <p>
          不必急着找到完美的下一句。
          <br />
          让一个意外、一条线索，带故事走远一点。
        </p>
      </div>
      <div className="context-chip">
        <FileText size={13} /> 将参考当前场景与最近的公开叙事
      </div>
      <form onSubmit={generate}>
        <label className="field">
          故事卡在哪里？
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例如：玩家一直没有注意到线索，想用一个自然的事件推动剧情…"
            maxLength={1500}
            rows={3}
            required
          />
        </label>
        {!configured && (
          <div className="ai-status">
            <Sparkles size={16} />
            <div>
              <b>Gemini 尚未连接</b>
              <p>
                请在服务端配置 GEMINI_API_KEY 后重启服务。配置完成后，即可在这里获得剧情建议与示例。
              </p>
            </div>
          </div>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button primary full"
          type="submit"
          disabled={busy || !configured || !prompt.trim()}
        >
          {busy ? <Spinner /> : <Sparkles size={17} />}
          {busy ? '正在寻找下一种可能…' : result ? '再给我一点灵感' : '寻找一点灵感'}
        </button>
      </form>
      {result && (
        <div className="inspiration-result">
          <section>
            <span className="mini-label">一段剧情建议</span>
            <p>{result.suggestion}</p>
          </section>
          <section className="example">
            <span className="mini-label">可以这样讲</span>
            <p>{result.example}</p>
            <button
              className="text-button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(result.example);
                  notify('示例已复制，可以按你的想法改写后发出。');
                } catch {
                  setError('复制失败，请手动选择示例文字。');
                }
              }}
            >
              <Copy size={14} /> 复制示例
            </button>
          </section>
        </div>
      )}
      <p className="inspiration-footnote">
        <EyeOff size={13} /> 建议保留在这里，不会自动公开给玩家。
        <br />
        <span>点击生成会将场景、角色名与最近的公开记录发送至 Gemini。</span>
      </p>
    </Modal>
  );
}
