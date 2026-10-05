import { AtlasLibrarySchema, mergeAtlases, type Atlas } from '../shared/atlas';

const DATABASE = 'interlude-atlas-library';
const STORE = 'atlases';
function errorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === 'QuotaExceededError')
    return new Error('地图集存储空间不足，本次修改未保存。请导出备份后清理空间。');
  if (error instanceof Error && !(error instanceof DOMException)) return error;
  return new Error('无法读写个人地图集，请检查浏览器存储权限后重试。现有资料不会被清空。');
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const fail = (error: unknown) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        reject(errorMessage(error));
      }
    };
    const timer = setTimeout(
      () => fail(new Error('读取地图集超时，请关闭其他本站页面后重试。')),
      10000,
    );
    try {
      if (!globalThis.indexedDB)
        throw new Error('浏览器无法使用地图集存储，请换用支持 IndexedDB 的浏览器。');
      const request = indexedDB.open(DATABASE, 1);
      request.onblocked = () => fail(new Error('地图集被其他页面占用，请关闭其他本站页面后重试。'));
      request.onerror = () => fail(request.error);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => {
        if (finished) {
          request.result.close();
          return;
        }
        finished = true;
        clearTimeout(timer);
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    } catch (error) {
      fail(error);
    }
  });
}
async function transaction(transform?: (existing: Atlas[]) => Atlas[]): Promise<Atlas[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    let result: Atlas[] = [],
      failure: unknown;
    let tx: IDBTransaction;
    try {
      tx = database.transaction(STORE, transform ? 'readwrite' : 'readonly');
    } catch (error) {
      database.close();
      reject(errorMessage(error));
      return;
    }
    tx.oncomplete = () => {
      database.close();
      resolve(result);
    };
    tx.onabort = () => {
      database.close();
      reject(errorMessage(failure ?? tx.error));
    };
    tx.onerror = () => {
      failure ??= tx.error;
    };
    const store = tx.objectStore(STORE);
    const read = store.get('library');
    read.onsuccess = () => {
      try {
        const parsed = AtlasLibrarySchema.safeParse(read.result === undefined ? [] : read.result);
        if (!parsed.success)
          throw new Error('地图集数据格式异常，已保留原数据。请勿清除站点数据，先备份手头资料。');
        result = transform ? transform(parsed.data) : parsed.data;
        if (transform) store.put(result, 'library');
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
  });
}
export const getAtlasLibrary = () => transaction();
export function saveAtlases(items: Atlas[]) {
  const parsed = AtlasLibrarySchema.safeParse(items);
  if (!parsed.success)
    return Promise.reject(new Error(`地图集未保存：${parsed.error.issues[0]?.message}`));
  return transaction((existing) => mergeAtlases(existing, parsed.data));
}
export function removeAtlas(id: string) {
  return transaction((existing) => {
    if (!existing.some((a) => a.id === id)) throw new Error('地图册已被移除，请重新读取列表。');
    return existing.filter((a) => a.id !== id);
  });
}
