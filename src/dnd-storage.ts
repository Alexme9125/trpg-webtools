import { DndStatBlockSchema, MAX_DND_FILE_BYTES, type DndStatBlock } from '../shared/dnd';

const DATABASE = 'interlude-dnd-library';
const DATABASE_VERSION = 1;
const STORE = 'library';
const LIBRARY_KEY = 'cards';
const MAX_CARDS = 200;

class DndLibraryError extends Error {}

function storageError(error: unknown): Error {
  if (error instanceof DndLibraryError) return error;
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  if (name === 'QuotaExceededError') {
    return new DndLibraryError(
      'D&D 个人卡库存储空间不足，本次修改未保存。请先导出备份，再移除不需要的卡片或释放浏览器空间后重试。',
    );
  }
  if (name === 'SecurityError' || name === 'NotAllowedError') {
    return new DndLibraryError(
      '浏览器禁止D&D 个人卡库存储。请允许本站存储，或在普通浏览器窗口打开后重试。现有卡库未被修改。',
    );
  }
  if (name === 'VersionError' || name === 'NotFoundError') {
    return new DndLibraryError(
      'D&D 个人卡库格式与当前页面不兼容。请关闭其他本站页面并刷新到最新版本后重试，不要清除尚未备份的站点数据。',
    );
  }
  return new DndLibraryError(
    'D&D 个人卡库暂时无法读写，本次操作未完成。请检查浏览器存储权限并重试，先导出手头卡片备份。',
  );
}

function validateLibrary(value: unknown, stored = false): DndStatBlock[] {
  const malformed = () =>
    new DndLibraryError(
      stored
        ? 'D&D 个人卡库数据格式异常，已保留原数据。请勿清除浏览器站点数据，先导出手头卡片备份并联系维护者处理。'
        : 'D&D 数据块格式或数值无效，本次未保存。请在编辑器修正，或重新导入完整的 NPC／怪物数据块。',
    );
  if (!Array.isArray(value)) throw malformed();
  if (value.length > MAX_CARDS) {
    if (stored) throw malformed();
    throw new DndLibraryError(
      'D&D 个人卡库最多保存 200 张卡片。请先导出备份并移除不需要的卡片后重试。',
    );
  }
  const cards: DndStatBlock[] = [];
  const ids = new Set<string>();
  for (const raw of value) {
    let parsed: DndStatBlock;
    try {
      const result = DndStatBlockSchema.safeParse(raw);
      if (!result.success) throw malformed();
      parsed = result.data;
    } catch {
      throw malformed();
    }
    if (ids.has(parsed.id)) {
      if (stored) throw malformed();
      throw new DndLibraryError(
        '本次卡片包含重复编号，未保存。请调整编号或只保留需要保存的版本后重试。',
      );
    }
    ids.add(parsed.id);
    cards.push(parsed);
  }
  if (new TextEncoder().encode(JSON.stringify(cards)).byteLength > MAX_DND_FILE_BYTES) {
    if (stored) throw malformed();
    throw new DndLibraryError(
      'D&D 个人卡库不得超过 8 MiB，本次修改未保存。请先导出备份并分批整理。',
    );
  }
  return cards;
}

function mergeValidated(existing: DndStatBlock[], incoming: DndStatBlock[]): DndStatBlock[] {
  const merged = new Map(existing.map((card) => [card.id, card]));
  incoming.forEach((card) => merged.set(card.id, card));
  if (merged.size > MAX_CARDS) {
    throw new DndLibraryError(
      'D&D 个人卡库最多保存 200 张卡片，本次修改未保存。请先导出备份并移除不需要的卡片后重试。',
    );
  }
  return validateLibrary([...merged.values()]);
}

