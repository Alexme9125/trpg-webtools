import { writeStored } from './storage';
import { io } from 'socket.io-client';
import type {
  Ack,
  CreateRoomInput,
  Inspiration,
  JoinRoomInput,
  RoomAction,
  RoomConnection,
  Session,
} from '../shared/types';

export const socket = io({
  autoConnect: false,
  reconnection: true,
  reconnectionDelayMax: 5000,
  timeout: 10_000,
});
let pendingConnect: Promise<void> | null = null;
function connect(): Promise<void> {
  if (socket.connected) return Promise.resolve();
  if (pendingConnect) return pendingConnect;
  pendingConnect = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('连接超时，请检查网络后重试')), 12_000);
    const onConnect = () => finish();
    const onError = () => finish(new Error('无法连接房间服务，请稍后重试'));
    function finish(error?: Error) {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
      pendingConnect = null;
      if (error) reject(error);
      else resolve();
    }
    socket.once('connect', onConnect);
    socket.once('connect_error', onError);
    socket.connect();
  });
  return pendingConnect;
}
async function request<T>(event: string, input: unknown): Promise<T> {
  await connect();
  return new Promise((resolve, reject) => {
    socket.timeout(10_000).emit(event, input, (error: Error | null, ack: Ack<T>) => {
      if (error) return reject(new Error('操作超时，请重试'));
      if (!ack || !ack.ok) return reject(new Error(ack && !ack.ok ? ack.error : '服务返回异常'));
      resolve(ack.data);
    });
  });
}
export const createRoom = (input: CreateRoomInput) => request<RoomConnection>('room:create', input);
export const joinRoom = (input: JoinRoomInput) => request<RoomConnection>('room:join', input);
export const resumeRoom = (session: Session) => request<RoomConnection>('room:resume', session);
export async function act(action: RoomAction): Promise<void> {
  await request<null>('room:action', action);
}
async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(25_000) });
  } catch {
    throw new Error('请求失败或超时，请检查网络后重试');
  }
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error ?? '服务暂时不可用，请稍后重试');
  return body;
}
export const getStatus = () => jsonRequest<{ aiConfigured: boolean }>('/api/status');
export const getInspiration = (session: Session, prompt: string) =>
  jsonRequest<Inspiration>('/api/inspiration', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ roomCode: session.roomCode, memberId: session.memberId, prompt }),
  });

export async function uploadChatImage(
  session: Session,
  file: File,
  content: string,
  requestId: string,
) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图片读取失败，请重新选择文件。'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
  return jsonRequest<{ eventId: string }>(`/api/rooms/${session.roomCode}/images`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.token}`,
      'x-interlude-member': session.memberId,
    },
    body: JSON.stringify({
      name: file.name.slice(0, 160) || '图片',
      mime: file.type,
      data: dataUrl.slice(dataUrl.indexOf(',') + 1),
      content,
      requestId,
    }),
  });
}
export class ImageUnavailableError extends Error {}
export async function fetchChatImage(session: Session, imageId: string, signal: AbortSignal) {
  const response = await fetch(`/api/rooms/${session.roomCode}/images/${imageId}`, {
    headers: { authorization: `Bearer ${session.token}`, 'x-interlude-member': session.memberId },
    signal,
  });
  if (response.status === 404 || response.status === 410)
    throw new ImageUnavailableError('图片已过期或不可用');
  if (!response.ok) throw new Error('图片暂时无法读取，请重试。');
  return response.blob();
}

const sessionHeaders = (session: Session) => ({
  authorization: `Bearer ${session.token}`,
  'x-interlude-member': session.memberId,
});
export const prepareArchive = (session: Session) =>
  jsonRequest<import('../shared/archive').ArchivePreparation>(
    `/api/rooms/${session.roomCode}/archive`,
    { headers: sessionHeaders(session) },
  );
export async function downloadArchive(
  session: Session,
  descriptions: Record<string, string>,
  includeImages = true,
) {
  const response = await fetch(`/api/rooms/${session.roomCode}/archive`, {
    method: 'POST',
    headers: { ...sessionHeaders(session), 'content-type': 'application/json' },
    body: JSON.stringify({ descriptions, includeImages }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok)
    throw new Error((await response.json().catch(() => null))?.error ?? '存档生成失败，请重试。');
  return response.blob();
}
export const inspectArchive = (file: File) =>
  jsonRequest<import('../shared/archive').ArchiveSummary>('/api/archives/inspect', {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: file,
  });
export async function restoreArchive(
  file: File,
  nickname: string,
  rule: import('../shared/types').RuleId,
) {
  const result = await jsonRequest<RoomConnection>('/api/archives/restore', {
    method: 'POST',
    headers: {
      'content-type': 'application/zip',
      'x-interlude-nickname': encodeURIComponent(nickname),
      'x-interlude-rule': rule,
    },
    body: file,
  });
  // Save the newly created session before reconnecting; a network interruption must not strand it.
  writeStored('interlude-session', result.session);
  return resumeRoom(result.session);
}
export const getHistory = (session: Session, before?: string) =>
  jsonRequest<{
    events: import('../shared/types').RoomEvent[];
    before: string | null;
    hasMore: boolean;
  }>(
    `/api/rooms/${session.roomCode}/history${before ? `?before=${encodeURIComponent(before)}` : ''}`,
    { headers: sessionHeaders(session) },
  );
