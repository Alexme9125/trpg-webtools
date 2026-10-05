import { useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Check,
  Copy,
  Download,
  EyeOff,
  Map,
  Plus,
  Search,
  Send,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  AtlasSchema,
  createAtlas,
  duplicateAtlas,
  exportAtlases,
  parseAtlases,
  MAX_ATLAS_BYTES,
  type Atlas,
  type AtlasMap,
  type AtlasScene,
} from '../../shared/atlas';
import { downloadFile } from '../storage';
import { Modal, Spinner } from './ui';
import { AtlasImportGuide } from './AtlasImportGuide';

type Selection = { kind: 'overview' } | { kind: 'map' | 'scene'; id: string };
export function AtlasWorkshop({
  library,
  scope,
  onSave,
  onDelete,
  onTransfer,
  onPublish,
  onClose,
}: {
  library: Atlas[];
  scope: 'personal' | 'room';
  onSave: (items: Atlas[]) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  onTransfer?: (items: Atlas[]) => Promise<unknown>;
  onPublish?: (atlasId: string, sceneId: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Atlas | null>(null);
  const [selection, setSelection] = useState<Selection>({ kind: 'overview' });
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [guide, setGuide] = useState(false);
  const [incoming, setIncoming] = useState<Atlas[] | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const confirmDiscard = () => !dirty || window.confirm('这本地图册有未保存的修改，确定放弃吗？');
  const operate = async (work: () => Promise<unknown>, message: string) => {
    if (busy) return false;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await work();
      setSuccess(message);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const open = (atlas: Atlas, isNew = false) => {
    if (!confirmDiscard()) return;
    setDraft(structuredClone(atlas));
    setSelection({ kind: 'overview' });
    setFilter('all');
    setSearch('');
    setDirty(isNew);
    setGuide(false);
    setError('');
    setSuccess('');
  };
  const patch = (next: Partial<Atlas>) => {
    if (draft) {
      setDraft({ ...draft, ...next });
      setDirty(true);
      setSuccess('');
    }
  };
  const selectedScene =
    selection.kind === 'scene' ? draft?.scenes.find((s) => s.id === selection.id) : undefined;
  const selectedMap =
    selection.kind === 'map' ? draft?.maps.find((m) => m.id === selection.id) : undefined;
  const patchScene = (next: Partial<AtlasScene>) =>
    patch({
      scenes: draft!.scenes.map((s) => (s.id === selectedScene?.id ? { ...s, ...next } : s)),
    });
  const patchMap = (next: Partial<AtlasMap>) =>
    patch({ maps: draft!.maps.map((m) => (m.id === selectedMap?.id ? { ...m, ...next } : m)) });
  const save = async () => {
    const result = AtlasSchema.safeParse({ ...draft, updatedAt: new Date().toISOString() });
    if (!result.success) {
      setError(`请检查地图册：${result.error.issues[0]?.message}`);
      return;
    }
    if (await operate(() => onSave([result.data]), '地图册已保存。')) {
      setDraft(result.data);
      setDirty(false);
    }
  };
  const importFile = async (picked?: File) => {
    if (!picked) return;
    try {
      if (picked.size > MAX_ATLAS_BYTES) throw new Error('文件不能超过 8 MiB，请分批导入。');
      const parsed = parseAtlases(await picked.text());
      setIncoming(parsed);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (file.current) file.current.value = '';
    }
  };
  const addScene = () => {
    const s: AtlasScene = {
      id: crypto.randomUUID(),
      mapId: filter !== 'all' && filter !== 'independent' ? filter : null,
      title: '未命名场景',
      description: '',
      keeperNotes: '',
      source: '',
      tags: [],
    };
    patch({ scenes: [...draft!.scenes, s] });
    setSelection({ kind: 'scene', id: s.id });
    setSearch('');
  };
  return (
    <Modal
      title={scope === 'personal' ? '个人地图集' : '房间地图与场景'}
      subtitle={
        scope === 'personal'
          ? '整理地点与场景，准备每一次相遇。'
          : '选择场景，核对公开描述，再公布给同桌。'
      }
      className="atlas-modal"
      onClose={() => {
        if (!busy && confirmDiscard()) onClose();
      }}
    >
      <div className="atlas-toolbar">
        {draft && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              if (confirmDiscard()) {
                setDraft(null);
                setDirty(false);
              }
            }}
          >
            <ArrowLeft size={15} />
            全部地图册
          </button>
        )}
        <button
          className="button primary compact"
          disabled={busy || library.length >= 50}
          onClick={() => open(createAtlas(), true)}
        >
          <Plus size={16} />
          新建地图册
        </button>
        <button
          className="button secondary compact"
          disabled={busy}
          onClick={() => file.current?.click()}
        >
          <Upload size={15} />
          导入地图集
        </button>
        <button
          className="text-button"
          disabled={busy || !library.length}
          onClick={() =>
            downloadFile(exportAtlases(library, 'json'), '幕间-地图集.json', 'application/json')
          }
        >
          <Download size={15} />
          导出全部地图册
        </button>
        <button className="text-button" onClick={() => setGuide(!guide)} aria-expanded={guide}>
          <BookOpen size={15} />
          地图提取教程
        </button>
        <input
          ref={file}
          className="visually-hidden"
          type="file"
          accept=".json,.md,.markdown"
          aria-label="导入地图集文件"
          onChange={(e) => void importFile(e.target.files?.[0])}
        />
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="atlas-success" role="status">
          <Check size={16} />
          {success}
        </p>
      )}
      {incoming && (
        <section className="atlas-import-preview" aria-label="地图导入预览">
          <h3>待导入 {incoming.length} 本地图册</h3>
          <p>
            {incoming
              .map((a) => `${a.name}（${a.maps.length} 张地图 · ${a.scenes.length} 个场景）`)
              .join('；')}
          </p>
          <p className="subtle-note">作为独立副本添加。请导入后核对公开描述与主持人笔记。</p>
          <div className="button-row">
            <button
              className="button primary compact"
              disabled={busy}
              onClick={() =>
                void operate(async () => {
                  await onSave(incoming.map(duplicateAtlas));
                  setIncoming(null);
                }, '地图集已导入。')
              }
            >
              确认导入地图集
            </button>
            <button className="text-button" disabled={busy} onClick={() => setIncoming(null)}>
              取消导入
            </button>
          </div>
        </section>
      )}
      {guide && <AtlasImportGuide />}
      {!draft ? (
        <>
          <div className="atlas-library-heading">
            <span className="mini-label">
              {scope === 'personal' ? 'PERSONAL ATLAS' : 'AT THIS TABLE'}
            </span>
            <span>{library.length} / 50 本</span>
          </div>
          {library.length ? (
            <div className="atlas-library-grid">
              {library.map((a) => (
                <button
                  key={a.id}
                  className="atlas-book"
                  aria-label={`打开地图册：${a.name}`}
                  onClick={() => open(a)}
                >
                  <Map size={30} strokeWidth={1.3} />
                  <span className="atlas-book-count">
                    {a.maps.length} 张地图 · {a.scenes.length} 个场景
                  </span>
                  <h3>{a.name}</h3>
                  <p>{a.summary || '打开地图册，继续整理这段故事。'}</p>
                  <small>
                    {a.rule === 'any' ? '通用资料' : a.rule === 'coc' ? 'CoC 7' : 'D&D 5e · 2014'}
                  </small>
                </button>
              ))}
            </div>
          ) : (
            <div className="atlas-empty">
              <Map size={44} strokeWidth={1} />
              <h3>为下一幕，记下一处地点。</h3>
              <p>手动创建地图册，或使用提取模板导入多个地图和场景。</p>
            </div>
          )}
          <p className="subtle-note">
            <EyeOff size={13} />{' '}
            {scope === 'personal'
              ? '保存在此浏览器。导出地图集可备份或换设备使用。'
              : '资料与笔记仅当前主持人可见，公布的场景描述对全房间可见。'}
          </p>
        </>
      ) : (
        <>
          <div className="atlas-document-heading">
            <div>
              <span className="mini-label">{dirty ? '尚有未保存的修改' : '已保存的资料'}</span>
              <h2>{draft.name || '未命名地图册'}</h2>
            </div>
            <div className="button-row">
              <button
                className="button primary compact"
                disabled={busy}
                onClick={() => void save()}
              >
                {busy ? <Spinner /> : <Check size={16} />}保存地图册
              </button>
              {onTransfer && (
                <button
                  className="button secondary compact"
                  disabled={busy || dirty}
                  onClick={() =>
                    void operate(
                      () => onTransfer([draft]),
                      scope === 'personal'
                        ? '已作为独立副本带入房间。'
                        : '已作为独立副本存入个人地图集。',
                    )
                  }
                >
                  <Copy size={16} />
                  {scope === 'personal' ? '带入房间' : '存入个人地图集'}
                </button>
              )}
            </div>
          </div>
          <div className="atlas-workspace">
            <aside className="atlas-index" aria-label="地图与场景目录">
              <button
                className={
                  selection.kind === 'overview'
                    ? 'selected atlas-index-overview'
                    : 'atlas-index-overview'
                }
                onClick={() => setSelection({ kind: 'overview' })}
              >
                <BookOpen size={16} />
                地图册资料
              </button>
              <label className="atlas-search">
                <Search size={15} />
                <input
                  aria-label="搜索地图与场景"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索场景或标签"
                />
              </label>
              <label className="field">
                场景筛选
                <select
                  aria-label="按地图筛选场景"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">全部场景</option>
                  <option value="independent">独立场景</option>
                  {draft.maps.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name || '未命名地图'}
                    </option>
                  ))}
                </select>
              </label>
              <div className="atlas-index-heading">
                <b>地图</b>
                <button
                  className="text-button"
                  disabled={draft.maps.length >= 50 || busy}
                  onClick={() => {
                    const m: AtlasMap = {
                      id: crypto.randomUUID(),
                      name: '未命名地图',
                      description: '',
                      keeperNotes: '',
                    };
                    patch({ maps: [...draft.maps, m] });
                    setSelection({ kind: 'map', id: m.id });
                    setFilter(m.id);
                  }}
                >
                  <Plus size={14} />
                  添加地图
                </button>
              </div>
              {draft.maps.map((m) => (
                <button
                  key={m.id}
                  className={selectedMap?.id === m.id ? 'selected' : ''}
                  aria-label={`查看地图：${m.name}`}
                  onClick={() => {
                    setSelection({ kind: 'map', id: m.id });
                    setFilter(m.id);
                  }}
                >
                  <Map size={14} />
                  <span>{m.name || '未命名地图'}</span>
                  <small>{draft.scenes.filter((s) => s.mapId === m.id).length}</small>
                </button>
              ))}
              <div className="atlas-index-heading">
                <b>场景 · {draft.scenes.length}</b>
                <button
                  className="text-button"
                  disabled={draft.scenes.length >= 300 || busy}
                  onClick={addScene}
                >
                  <Plus size={14} />
                  添加场景
                </button>
              </div>
              <div className="atlas-scene-list">
                {draft.scenes
                  .filter(
                    (s) =>
                      (filter === 'all' ||
                        (filter === 'independent' ? s.mapId === null : s.mapId === filter)) &&
                      `${s.title} ${s.tags.join(' ')} ${s.description}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                  )
                  .map((s, index) => (
                    <button
                      key={s.id}
                      className={selectedScene?.id === s.id ? 'selected' : ''}
                      aria-label={`查看场景：${s.title}`}
                      onClick={() => setSelection({ kind: 'scene', id: s.id })}
                    >
                      <span className="atlas-scene-number">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span>{s.title || '未命名场景'}</span>
                    </button>
                  ))}
              </div>
            </aside>
            <fieldset className="atlas-editor" aria-label="地图集编辑区" disabled={busy}>
              {selection.kind === 'overview' && (
                <>
                  <span className="mini-label">ATLAS DETAILS</span>
                  <h3>地图册资料</h3>
                  <label className="field">
                    地图册名称
                    <input
                      value={draft.name}
                      maxLength={100}
                      onChange={(e) => patch({ name: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    适用规则
                    <select
                      value={draft.rule}
                      onChange={(e) => patch({ rule: e.target.value as Atlas['rule'] })}
                    >
                      <option value="any">通用</option>
                      <option value="coc">CoC 7</option>
                      <option value="dnd">D&D 5e · 2014</option>
                    </select>
                  </label>
                  <label className="field">
                    地图册简介
                    <textarea
                      value={draft.summary}
                      maxLength={4000}
                      rows={3}
                      onChange={(e) => patch({ summary: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    剧本与来源
                    <textarea
                      value={draft.source}
                      maxLength={2000}
                      rows={2}
                      onChange={(e) => patch({ source: e.target.value })}
                    />
                  </label>
                  <p className="subtle-note">从左侧添加地图和场景。独立场景可以不关联地图。</p>
                </>
              )}
              {selectedMap && (
                <>
                  <span className="mini-label">LOCATION & ROUTES</span>
                  <h3>地点布局</h3>
                  <label className="field">
                    地图名称
                    <input
                      value={selectedMap.name}
                      maxLength={100}
                      onChange={(e) => patchMap({ name: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    地图描述
                    <textarea
                      value={selectedMap.description}
                      maxLength={4000}
                      rows={6}
                      onChange={(e) => patchMap({ description: e.target.value })}
                      placeholder="地形、出入口、相邻地点与路线…"
                    />
                  </label>
                  <label className="field atlas-private-field">
                    <span>
                      <EyeOff size={15} />
                      地图主持人笔记
                    </span>
                    <textarea
                      value={selectedMap.keeperNotes}
                      maxLength={8000}
                      rows={4}
                      onChange={(e) => patchMap({ keeperNotes: e.target.value })}
                    />
                  </label>
                  <button
                    className="text-button danger-text"
                    onClick={() => {
                      if (window.confirm('移除此地图？关联场景将保留为独立场景。')) {
                        patch({
                          maps: draft.maps.filter((m) => m.id !== selectedMap.id),
                          scenes: draft.scenes.map((s) =>
                            s.mapId === selectedMap.id ? { ...s, mapId: null } : s,
                          ),
                        });
                        setSelection({ kind: 'overview' });
                        setFilter('all');
                      }
                    }}
                  >
                    <Trash2 size={15} />
                    移除此地图
                  </button>
                </>
              )}
              {selectedScene && (
                <>
                  <span className="mini-label">
                    SCENE {String(draft.scenes.indexOf(selectedScene) + 1).padStart(2, '0')}
                  </span>
                  <label className="field">
                    场景标题
                    <input
                      value={selectedScene.title}
                      maxLength={100}
                      onChange={(e) => patchScene({ title: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    场景所属地图
                    <select
                      value={selectedScene.mapId ?? ''}
                      onChange={(e) => patchScene({ mapId: e.target.value || null })}
                    >
                      <option value="">独立场景</option>
                      {draft.maps.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    公开场景描述
                    <textarea
                      value={selectedScene.description}
                      maxLength={4000}
                      rows={5}
                      onChange={(e) => patchScene({ description: e.target.value })}
                      placeholder="所有参与者能看见、听见或获知的内容。"
                    />
                  </label>
                  <label className="field atlas-private-field">
                    <span>
                      <EyeOff size={15} />
                      场景主持人笔记
                    </span>
                    <textarea
                      value={selectedScene.keeperNotes}
                      maxLength={8000}
                      rows={4}
                      onChange={(e) => patchScene({ keeperNotes: e.target.value })}
                      placeholder="隐藏线索、幕后真相、检定条件与分支。"
                    />
                    <small>只留在主持人的地图集里，公布场景不会发送这些笔记。</small>
                  </label>
                  <div className="form-grid">
                    <label className="field">
                      场景来源
                      <input
                        value={selectedScene.source}
                        maxLength={2000}
                        onChange={(e) => patchScene({ source: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      场景标签（逗号分隔）
                      <input
                        key={selectedScene.id}
                        defaultValue={selectedScene.tags.join('，')}
                        maxLength={490}
                        onBlur={(e) =>
                          patchScene({
                            tags: e.target.value
                              .split(/[,，]/)
                              .map((t) => t.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </label>
                  </div>
                  {onPublish && (
                    <div className="atlas-publish">
                      <div>
                        <b>公布预览</b>
                        <h3>{selectedScene.title}</h3>
                        <p>{selectedScene.description || '只有场景标题，没有公开描述。'}</p>
                      </div>
                      <button
                        className="button primary"
                        disabled={busy || dirty}
                        onClick={() =>
                          void operate(
                            () => onPublish(draft.id, selectedScene.id),
                            '场景已公布，主持人笔记仍保持私密。',
                          )
                        }
                      >
                        <Send size={16} />
                        公布此场景
                      </button>
                      {dirty && <small>请先保存修改，再公布场景。</small>}
                    </div>
                  )}
                  <button
                    className="text-button danger-text"
                    onClick={() => {
                      if (window.confirm('移除此场景？保存地图册后生效。')) {
                        patch({ scenes: draft.scenes.filter((s) => s.id !== selectedScene.id) });
                        setSelection({ kind: 'overview' });
                      }
                    }}
                  >
                    <Trash2 size={15} />
                    移除此场景
                  </button>
                </>
              )}
            </fieldset>
          </div>
          <div className="atlas-document-footer">
            <div className="button-row">
              {(['json', 'md'] as const).map((format) => (
                <button
                  key={format}
                  className="text-button"
                  disabled={dirty || busy}
                  onClick={() =>
                    downloadFile(
                      exportAtlases([draft], format),
                      `${draft.name}.${format}`,
                      format === 'json' ? 'application/json' : 'text/markdown',
                    )
                  }
                >
                  <Download size={15} />
                  导出 {format === 'md' ? 'Markdown' : 'JSON'}
                </button>
              ))}
            </div>
            <button
              className="text-button danger-text"
              disabled={busy || !library.some((a) => a.id === draft.id)}
              onClick={() => {
                if (
                  window.confirm(
                    `从${scope === 'personal' ? '个人' : '房间'}地图集中移除「${draft.name}」？`,
                  )
                )
                  void operate(async () => {
                    await onDelete(draft.id);
                    setDraft(null);
                    setDirty(false);
                  }, '地图册已移除。');
              }}
            >
              <Trash2 size={15} />
              移除整本地图册
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
