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
