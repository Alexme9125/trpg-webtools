import { useEffect, useState } from 'react';
import { Archive, Copy, RefreshCw, FolderDown, Image } from 'lucide-react';
import type { Room, Session } from '../../shared/types';
import type { ArchivePreparation } from '../../shared/archive';
import { IMAGE_RETENTION_NOTICE } from '../../shared/media';
import { downloadArchive, prepareArchive } from '../api';
import { chooseZipDestination, canChooseSavePath } from '../save-file';
import { Modal, Spinner } from './ui';
import { ChatImage } from './ChatImage';
import { ArchiveSummaryView } from './ArchiveSummary';

export default function RoomArchive({
  room,
  session,
  onClose,
  notify,
}: {
  room: Room;
  session: Session;
  onClose: () => void;
  notify: (message: string, type?: 'success' | 'error') => void;
}) {
  const [data, setData] = useState<ArchivePreparation | null>(null);
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [includeImages, setIncludeImages] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState(0);
  const [previews, setPreviews] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    prepareArchive(session)
      .then((value) => {
        if (!current) return;
        setData(value);
        setPage(0);
        setDescriptions((old) =>
          Object.fromEntries(
            value.images.map(({ image, description }) => [image.id, old[image.id] ?? description]),
          ),
        );
      })
      .catch((err) => {
        if (current) setError(err.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [session, refresh]);
  const missing = includeImages
    ? 0
    : (data?.images.filter(({ image }) => !descriptions[image.id]?.trim()).length ?? 0);
  async function save() {
    setSaving(true);
    setError('');
    try {
      const write = await chooseZipDestination(room.name);
      const values = Object.fromEntries(
        Object.entries(descriptions).filter(([, value]) => value.trim()),
      );
      const blob = await downloadArchive(session, values, includeImages);
      await write(blob);
      notify(
        canChooseSavePath()
          ? '全局存档已保存到所选位置。'
          : '全局存档已交给浏览器下载，请在下载列表中确认文件。',
      );
    } catch (err) {
      if ((err as Error).name !== 'AbortError')
        setError((err as Error).message || '保存失败，请重新选择位置。');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title="全局存档"
      subtitle="把这一晚的故事，留给下一次相聚。"
      onClose={() => {
        if (!saving) onClose();
      }}
      className="archive-modal"
    >
      <div className="room-archive">
        {!!room.seatClaims?.length && (
          <section className="archive-seats">
            <div className="section-eyebrow">WELCOME BACK</div>
            <h3>邀请同伴回到原来的席位</h3>
            <p>
              把新房间码 <b>{room.code}</b>{' '}
              和各自的席位恢复码分别交给玩家。玩家在“加入房间”中填写后，会恢复原角色与当前状态；恢复码仅可使用一次。
            </p>
            {room.seatClaims.map((seat) => (
              <div className="archive-seat" key={seat.memberId}>
                <span>
                  <b>{room.members.find((m) => m.id === seat.memberId)?.name}</b>
                  <small>
                    {room.members.find((m) => m.id === seat.memberId)?.character?.name ||
                      '尚未制卡'}
                  </small>
                </span>
                <code>{seat.code}</code>
                <button
                  className="icon-button"
                  aria-label={`复制${room.members.find((m) => m.id === seat.memberId)?.name}的续团信息`}
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(`房间码：${room.code}\n席位恢复码：${seat.code}`)
                      .then(() => notify('已复制续团信息。'))
                      .catch(() => notify('复制失败，请手动选择恢复码。', 'error'));
                  }}
                >
                  <Copy size={16} />
                </button>
              </div>
            ))}
          </section>
        )}
        <div className="archive-heading">
          <div>
            <div className="section-eyebrow">SESSION ARCHIVE</div>
            <h3>
              <Archive size={20} /> 保存整段旅程
            </h3>
          </div>
          <button
            className="text-button"
            disabled={loading || saving}
            onClick={() => setRefresh(refresh + 1)}
          >
            <RefreshCw size={15} /> 刷新资料
          </button>
        </div>
        <p className="muted">
          存档包含房间配置、全部角色与修正、审核状态、地图与场景、NPC /
          数据块、遭遇进度和完整可用记录。导出时保存最新状态。
        </p>
        {loading ? (
          <div className="archive-loading">
            <Spinner /> 正在整理房间资料…
          </div>
        ) : (
          data && (
            <>
              <ArchiveSummaryView value={data.summary} />
              <section className="archive-images">
                <label className="archive-image-option">
                  <input
                    type="checkbox"
                    checked={includeImages}
                    disabled={saving}
                    onChange={(event) => setIncludeImages(event.target.checked)}
                  />
                  <span>
                    <b>导出图片（仅保留路径引用）</b>
                    <small>
                      默认开启。上下文指向服务端对应图片，ZIP 不包含图片文件，也不会下载原图。
                    </small>
                  </span>
                </label>
                <p className="archive-retention-note">
                  {IMAGE_RETENTION_NOTICE}{' '}
                  仅导出、预览或查看图片不会续期；未开团的图片从上传时起计时。
                </p>
                <h3>
                  <Image size={18} /> {includeImages ? '保留图片引用' : '用文字带走图片'}{' '}
                  <span>
                    {includeImages
                      ? `${data.images.length} 张`
                      : `${data.images.length - missing} / ${data.images.length}`}
                  </span>
                </h3>
                <p className="muted">
                  {includeImages
                    ? '在原服务器恢复时读取仍在保留期内的图片。也可以补充描述，图片过期后仍能了解其中的线索。'
                    : '请描述图片中对续团有用的信息，如地图出口、标注或线索。恢复后在原消息位置显示这些文字。'}
                </p>
                {!data.images.length && (
                  <p className="archive-empty">没有需要处理的图片，可以直接保存。</p>
                )}
                {data.images
                  .slice(page * 8, (page + 1) * 8)
                  .map(({ image, path, sender, content, createdAt }, index) => (
                    <div className="archive-image-row" key={image.id}>
                      <details
                        onToggle={(event) => {
                          const open = event.currentTarget.open;
                          setPreviews((old) => ({ ...old, [image.id]: open }));
                        }}
                      >
                        <summary>
                          {page * 8 + index + 1}. {image.name} · {sender}
                        </summary>
                        <small>{new Date(createdAt).toLocaleString('zh-CN')}</small>
                        {previews[image.id] && <ChatImage image={image} session={session} />}
                        {content && <p>{content}</p>}
                        {includeImages && (
                          <p className="archive-image-path">
                            服务端路径 <code>{path}</code>
                          </p>
                        )}
                      </details>
                      <label className="field">
                        {includeImages ? '补充描述（选填）' : '替代描述（必填）'}
                        <textarea
                          aria-label={`图片描述：${image.name}`}
                          rows={3}
                          maxLength={2000}
                          placeholder="例如：一层地图，北侧通往书房，东侧出口被封；书柜后有一道暗门。"
                          value={descriptions[image.id] ?? ''}
                          onChange={(e) =>
                            setDescriptions({ ...descriptions, [image.id]: e.target.value })
                          }
                        />
                      </label>
                    </div>
                  ))}
                {data.images.length > 8 && (
                  <div className="archive-pagination">
                    <button
                      className="button secondary compact"
                      disabled={page === 0}
                      onClick={() => setPage(page - 1)}
                    >
                      上一页
                    </button>
                    <span>
                      {page + 1} / {Math.ceil(data.images.length / 8)}
                    </span>
                    <button
                      className="button secondary compact"
                      disabled={(page + 1) * 8 >= data.images.length}
                      onClick={() => setPage(page + 1)}
                    >
                      下一页
                    </button>
                  </div>
                )}
              </section>
            </>
          )
        )}
        <p className="archive-notice">
          含主持人私密资料与暗骰真实结果，请由主持人保管。下次选择相同规则，在“创建房间 →
          从全局存档续团”中导入 ZIP；房间阶段、资源和行动顺序都会保留。
        </p>
        <p className="archive-save-note">
          {canChooseSavePath()
            ? '保存时可选择文件名和文件夹。'
            : '此浏览器使用下载方式保存。若要每次选择路径，请在浏览器下载设置中启用“下载前询问保存位置”，或使用支持保存位置选择的桌面 Chrome / Edge。'}
        </p>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button primary full"
          disabled={loading || saving || !data || missing > 0}
          onClick={() => void save()}
        >
          {saving ? <Spinner /> : <FolderDown size={18} />}{' '}
          {saving
            ? '正在生成并保存…'
            : missing
              ? `还需填写 ${missing} 张图片的描述`
              : canChooseSavePath()
                ? '选择保存位置并导出 ZIP'
                : '下载全局存档 ZIP'}
        </button>
      </div>
    </Modal>
  );
}
