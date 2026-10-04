import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDndStatBlock, type DndStatBlock } from '../shared/dnd';
import {
  getDndLibrary,
  mergeDndStatBlocks,
  removeDndStatBlock,
  saveDndStatBlocks,
} from '../src/dnd-storage';

afterEach(() => vi.unstubAllGlobals());
const card = () => createDndStatBlock('npc-bridge-guard');

describe('D&D personal library validation', () => {
  it('upserts by ID without mutating the caller or sharing nested state', () => {
    const first = card();
    const second = card();
    const incoming = { ...first, name: '新版', hp: 1 };
    const snapshot = structuredClone({ first, second, incoming });
    const result = mergeDndStatBlocks([first, second], [incoming]);
    expect(result.map((entry) => entry.id)).toEqual([first.id, second.id]);
    expect(result[0].name).toBe('新版');
    result[0].actions[0].damage = 'changed';
    result[1].attributes.str = 30;
    expect({ first, second, incoming }).toEqual(snapshot);
  });

  it('allows updating a full 200-card library, refuses a 201st card and keeps the original intact', () => {
    const seed = card();
    const full = Array.from({ length: 200 }, (_, index) => ({ ...seed, id: `dnd-${index}` }));
    const snapshot = structuredClone(full);
    expect(mergeDndStatBlocks(full, [{ ...full[0], name: '更新' }])).toHaveLength(200);
    expect(() => mergeDndStatBlocks(full, [card()])).toThrow('最多保存 200 张');
    expect(() => mergeDndStatBlocks([], [...full, card()])).toThrow('最多保存 200 张');
    expect(full).toEqual(snapshot);
  });

  it('rejects an entire malformed or duplicate batch, including CoC cards', () => {
    const first = card();
    expect(() => mergeDndStatBlocks([], [first, first])).toThrow('重复编号');
    expect(() => mergeDndStatBlocks([first, first], [])).toThrow('重复编号');
    const wrongRule = {
      ...card(),
      rule: 'coc',
      documentType: 'keeper-card',
    } as unknown as DndStatBlock;
    expect(() => mergeDndStatBlocks([first], [card(), wrongRule])).toThrow('格式或数值无效');
    const unsafe = JSON.parse(JSON.stringify(card()));
    unsafe.attributes = JSON.parse('{"__proto__":{}}');
    expect(() => mergeDndStatBlocks([], [unsafe])).toThrow('格式或数值无效');
  });

  it('enforces the UTF-8 size of the entire merged library atomically', () => {
    const seed = { ...card(), notes: '汉'.repeat(24000) };
    const first = Array.from({ length: 70 }, (_, i) => ({ ...seed, id: `a-${i}` }));
    const second = Array.from({ length: 70 }, (_, i) => ({ ...seed, id: `b-${i}` }));
    expect(mergeDndStatBlocks([], first)).toHaveLength(70);
    expect(mergeDndStatBlocks([], second)).toHaveLength(70);
    const before = JSON.stringify(first);
    expect(() => mergeDndStatBlocks(first, second)).toThrow('8 MiB');
    expect(JSON.stringify(first)).toBe(before);
  });
});

describe('D&D storage failure reporting', () => {
  it('does not report an empty successful library if IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(getDndLibrary()).rejects.toThrow('无法使用');
  });

  it.each([
    ['QuotaExceededError', '空间不足'],
    ['SecurityError', '请允许本站存储'],
    ['NotAllowedError', '请允许本站存储'],
    ['VersionError', '格式与当前页面不兼容'],
  ])('turns %s into an actionable Chinese message', async (name, message) => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new DOMException('Private detail', name);
      },
    });
    await expect(getDndLibrary()).rejects.toThrow(message);
  });

  it('rejects invalid inputs before touching the database', async () => {
    const open = vi.fn();
    vi.stubGlobal('indexedDB', { open });
    await expect(saveDndStatBlocks([{ id: 'bad' } as DndStatBlock])).rejects.toThrow(
      '格式或数值无效',
    );
    await expect(removeDndStatBlock('../bad')).rejects.toThrow('编号无效');
    expect(open).not.toHaveBeenCalled();
  });
});

