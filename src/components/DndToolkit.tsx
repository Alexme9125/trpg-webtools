import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  ClipboardCheck,
  EyeOff,
  FolderOpen,
  RefreshCw,
  Shield,
  Skull,
  Sparkles,
  Users,
} from 'lucide-react';
import type { Room, RoomAction } from '../../shared/types';
import { duplicateDndStatBlock, type DndStatBlock } from '../../shared/dnd';
import { getDndLibrary, removeDndStatBlock, saveDndStatBlocks } from '../dnd-storage';
import { DndWorkshop } from './DndWorkshop';
import { DndImportGuide } from './DndImportGuide';
import { Spinner } from './ui';

export function DndToolkit({
  room,
  isHost,
  onAction,
  onReturnRoom,
  onReview,
}: {
  room: Room | null;
  isHost: boolean;
  onAction: (action: RoomAction) => Promise<void>;
  onReturnRoom: () => void;
  onReview: () => void;
}) {
  const [cards, setCards] = useState<DndStatBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [workshop, setWorkshop] = useState<{
    scope: 'personal' | 'room';
    kind?: 'npc' | 'monster';
  } | null>(null);
  const [guide, setGuide] = useState(false);
  const guideRef = useRef<HTMLDivElement>(null);
  const dndRoom = isHost && room?.rule === 'dnd' ? room : null;
  const load = async () => {
    setLoading(true);
    try {
      setCards(await getDndLibrary());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    const refresh = () => {
      if (!workshop && document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [workshop]);
  useEffect(() => {
    if (guide)
      guideRef.current?.scrollIntoView({
        block: 'start',
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      });
  }, [guide]);
  const open = async (kind?: 'npc' | 'monster') => {
    try {
      setCards(await getDndLibrary());
      setError('');
      setWorkshop({ scope: 'personal', kind });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const toRoom = async (next: DndStatBlock[]) => {
    if (!dndRoom) throw new Error('请先以 DM 身份进入 D&D 房间。');
    if (dndRoom.dndCards.length + next.length > 200)
      throw new Error('房间数据块库最多 200 张，请分批整理。');
    const copies = next.map((c) => duplicateDndStatBlock(c, c.name));
    if (new Blob([JSON.stringify(copies)]).size > 8 * 1024 * 1024 - 2048)
      throw new Error('本批资料过大，请分批带入。');
    await onAction({ type: 'dnd-save', cards: copies });
  };
  const toPersonal = async (next: DndStatBlock[]) => {
    setCards(await saveDndStatBlocks(next.map((c) => duplicateDndStatBlock(c, c.name))));
  };
  return (
    <>
      {error && (
        <div className="inline-error toolkit-error" role="alert">
          <span>{error}</span>
          <button className="text-button" onClick={() => void load()}>
            <RefreshCw size={14} />
            重新读取
          </button>
        </div>
      )}
      <div className="toolkit-shelves">
        <section className="toolkit-library panel">
          <div className="toolkit-shelf-heading">
            <span className="toolkit-icon">
              <Shield size={24} strokeWidth={1.4} />
            </span>
            <span className="mini-label">D&D 5E · 2014 / SRD 5.1</span>
            <span className="toolkit-count">{loading ? '读取中' : `${cards.length} / 200`}</span>
          </div>
          <h2>NPC 与怪物数据块</h2>
          <p>从一名城门守卫，到盘踞山谷的巨龙。先整理资料，再让它们走进故事。</p>
          <div className="toolkit-preview" aria-label="D&D 个人数据块摘要">
            {cards.length ? (
              cards.slice(0, 3).map((c) => (
                <div key={c.id}>
                  <span className={`keeper-card-icon ${c.kind}`}>
                    {c.kind === 'npc' ? <Users size={17} /> : <Skull size={17} />}
                  </span>
                  <div>
                    <b>{c.name}</b>
                    <small>
                      {c.creatureType || (c.kind === 'npc' ? 'NPC' : '怪物')} · CR{' '}
                      {c.challenge || '—'} · AC {c.ac ?? '—'}
                    </small>
                  </div>
                </div>
              ))
            ) : (
              <div className="toolkit-preview-empty">
                <span>等待相遇的面孔</span>
                <small>创建空白数据块、使用原创示例，或导入外部剧本资料。</small>
              </div>
            )}
          </div>
          <div className="toolkit-library-actions">
            <button
              className="button primary"
              disabled={loading || !!error}
              onClick={() => void open()}
            >
              {loading ? <Spinner /> : <FolderOpen size={17} />}打开个人数据块库
              <ArrowRight size={16} />
            </button>
            <button
              className="text-button"
              disabled={loading || !!error}
              onClick={() => void open('npc')}
            >
              <Users size={15} />
              新建 NPC
            </button>
            <button
              className="text-button"
              disabled={loading || !!error}
              onClick={() => void open('monster')}
            >
              <Skull size={15} />
              新建怪物
            </button>
          </div>
          <div className="toolkit-storage-note">
            <EyeOff size={13} />
            仅保存在此浏览器；导出文件可备份或换设备使用。
          </div>
        </section>
        <section className="toolkit-guide-card panel">
          <div className="toolkit-shelf-heading">
            <span className="toolkit-icon">
              <BookOpen size={24} strokeWidth={1.4} />
            </span>
            <span className="mini-label">SCRIPT TO STAT BLOCKS</span>
          </div>
          <h2>利用AI从剧本中提取数据块</h2>
          <p>提取原文的属性、攻击、法术与特殊能力；保留来源和待确认的信息。</p>
          <ol className="toolkit-import-steps">
            <li>
              <span>01</span>
              <div>
                <b>复制提示词</b>
                <small>明确 2014 版规则与提取范围</small>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <b>导入并核对</b>
                <small>AC、HP、骰式与能力分开记录</small>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <b>生成参战个体</b>
                <small>同一模板，各自记录状态与次数</small>
              </div>
            </li>
          </ol>
          <button className="button secondary" onClick={() => setGuide(true)}>
            <Sparkles size={16} />
            提取提示词、模板与教程
            <ArrowRight size={15} />
          </button>
        </section>
      </div>
      {room ? (
        <section className="toolkit-room panel">
          <div>
            <span className="mini-label">AT THIS TABLE</span>
            <h2>{room.name}</h2>
            <p>
              {dndRoom
                ? '个人原稿、房间资料与本场个体分别保存。'
                : room.rule === 'coc'
                  ? '当前为 CoC 房间。D&D 资料可继续在个人库备团。'
                  : '你当前以玩家身份入席，个人备团库仍可使用。'}
            </p>
          </div>
          <div className="toolkit-room-actions">
            {isHost && (
              <button className="button secondary compact" onClick={onReview}>
                <ClipboardCheck size={16} />
                审核与制卡要求
              </button>
            )}
            {dndRoom && (
              <button
                className="button primary compact"
                onClick={() => setWorkshop({ scope: 'room' })}
              >
                <FolderOpen size={16} />
                房间 D&D 数据块库<span>{dndRoom.dndCards.length}</span>
              </button>
            )}
            <button className="text-button" onClick={onReturnRoom}>
              返回房间
              <ArrowRight size={16} />
            </button>
          </div>
        </section>
      ) : (
        <div className="toolkit-offline-note">
          <EyeOff size={16} />
          <p>现在即可制作并保存。以 DM 身份进入 D&D 房间后，可将资料带入本桌。</p>
        </div>
      )}
      {guide && (
        <div ref={guideRef} className="toolkit-full-guide panel">
          <DndImportGuide />
        </div>
      )}
      {workshop?.scope === 'personal' && (
        <DndWorkshop
          library={cards}
          scope="personal"
          initialKind={workshop.kind}
          onSave={async (next) => setCards(await saveDndStatBlocks(next))}
          onDelete={async (id) => setCards(await removeDndStatBlock(id))}
          onTransfer={dndRoom ? toRoom : undefined}
          onClose={() => setWorkshop(null)}
        />
      )}
      {workshop?.scope === 'room' && dndRoom && (
        <DndWorkshop
          library={dndRoom.dndCards}
          scope="room"
          onSave={async (cards) => onAction({ type: 'dnd-save', cards })}
          onDelete={async (cardId) => onAction({ type: 'dnd-delete', cardId })}
          onTransfer={toPersonal}
          onClose={() => setWorkshop(null)}
        />
      )}
    </>
  );
}
