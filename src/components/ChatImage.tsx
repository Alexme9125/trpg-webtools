import { useEffect, useState } from 'react';
import { Image, ImageOff, RefreshCw, Download } from 'lucide-react';
import type { ChatImage as ImageData } from '../../shared/media';
import type { Session } from '../../shared/types';
import { fetchChatImage, ImageUnavailableError } from '../api';
import { Spinner } from './ui';
export function ChatImage({ image, session }: { image: ImageData; session: Session }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<'unavailable' | 'temporary' | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let blobUrl = '';
    setUrl('');
    setError(null);
    void fetchChatImage(session, image.id, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        blobUrl = URL.createObjectURL(blob);
        setUrl(blobUrl);
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(err instanceof ImageUnavailableError ? 'unavailable' : 'temporary');
      });
    return () => {
      controller.abort();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [session.roomCode, session.memberId, session.token, image.id, attempt]);
  return (
    <figure className="chat-image">
      {error === 'unavailable' ? (
        <div className="chat-image-placeholder" role="img" aria-label={`图片占位：${image.name}`}>
          <ImageOff size={26} strokeWidth={1.5} />
          <b>图片已过期或不可用</b>
          <span>原图在最后一次游玩结束 14 天后自动删除。此处保留图片在故事中的位置。</span>
        </div>
      ) : error ? (
        <div className="chat-image-error">
          <Image size={20} />
          <span>图片暂时无法读取</span>
          <button className="text-button" onClick={() => setAttempt(attempt + 1)}>
            <RefreshCw size={13} />
            重试
          </button>
        </div>
      ) : url ? (
        <a href={url} target="_blank" rel="noreferrer" aria-label={`查看原图：${image.name}`}>
          <img src={url} alt={image.name} loading="lazy" onError={() => setError('temporary')} />
        </a>
      ) : (
        <div className="chat-image-loading">
          <Spinner />
          正在读取图片
        </div>
      )}
      <figcaption>
        <span>
          {image.name} · {(image.bytes / 1024).toFixed(0)} KB
        </span>
        {url && !error && (
          <a href={url} download={image.name}>
            <Download size={13} />
            保存图片
          </a>
        )}
      </figcaption>
    </figure>
  );
}
