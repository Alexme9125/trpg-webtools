import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { createAppServer } from '../server/app';
import { effectiveCharacter, type CharacterAdjustmentEdit } from '../shared/adjustments';
import { defaultCreationPolicy, validateCreation } from '../shared/creation';
import type { Ack, Room, RoomAction, RoomConnection, RuleId, Session } from '../shared/types';
import { preparedCharacter } from './fixtures/adjustment-character';

const clients: Socket[] = [];
const servers: ReturnType<typeof createAppServer>[] = [];
const directories: string[] = [];
async function server(dataDir = mkdtempSync(join(tmpdir(), 'interlude-adjustments-'))) {
  if (!directories.includes(dataDir)) directories.push(dataDir);
  const instance = createAppServer({ dataDir, rng: (sides) => Math.min(10, sides) });
  servers.push(instance);
  return { instance, dataDir, url: `http://127.0.0.1:${await instance.listen()}` };
}
async function client(url: string) {
  const socket = io(url, { transports: ['websocket'], reconnection: false, forceNew: true });
  clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}
const ack = <T>(socket: Socket, event: string, input: unknown) =>
  new Promise<Ack<T>>((resolve, reject) =>
    socket
      .timeout(3000)
      .emit(event, input, (error: Error | null, value: Ack<T>) =>
        error ? reject(error) : resolve(value),
      ),
  );
async function success<T>(socket: Socket, event: string, input: unknown) {
  const value = await ack<T>(socket, event, input);
  if (!value.ok) throw new Error(value.error);
  return value.data;
}
const act = (socket: Socket, input: RoomAction) => success(socket, 'room:action', input);
const snapshot = async (socket: Socket, session: Session) =>
  (await success<RoomConnection>(socket, 'room:resume', session)).room;
async function rejected(socket: Socket, input: unknown) {
  const result = await ack(socket, 'room:action', input);
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.error;
}
async function approve(host: Socket, room: Room, memberId: string) {
  const member = room.members.find((m) => m.id === memberId)!;
  await act(host, {
    type: 'review-character',
    memberId,
    decision: 'approved',
    note: '已核对',
    characterRevision: member.characterRevision,
    policyRevision: room.policyRevision,
  });
}
async function setup(rule: RuleId = 'dnd', active = true) {
  const environment = await server();
  const host = await client(environment.url),
    player = await client(environment.url);
  const h = await success<RoomConnection>(host, 'room:create', {
    name: '角色调整测试',
    nickname: '主持人',
    rule,
    mode: 'in-room',
  });
  const p = await success<RoomConnection>(player, 'room:join', {
    code: h.room.code,
    nickname: '玩家',
    rule,
  });
  await act(player, { type: 'character', character: preparedCharacter(rule) });
  if (active) {
    await approve(host, await snapshot(host, h.session), p.session.memberId);
    await act(player, { type: 'ready', ready: true });
    await act(host, { type: 'ready', ready: true });
    await act(host, { type: 'start' });
  }
  return { ...environment, host, player, h, p };
}
function editFor(room: Room, memberId: string, edit: CharacterAdjustmentEdit): RoomAction {
  const member = room.members.find((m) => m.id === memberId)!;
  return {
    type: 'character-adjust',
    memberId,
    characterId: member.character!.id,
    expectedRevision: member.characterRevision,
    edit,
  };
}
const growth: CharacterAdjustmentEdit = {
  kind: 'set-value',
  target: 'attribute',
  key: 'dex',
  value: 18,
  reason: '剧情成长',
};
const temporary: CharacterAdjustmentEdit = {
  kind: 'add-effect',
  effect: {
    id: 'effect-test',
    name: '场景影响',
    endCondition: '下一幕前结束',
    enabled: true,
    changes: [{ target: 'attribute', key: 'dex', amount: 2 }],
  },
};
afterEach(async () => {
  clients.splice(0).forEach((socket) => socket.disconnect());
  for (const instance of servers.splice(0)) await instance.close();
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
});

