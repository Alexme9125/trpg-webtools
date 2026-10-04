import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKeeperCard, type KeeperCard } from '../shared/keeper';
import {
  getKeeperLibrary,
  mergeKeeperCards,
  removeKeeperCard,
  saveKeeperCards,
} from '../src/keeper-storage';

afterEach(() => vi.unstubAllGlobals());

describe('个人主持人卡库合并', () => {
  it('按编号更新并保留其他卡；返回对象与传入对象分离', () => {
    const first = createKeeperCard('npc-bystander', { name: '旧名字' });
    const other = createKeeperCard('monster');
    const existing = [first, other];
    const incoming = [{ ...first, name: '新名字' }];
    const snapshot = structuredClone({ existing, incoming });
    const result = mergeKeeperCards(existing, incoming);
    expect(result.map((card) => card.id)).toEqual([first.id, other.id]);
    expect(result[0].name).toBe('新名字');
    result[0].attributes.str = 999;
    result[1].notes = '修改结果';
    expect({ existing, incoming }).toEqual(snapshot);
  });

  it('200张库内更新可以保存，第201张新卡拒绝且原数组不变', () => {
    const card = createKeeperCard('monster');
    const full = Array.from({ length: 200 }, (_, index) => ({ ...card, id: `monster-${index}` }));
    const original = structuredClone(full);
    expect(mergeKeeperCards(full, [{ ...full[0], name: '更新' }])).toHaveLength(200);
    expect(() => mergeKeeperCards(full, [{ ...card, id: 'extra-monster' }])).toThrow(
      '最多保存 200 张',
    );
    expect(full).toEqual(original);
  });

  it('拒绝重复编号或任何无效卡，整个批次都不合并', () => {
    const card = createKeeperCard('npc-bystander');
    expect(() => mergeKeeperCards([], [card, card])).toThrow('重复编号');
    const existing = [card];
    const bad = {
      ...createKeeperCard('monster'),
      documentType: 'character',
    } as unknown as KeeperCard;
    expect(() => mergeKeeperCards(existing, [createKeeperCard('npc-bystander'), bad])).toThrow(
      '格式或数值无效',
    );
    expect(existing).toEqual([card]);
    const unsafe = JSON.parse(JSON.stringify(card));
    unsafe.attributes = JSON.parse('{"__proto__":1}');
    expect(() => mergeKeeperCards([], [unsafe])).toThrow('格式或数值无效');
  });

  it('不接受损坏的既有库或超过200张的输入，即使更新编号重复也不能绕过批次限制', () => {
    const card = createKeeperCard('monster');
    expect(() => mergeKeeperCards([card, card], [])).toThrow('重复编号');
    const excessive = Array.from({ length: 201 }, (_, index) => ({ ...card, id: `card-${index}` }));
    expect(() => mergeKeeperCards([], excessive)).toThrow('最多保存 200 张');
  });
});

describe('个人卡库存储失败报告', () => {
  it('IndexedDB不可用时读取、保存和删除都明确失败', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(getKeeperLibrary()).rejects.toThrow('当前浏览器无法使用');
    await expect(saveKeeperCards([createKeeperCard('monster')])).rejects.toThrow(
      '当前浏览器无法使用',
    );
    await expect(removeKeeperCard('valid-id')).rejects.toThrow('当前浏览器无法使用');
  });

  it('同步配额或存储权限失败给出中文操作提示', async () => {
    vi.stubGlobal('indexedDB', {
      open() {
        throw new DOMException('Private detail', 'QuotaExceededError');
      },
    });
    await expect(saveKeeperCards([createKeeperCard('monster')])).rejects.toThrow('空间不足');
    vi.stubGlobal('indexedDB', {
      open() {
        throw new DOMException('Private detail', 'SecurityError');
      },
    });
    await expect(getKeeperLibrary()).rejects.toThrow('请允许本站存储');
  });

  it('非法保存和删除在访问存储之前拒绝，不以空库或成功作为回退', async () => {
    const open = vi.fn();
    vi.stubGlobal('indexedDB', { open });
    await expect(saveKeeperCards([{ id: 'bad' } as KeeperCard])).rejects.toThrow('格式或数值无效');
    await expect(removeKeeperCard('../bad')).rejects.toThrow('编号无效');
    expect(open).not.toHaveBeenCalled();
  });
});