/** Controllable commit/abort boundary; no test is allowed to mistake request success for a commit. */
function storageHarness(initial: unknown = []) {
  let committed = structuredClone(initial);
  let staged: unknown;
  const events: string[] = [];
  let ready!: () => void;
  const requested = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const close = vi.fn();
  const request: { result: unknown; error: unknown; onsuccess?: () => void; onerror?: () => void } =
    { result: undefined, error: null };
  const tx: {
    error: unknown;
    onerror?: () => void;
    onabort?: () => void;
    oncomplete?: () => void;
    abort: () => void;
    objectStore: (name: string) => unknown;
  } = {
    error: null,
    abort: () => {
      events.push('abort');
      queueMicrotask(() => tx.onabort?.());
      ready();
    },
    objectStore: (name) => {
      expect(name).toBe('library');
      return {
        get: (key: string) => {
          expect(key).toBe('cards');
          events.push('get');
          request.result = structuredClone(committed);
          queueMicrotask(() => {
            request.onsuccess?.();
            ready();
          });
          return request;
        },
        put: (value: unknown, key: string) => {
          expect(key).toBe('cards');
          events.push('put');
          staged = structuredClone(value);
          const write: { onsuccess?: () => void; onerror?: () => void; error: unknown } = {
            error: null,
          };
          queueMicrotask(() => write.onsuccess?.());
          return write;
        },
      };
    },
  };
  const database = {
    close,
    onversionchange: undefined as (() => void) | undefined,
    transaction: vi.fn((_store: string, mode: string) => {
      events.push(mode);
      return tx;
    }),
  };
  const open = vi.fn(() => {
    const opening: { result: typeof database; onsuccess?: () => void } = { result: database };
    queueMicrotask(() => opening.onsuccess?.());
    return opening;
  });
  vi.stubGlobal('indexedDB', { open });
  return {
    open,
    close,
    events,
    requested,
    value: () => structuredClone(committed),
    complete: () => {
      if (staged !== undefined) committed = staged;
      tx.oncomplete?.();
    },
    failCommit: (name = 'QuotaExceededError') => {
      tx.error = new DOMException('Late failure', name);
      tx.onabort?.();
    },
    versionChange: () => database.onversionchange?.(),
  };
}

describe('D&D IndexedDB transactions', () => {
  it('uses its independent DB, captures incoming objects before await and resolves only on commit', async () => {
    const existing = card();
    const incoming = card();
    const intended = structuredClone(incoming);
    const storage = storageHarness([existing]);
    let settled = false;
    const operation = saveDndStatBlocks([incoming]).then((result) => {
      settled = true;
      return result;
    });
    incoming.name = '调用者在 await 之前更改';
    incoming.actions[0].damage = '更改';
    await storage.requested;
    await Promise.resolve();
    expect(storage.open).toHaveBeenCalledWith('interlude-dnd-library', 1);
    expect(storage.events).toEqual(['readwrite', 'get', 'put']);
    expect(settled).toBe(false);
    expect(storage.value()).toEqual([existing]);
    storage.complete();
    expect(await operation).toEqual([existing, intended]);
    expect(storage.value()).toEqual([existing, intended]);
    expect(storage.close).toHaveBeenCalledOnce();
  });

  it('reports a late commit failure and retains previously committed cards', async () => {
    const existing = card();
    const storage = storageHarness([existing]);
    const operation = saveDndStatBlocks([card()]);
    const assertion = expect(operation).rejects.toThrow('空间不足');
    await storage.requested;
    storage.failCommit();
    await assertion;
    expect(storage.value()).toEqual([existing]);
    expect(storage.close).toHaveBeenCalledOnce();
  });

  it('reads persisted cards and closes a version-changed connection', async () => {
    const existing = card();
    const storage = storageHarness([existing]);
    const operation = getDndLibrary();
    await storage.requested;
    expect(storage.events).toEqual(['readonly', 'get']);
    storage.complete();
    expect(await operation).toEqual([existing]);
    storage.versionChange();
    expect(storage.close).toHaveBeenCalledTimes(2);
  });

  it('keeps corrupt stored data and fails instead of overwriting it with an empty array', async () => {
    const corrupt = [{ id: 'lost', rule: 'coc' }];
    const storage = storageHarness(corrupt);
    const assertion = expect(saveDndStatBlocks([card()])).rejects.toThrow('已保留原数据');
    await storage.requested;
    await assertion;
    expect(storage.events).toEqual(['readwrite', 'get', 'abort']);
    expect(storage.value()).toEqual(corrupt);
  });

  it('deletes only the requested ID in one transaction', async () => {
    const first = card();
    const other = card();
    const storage = storageHarness([first, other]);
    const operation = removeDndStatBlock(first.id);
    await storage.requested;
    expect(storage.value()).toEqual([first, other]);
    storage.complete();
    expect(await operation).toEqual([other]);
  });

  it('refuses to call deletion successful if the card was already removed', async () => {
    const storage = storageHarness([]);
    const assertion = expect(removeDndStatBlock('missing')).rejects.toThrow('已不在');
    await storage.requested;
    await assertion;
    expect(storage.events).not.toContain('put');
  });
});