describe('authoritative in-session adjustments', () => {
  it('requires the host and an active story, with no full-card replacement bypass', async () => {
    const { host, player, h, p } = await setup('dnd', false);
    const room = await snapshot(host, h.session);
    const edit = editFor(room, p.session.memberId, growth);
    expect(await rejected(host, edit)).toContain('故事开始后');
    await approve(host, room, p.session.memberId);
    await act(player, { type: 'ready', ready: true });
    await act(host, { type: 'ready', ready: true });
    await act(host, { type: 'start' });
    expect(await rejected(player, edit)).toContain('只有主持人');
    expect(await rejected(player, { type: 'character', character: preparedCharacter() })).toContain(
      '准备阶段',
    );
    expect(await rejected(host, { ...edit, memberId: h.session.memberId })).toContain('角色卡');
    expect(
      (await snapshot(host, h.session)).members.find((m) => m.id === p.session.memberId)!.character!
        .adjustments,
    ).toBeUndefined();
  });

  it('broadcasts host changes, records them publicly, preserves allocation and uses them for D&D checks and future initiative', async () => {
    const { host, player, h, p } = await setup();
    const before = await snapshot(host, h.session);
    const old = before.members.find((m) => m.id === p.session.memberId)!;
    const broadcasts: Room[] = [];
    player.on('room:state', (room) => broadcasts.push(room));
    await act(host, editFor(before, old.id, growth));
    const after = await snapshot(player, p.session);
    const member = after.members.find((m) => m.id === old.id)!;
    expect(after.phase).toBe('active');
    expect(member.ready).toBe(true);
    expect(member.review).toEqual(old.review);
    expect(member.characterRevision).toBe(old.characterRevision + 1);
    expect(member.character!.attributes).toEqual(old.character!.attributes);
    expect(member.character!.creation).toEqual(old.character!.creation);
    expect(effectiveCharacter(member.character!).attributes.dex).toBe(18);
    expect(
      broadcasts.some(
        (r) =>
          r.members.find((m) => m.id === old.id)?.character?.adjustments?.permanent.length === 1,
      ),
    ).toBe(true);
    expect(after.log.at(-1)).toMatchObject({
      memberId: h.session.memberId,
      visibility: 'public',
      type: 'system',
    });
    expect(after.log.at(-1)!.content).toContain('剧情成长');
    expect(after.encounter.participants.find((c) => c.memberId === old.id)!.dex).toBe(18);
    await act(player, {
      type: 'check',
      visibility: 'public',
      check: { kind: 'skill', key: 'stealth', dc: 15, edge: 'normal', modifier: 0 },
    });
    expect((await snapshot(host, h.session)).log.at(-1)!.check).toMatchObject({
      modifier: 4,
      total: 14,
    });
    await act(host, { type: 'initiative' });
    expect(
      (await snapshot(host, h.session)).encounter.participants.find((c) => c.memberId === old.id)!
        .initiative,
    ).toBe(14);
  });

  it('rejects stale revisions and wrong character identities before any mutation', async () => {
    const { host, player, h, p } = await setup();
    const room = await snapshot(host, h.session);
    const request = editFor(room, p.session.memberId, growth);
    expect(await rejected(host, { ...request, characterId: 'some-other-character' })).toContain(
      '角色状态已更新',
    );
    await act(player, { type: 'resource', memberId: p.session.memberId, resource: 'hp', value: 1 });
    expect(await rejected(host, request)).toContain('角色状态已更新');
    const latest = await snapshot(host, h.session);
    expect(
      latest.members.find((m) => m.id === p.session.memberId)!.character!.adjustments,
    ).toBeUndefined();
    await act(host, editFor(latest, p.session.memberId, growth));
    expect(await rejected(host, editFor(latest, p.session.memberId, temporary))).toContain(
      '角色状态已更新',
    );
  });

  it('only adjusts the selected member even when two characters share a card ID', async () => {
    const { host, player, h, p, url } = await setup('dnd', false);
    const second = await client(url);
    const q = await success<RoomConnection>(second, 'room:join', {
      code: h.room.code,
      nickname: '第二位玩家',
      rule: 'dnd',
    });
    const sameCard = (await snapshot(player, p.session)).members.find(
      (m) => m.id === p.session.memberId,
    )!.character!;
    await act(second, { type: 'character', character: sameCard });
    for (const [socket, session] of [
      [player, p.session],
      [second, q.session],
    ] as const) {
      await approve(host, await snapshot(host, h.session), session.memberId);
      await act(socket, { type: 'ready', ready: true });
    }
    await act(host, { type: 'ready', ready: true });
    await act(host, { type: 'start' });
    await act(host, editFor(await snapshot(host, h.session), q.session.memberId, growth));
    const room = await snapshot(host, h.session);
    expect(
      room.members.find((m) => m.id === p.session.memberId)!.character!.adjustments,
    ).toBeUndefined();
    expect(
      effectiveCharacter(room.members.find((m) => m.id === q.session.memberId)!.character!)
        .attributes.dex,
    ).toBe(18);
  });

  it('applies, disables, restores and removes a CoC skill effect without changing its creation budget', async () => {
    const { host, player, h, p } = await setup('coc');
    const memberId = p.session.memberId;
    const edit = async (change: CharacterAdjustmentEdit) =>
      act(host, editFor(await snapshot(host, h.session), memberId, change));
    await edit({
      kind: 'set-value',
      target: 'skill',
      key: 'spotHidden',
      value: 60,
      reason: '成长',
    });
    await edit({
      kind: 'add-effect',
      effect: {
        ...temporary.effect!,
        changes: [{ target: 'skill', key: 'spotHidden', amount: 15 }],
      },
    });
    const target = async () => {
      await act(player, {
        type: 'check',
        visibility: 'public',
        check: { kind: 'skill', key: 'spotHidden', dc: 15, modifier: 0, edge: 'normal' },
      });
      return (await snapshot(player, p.session)).log.at(-1)!.check!.target;
    };
    expect(await target()).toBe(75);
    await edit({ kind: 'toggle-effect', effectId: 'effect-test', enabled: false });
    expect(await target()).toBe(60);
    await edit({ kind: 'toggle-effect', effectId: 'effect-test', enabled: true });
    expect(await target()).toBe(75);
    await edit({ kind: 'remove-effect', effectId: 'effect-test' });
    expect(await target()).toBe(60);
    const card = (await snapshot(host, h.session)).members.find(
      (m) => m.id === memberId,
    )!.character!;
    expect(validateCreation(card, defaultCreationPolicy('coc'))).toEqual([]);
  });

  it('rejects out-of-range totals, malformed payloads and duplicate effects atomically', async () => {
    const { host, h, p } = await setup();
    let room = await snapshot(host, h.session);
    const originalLogCount = room.log.length;
    for (const edit of [
      { ...growth, value: 31 },
      { ...growth, key: 'constructor' },
      { ...growth, value: 14.5 },
      {
        ...temporary,
        effect: {
          ...temporary.effect!,
          changes: [{ target: 'attribute', key: 'dex', amount: 100 }],
        },
      },
    ])
      await rejected(host, editFor(room, p.session.memberId, edit as CharacterAdjustmentEdit));
    room = await snapshot(host, h.session);
    expect(room.log).toHaveLength(originalLogCount);
    expect(
      room.members.find((m) => m.id === p.session.memberId)!.character!.adjustments,
    ).toBeUndefined();
    await act(host, editFor(room, p.session.memberId, temporary));
    room = await snapshot(host, h.session);
    expect(await rejected(host, editFor(room, p.session.memberId, temporary))).toContain('重复');
  });

  it('retains adjustments across pause, requires a new review and can start again without redistributing points', async () => {
    const { host, player, h, p } = await setup();
    await act(host, editFor(await snapshot(host, h.session), p.session.memberId, growth));
    await act(host, { type: 'pause' });
    const room = await snapshot(host, h.session);
    const member = room.members.find((m) => m.id === p.session.memberId)!;
    expect(member.review.status).toBe('pending');
    expect(effectiveCharacter(member.character!).attributes.dex).toBe(18);
    await act(player, { type: 'ready', ready: true });
    await act(host, { type: 'ready', ready: true });
    expect(await rejected(host, { type: 'start' })).toContain('审核');
    await approve(host, room, p.session.memberId);
    await act(host, { type: 'start' });
    expect((await snapshot(player, p.session)).phase).toBe('active');
  });

  it('requires review for imported adjustments and invalidates approval after a lobby replacement', async () => {
    const { host, player, h, p } = await setup();
    await act(host, editFor(await snapshot(host, h.session), p.session.memberId, growth));
    await act(host, { type: 'pause' });
    const oldRoom = await snapshot(host, h.session);
    const imported = structuredClone(
      oldRoom.members.find((m) => m.id === p.session.memberId)!.character!,
    );
    await approve(host, oldRoom, p.session.memberId);
    imported.adjustments!.permanent[0].amount = 8;
    await act(player, { type: 'character', character: imported });
    const latest = await snapshot(host, h.session);
    expect(latest.members.find((m) => m.id === p.session.memberId)!.review.status).toBe('pending');
    await expect(approve(host, oldRoom, p.session.memberId)).rejects.toThrow('重新审核');
  });

  it('persists and restores both lasting and temporary adjustments after a server restart', async () => {
    const { host, h, p, instance, dataDir } = await setup();
    await act(host, editFor(await snapshot(host, h.session), p.session.memberId, growth));
    await act(host, editFor(await snapshot(host, h.session), p.session.memberId, temporary));
    const before = (await snapshot(host, h.session)).members.find(
      (m) => m.id === p.session.memberId,
    )!;
    await instance.close();
    servers.splice(servers.indexOf(instance), 1);
    const restarted = await server(dataDir);
    const newHost = await client(restarted.url);
    const room = await snapshot(newHost, h.session);
    expect(room.phase).toBe('active');
    const restored = room.members.find((m) => m.id === p.session.memberId)!;
    expect(restored.character).toEqual(before.character);
    expect(restored.characterRevision).toBe(before.characterRevision);
    expect(effectiveCharacter(restored.character!).attributes.dex).toBe(20);
    expect(room.encounter.participants.find((c) => c.memberId === p.session.memberId)!.dex).toBe(
      20,
    );
  });

  it('rolls back the card, revision, log and encounter when persistence fails', async () => {
    const { host, h, p, dataDir } = await setup();
    const before = await snapshot(host, h.session);
    const onDisk = readFileSync(join(dataDir, 'rooms.json'), 'utf8');
    const block = join(dataDir, `rooms.json.${process.pid}.tmp`);
    mkdirSync(block);
    try {
      expect(await rejected(host, editFor(before, p.session.memberId, growth))).toContain(
        '存档保存失败',
      );
      expect(readFileSync(join(dataDir, 'rooms.json'), 'utf8')).toBe(onDisk);
    } finally {
      rmSync(block, { recursive: true });
    }
    const after = await snapshot(host, h.session);
    expect(after.members).toEqual(before.members);
    expect(after.log).toEqual(before.log);
    expect(after.encounter).toEqual(before.encounter);
  });
});