/** Pure validation/upsert, useful for previews and tests; it performs no storage or network I/O. */
export function mergeDndStatBlocks(
  existing: readonly DndStatBlock[],
  incoming: readonly DndStatBlock[],
): DndStatBlock[] {
  return mergeValidated(validateLibrary(existing), validateLibrary(incoming));
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(
      () =>
        fail(
          new DndLibraryError(
            '打开D&D 个人卡库超时。请关闭其他本站页面并检查浏览器存储权限后重试。',
          ),
        ),
      10_000,
    );
    function fail(error: unknown) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(storageError(error));
    }
    try {
      const factory = globalThis.indexedDB;
      if (!factory)
        throw new DndLibraryError(
          '当前浏览器无法使用D&D 个人卡库存储。请换用支持 IndexedDB 的普通浏览器窗口，并先导出卡片文件备份。',
        );
      const request = factory.open(DATABASE, DATABASE_VERSION);
      request.onblocked = () =>
        fail(
          new DndLibraryError(
            'D&D 个人卡库被其他页面占用。请关闭其他本站页面后重试，现有卡库未被修改。',
          ),
        );
      request.onerror = () => fail(request.error);
      request.onupgradeneeded = () => {
        try {
          if (!request.result.objectStoreNames.contains(STORE))
            request.result.createObjectStore(STORE);
        } catch (error) {
          request.transaction?.abort();
          fail(error);
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        if (settled) {
          database.close();
          return;
        }
        settled = true;
        clearTimeout(timer);
        database.onversionchange = () => database.close();
        resolve(database);
      };
    } catch (error) {
      fail(error);
    }
  });
}

async function transaction(
  mode: IDBTransactionMode,
  transform?: (cards: DndStatBlock[]) => DndStatBlock[],
): Promise<DndStatBlock[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    let failure: Error | undefined;
    let result: DndStatBlock[] | undefined;
    let tx: IDBTransaction;
    try {
      tx = database.transaction(STORE, mode);
    } catch (error) {
      database.close();
      reject(storageError(error));
      return;
    }
    function abort(error: unknown) {
      failure = storageError(error);
      try {
        tx.abort();
      } catch {
        database.close();
        reject(failure);
      }
    }
    tx.onerror = () => {
      failure ??= storageError(tx.error);
    };
    tx.onabort = () => {
      database.close();
      reject(failure ?? storageError(tx.error));
    };
    // A put request succeeding is not enough: only completion means the entire update committed.
    tx.oncomplete = () => {
      database.close();
      if (failure) reject(failure);
      else if (!result) reject(storageError(undefined));
      else resolve(result);
    };
    try {
      const store = tx.objectStore(STORE);
      const request = store.get(LIBRARY_KEY);
      request.onerror = () => {
        failure ??= storageError(request.error);
      };
      request.onsuccess = () => {
        try {
          const existing =
            request.result === undefined ? [] : validateLibrary(request.result, true);
          result = transform ? transform(existing) : existing;
          // Read and write stay in the same callback/transaction so simultaneous tabs cannot lose updates.
          if (transform) {
            const write = store.put(result, LIBRARY_KEY);
            write.onerror = () => {
              failure ??= storageError(write.error);
            };
          }
        } catch (error) {
          abort(error);
        }
      };
    } catch (error) {
      abort(error);
    }
  });
}

/** Personal, origin-local library only; nothing is copied from or sent to a room automatically. */
export const getDndLibrary = (): Promise<DndStatBlock[]> => transaction('readonly');

export async function saveDndStatBlocks(cards: DndStatBlock[]): Promise<DndStatBlock[]> {
  // Parse before awaiting IndexedDB, capturing a validated copy even if the caller later edits its objects.
  const incoming = validateLibrary(cards);
  return transaction('readwrite', (existing) => mergeValidated(existing, incoming));
}

export async function removeDndStatBlock(id: string): Promise<DndStatBlock[]> {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) {
    throw new DndLibraryError('卡片编号无效，本次未删除。请刷新D&D 个人卡库后重试。');
  }
  return transaction('readwrite', (existing) => {
    if (!existing.some((card) => card.id === id))
      throw new DndLibraryError('该卡片已不在D&D 个人卡库中。请刷新列表后重试。');
    return existing.filter((card) => card.id !== id);
  });
}
