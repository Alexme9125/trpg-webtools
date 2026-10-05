import { useEffect, useState } from 'react';
import { ArrowRight, EyeOff, FolderOpen, Map, Sparkles } from 'lucide-react';
import type { Room, RoomAction } from '../../shared/types';
import { duplicateAtlas, type Atlas } from '../../shared/atlas';
import { getAtlasLibrary, saveAtlases, removeAtlas } from '../atlas-storage';
import { AtlasWorkshop } from './AtlasWorkshop';
import { AtlasImportGuide } from './AtlasImportGuide';
import { Spinner } from './ui';

export function RoomAtlasLibrary({
  room,
  onAction,
  onClose,
}: {
  room: Room;
  onAction: (action: RoomAction) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <AtlasWorkshop
      library={room.atlases}
      scope="room"
      onSave={(atlases) => onAction({ type: 'atlas-save', atlases })}
      onDelete={(atlasId) => onAction({ type: 'atlas-delete', atlasId })}
      onTransfer={(items) => saveAtlases(items.map(duplicateAtlas))}
      onPublish={(atlasId, sceneId) => onAction({ type: 'atlas-publish', atlasId, sceneId })}
      onClose={onClose}
    />
  );
}
export function AtlasToolkit({
  room,
  isHost,
  onAction,
}: {
  room: Room | null;
  isHost: boolean;
  onAction: (action: RoomAction) => Promise<void>;
}) {
  const [items, setItems] = useState<Atlas[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scope, setScope] = useState<'personal' | 'room' | null>(null);
  const [guide, setGuide] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      setItems(await getAtlasLibrary());
      setError('');
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      {error && (
        <p className="inline-error" role="alert">
          {error}{' '}
          <button className="text-button" onClick={() => void load()}>
            重新读取地图集
          </button>
        </p>
      )}
      <div className="toolkit-shelves atlas-shelves">
        <section className="toolkit-library panel">
          <div className="toolkit-shelf-heading">
            <span className="toolkit-icon">
              <Map size={25} strokeWidth={1.4} />
            </span>
            <span className="mini-label">MAPS & SCENES</span>
            <span className="toolkit-count">{loading ? '读取中' : `${items.length} / 50`}</span>
          </div>
          <h2>地图册与场景集</h2>
          <p>把地点布局、场景描述和主持人笔记整理在一起，开团时逐幕取用。</p>
          <div className="atlas-shelf-preview">
            {items.length ? (
              items.slice(0, 3).map((a) => (
                <div key={a.id}>
                  <Map size={20} />
                  <span>
                    <b>{a.name}</b>
                    <small>
                      {a.maps.length} 张地图 · {a.scenes.length} 个场景
                    </small>
                  </span>
                </div>
              ))
            ) : (
              <div>
                <Map size={40} strokeWidth={1} />
                <span>
                  <b>地点之间，故事正在发生。</b>
                  <small>多张地图、多个场景，也容得下一条未解的线索。</small>
                </span>
              </div>
            )}
          </div>
          <div className="toolkit-library-actions">
            <button
              className="button primary"
              disabled={loading}
              onClick={async () => {
                if (await load()) setScope('personal');
              }}
            >
              {loading ? <Spinner /> : <FolderOpen size={17} />}打开个人地图集
              <ArrowRight size={16} />
            </button>
            {isHost && room && (
              <button className="button secondary" onClick={() => setScope('room')}>
                房间地图集 · {room.atlases.length}
              </button>
            )}
          </div>
          <div className="toolkit-storage-note">
            <EyeOff size={13} />
            个人原稿保存在此浏览器，带入房间时生成独立副本。
          </div>
        </section>
        <section className="toolkit-guide-card panel">
          <div className="toolkit-shelf-heading">
            <span className="toolkit-icon">
              <Sparkles size={25} strokeWidth={1.4} />
            </span>
            <span className="mini-label">SCRIPT TO SCENES</span>
          </div>
          <h2>利用 AI 从剧本中提取地图与场景</h2>
          <p>让外部 AI Agent 按模板整理剧本。一个地图可包含多个场景，秘密和公开描述各归其位。</p>
          <ol className="toolkit-import-steps">
            {[
              ['提供剧本', '复制提示词，指定章节与提取范围'],
              ['核对资料', '导入 Markdown，检查地点、公开描述与笔记'],
              ['逐幕公布', '带入房间，选择此刻需要的场景'],
            ].map(([title, body], i) => (
              <li key={title}>
                <span>{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <b>{title}</b>
                  <small>{body}</small>
                </div>
              </li>
            ))}
          </ol>
          <button className="button secondary" onClick={() => setGuide(!guide)}>
            <Sparkles size={16} />
            提取提示词、模板与教程
            <ArrowRight size={15} />
          </button>
        </section>
      </div>
      {guide && (
        <div className="toolkit-full-guide panel">
          <AtlasImportGuide />
        </div>
      )}
      {scope === 'personal' && (
        <AtlasWorkshop
          scope="personal"
          library={items}
          onSave={async (next) => setItems(await saveAtlases(next))}
          onDelete={async (id) => setItems(await removeAtlas(id))}
          onTransfer={
            isHost && room
              ? async (next) => {
                  if (next.some((a) => a.rule !== 'any' && a.rule !== room.rule))
                    throw new Error('地图册规则与当前房间不匹配。');
                  await onAction({ type: 'atlas-save', atlases: next.map(duplicateAtlas) });
                }
              : undefined
          }
          onClose={() => setScope(null)}
        />
      )}
      {scope === 'room' && isHost && room && (
        <RoomAtlasLibrary
          room={room}
          onAction={onAction}
          onClose={() => {
            setScope(null);
            void load();
          }}
        />
      )}
    </>
  );
}
