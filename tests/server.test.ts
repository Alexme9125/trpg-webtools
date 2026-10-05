import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { defaultCreationPolicy, suggestAllocation } from '../shared/creation.ts';
import { createKeeperCard } from '../shared/keeper.ts';
import { deriveCharacter } from '../shared/rules.ts';
import { createAppServer, type ServerOptions } from '../server/app.ts';
import type { Ack, Character, Room, RoomAction, RoomConnection, Session } from '../shared/types.ts';

const clients: Socket[] = [];
const servers: ReturnType<typeof createAppServer>[] = [];
const directories: string[] = [];
function character(rule: 'dnd' | 'coc' = 'dnd'): Character {
  const date = new Date().toISOString();
  const base: Character = {
    schemaVersion: 1,
    id: 'char-test',
    rule,
    name: '艾琳',
    occupation: rule === 'dnd' ? '战士' : '教授',
    ancestry: '人类',
    background: '旅行者',
    age: 25,
    level: 1,
    attributes:
      rule === 'dnd'
        ? { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }
        : { str: 50, con: 50, siz: 50, dex: 60, app: 50, int: 60, pow: 60, edu: 60, luck: 50 },
    skills: rule === 'dnd' ? { athletics: 4 } : { spotHidden: 50 },
    proficiencies: rule === 'dnd' ? ['skill:athletics'] : [],
    hp: 12,
    maxHp: 12,
    mp: rule === 'dnd' ? 0 : 12,
    maxMp: rule === 'dnd' ? 0 : 12,
    san: rule === 'dnd' ? 0 : 60,
    maxSan: rule === 'dnd' ? 0 : 99,
    ac: 16,
    backstory: '',
    notes: '',
    traits: [],
    items: [],
    createdAt: date,
    updatedAt: date,
  };
  return suggestAllocation(deriveCharacter(base), defaultCreationPolicy(rule));
}
async function setup(options: ServerOptions = {}) {
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), 'interlude-server-'));
  if (!directories.includes(dataDir)) directories.push(dataDir);
  const server = createAppServer({
    ...options,
    dataDir,
    rng: options.rng ?? ((sides) => Math.floor(sides / 2) + 1),
  });
  servers.push(server);
  const port = await server.listen();
  const url = `http://127.0.0.1:${port}`;
  return { server, url, dataDir };
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
function ack<T>(socket: Socket, event: string, input: unknown): Promise<Ack<T>> {
  return new Promise((resolve, reject) =>
    socket
      .timeout(3000)
      .emit(event, input, (error: Error | null, result: Ack<T>) =>
        error ? reject(error) : resolve(result),
      ),
  );
}
async function success<T>(socket: Socket, event: string, input: unknown): Promise<T> {
  const result = await ack<T>(socket, event, input);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
const action = (socket: Socket, value: RoomAction) => success<null>(socket, 'room:action', value);
const create = (
  socket: Socket,
  rule: 'dnd' | 'coc' = 'dnd',
  mode: 'in-room' | 'external' = 'in-room',
) =>
  success<RoomConnection>(socket, 'room:create', {
    name: '余烬旅店',
    nickname: '主持人',
    rule,
    mode,
  });
const joinRoom = (socket: Socket, code: string, rule: 'dnd' | 'coc' = 'dnd') =>
  success<RoomConnection>(socket, 'room:join', { code, nickname: '玩家', rule });
function nextState(socket: Socket, predicate: (room: Room) => boolean = () => true) {
  return new Promise<Room>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('room:state', listener);
      reject(new Error('未收到房间状态'));
    }, 3000);
    const listener = (room: Room) => {
      if (predicate(room)) {
        clearTimeout(timer);
        socket.off('room:state', listener);
        resolve(room);
      }
    };
    socket.on('room:state', listener);
  });
}
async function approve(host: Socket, player: Socket, session: Session) {
  const { room } = await success<RoomConnection>(player, 'room:resume', session);
  const member = room.members.find((entry) => entry.id === session.memberId)!;
  await action(host, {
    type: 'review-character',
    memberId: member.id,
    decision: 'approved',
    note: '审核通过',
    characterRevision: member.characterRevision,
    policyRevision: room.policyRevision,
  });
}
async function activeRoom(url: string, mode: 'in-room' | 'external' = 'in-room') {
  const host = await client(url);
  const player = await client(url);
  const hostConnection = await create(host, 'dnd', mode);
  const playerConnection = await joinRoom(player, hostConnection.room.code);
  await action(player, { type: 'character', character: character() });
  await action(player, { type: 'ready', ready: true });
  await action(host, { type: 'ready', ready: true });
  await approve(host, player, playerConnection.session);
  await action(host, { type: 'start' });
  return { host, player, hostConnection, playerConnection };
}
afterEach(async () => {
  clients.splice(0).forEach((socket) => socket.disconnect());
  for (const server of servers.splice(0)) await server.close();
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
});

describe('真实多人房间服务', () => {
  it('完整保存超过 64 KiB 的中文角色卡，并保持连接可恢复', async () => {
    const { url } = await setup();
    const host = await client(url),
      player = await client(url);
    const h = await create(host),
      p = await joinRoom(player, h.room.code);
    const card = character();
    card.items = Array.from({ length: 30 }, (_, i) => ({
      id: `large-item-${i}`,
      name: `物品 ${i + 1}`,
      quantity: 1,
      notes: '备'.repeat(1000),
    }));
    expect(Buffer.byteLength(JSON.stringify(card), 'utf8')).toBeGreaterThan(64 * 1024);
    const saved = nextState(host, (room) =>
      room.members.some((m) => m.id === p.session.memberId && m.character?.items.length === 30),
    );
    await action(player, { type: 'character', character: card });
    expect(
      (await saved).members.find((m) => m.id === p.session.memberId)?.character?.items,
    ).toEqual(card.items);
    const restored = await success<RoomConnection>(player, 'room:resume', p.session);
    expect(
      restored.room.members.find((m) => m.id === p.session.memberId)?.character?.items,
    ).toEqual(card.items);
    expect(player.connected).toBe(true);
  });

  it('校验载卡与准备条件，并向双方广播开始和聊天', async () => {
    const { url } = await setup();
    const host = await client(url),
      player = await client(url);
    const h = await create(host),
      p = await joinRoom(player, h.room.code);
    expect(h.session.token).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(p.room)).not.toContain(h.session.token);
    expect((await ack(host, 'room:action', { type: 'start' })).ok).toBe(false);
    expect((await ack(player, 'room:action', { type: 'ready', ready: true })).ok).toBe(false);
    await action(player, { type: 'character', character: character() });
    await action(player, { type: 'ready', ready: true });
    await action(host, { type: 'ready', ready: true });
    await approve(host, player, p.session);
    const started = nextState(player, (room) => room.phase === 'active');
    await action(host, { type: 'start' });
    expect((await started).members.every((m) => m.ready)).toBe(true);
    const hostChat = nextState(host, (room) => room.log.some((e) => e.content === '我推开门。'));
    const playerChat = nextState(player, (room) =>
      room.log.some((e) => e.content === '我推开门。'),
    );
    await action(player, { type: 'message', content: '我推开门。' });
    expect((await hostChat).log.at(-1)?.memberId).toBe(p.session.memberId);
    expect((await playerChat).log.at(-1)?.type).toBe('chat');
  });

  it('拒绝规则不匹配、非法角色卡及通过附加字段伪装主持人', async () => {
    const { url } = await setup();
    const host = await client(url),
      player = await client(url);
    const h = await create(host);
    expect(
      (await ack(player, 'room:join', { code: h.room.code, nickname: '玩家', rule: 'coc' })).ok,
    ).toBe(false);
    await joinRoom(player, h.room.code);
    expect(
      (await ack(player, 'room:action', { type: 'character', character: { rule: 'dnd' } })).ok,
    ).toBe(false);
    expect(
      (await ack(player, 'room:action', { type: 'character', character: character('coc') })).ok,
    ).toBe(false);
    for (const value of [
      { type: 'start' },
      { type: 'scene', title: '篡改', description: '' },
      { type: 'mode', mode: 'external' },
      { type: 'kick', memberId: h.session.memberId },
      { type: 'transfer-host', memberId: h.session.memberId },
    ])
      expect((await ack(player, 'room:action', value)).ok).toBe(false);
    expect(
      (
        await ack(player, 'room:action', {
          type: 'start',
          memberId: h.session.memberId,
          role: 'host',
        })
      ).ok,
    ).toBe(false);
  });

  it('开始后锁定加入与完整载卡；允许本人修改资源和物品', async () => {
    const { url } = await setup();
    const { host, player, hostConnection, playerConnection } = await activeRoom(url);
    const outsider = await client(url);
    expect(
      (
        await ack(outsider, 'room:join', {
          code: hostConnection.room.code,
          nickname: '迟到者',
          rule: 'dnd',
        })
      ).ok,
    ).toBe(false);
    expect(
      (await ack(player, 'room:action', { type: 'character', character: character() })).ok,
    ).toBe(false);
    expect((await ack(player, 'room:action', { type: 'pause' })).ok).toBe(false);
    expect(
      (
        await ack(player, 'room:action', {
          type: 'resource',
          memberId: hostConnection.session.memberId,
          resource: 'hp',
          value: 1,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await ack(player, 'room:action', {
          type: 'resource',
          memberId: playerConnection.session.memberId,
          resource: 'hp',
          value: 13,
        })
      ).ok,
    ).toBe(false);
    await action(player, {
      type: 'resource',
      memberId: playerConnection.session.memberId,
      resource: 'hp',
      value: 7,
    });
    await action(player, {
      type: 'item-add',
      memberId: playerConnection.session.memberId,
      item: { id: 'torch', name: '火把', quantity: 2, notes: '' },
    });
    const updated = await success<RoomConnection>(player, 'room:resume', playerConnection.session);
    expect(
      updated.room.members.find((m) => m.id === playerConnection.session.memberId)?.character,
    ).toMatchObject({ hp: 7, items: [{ name: '火把' }] });
    await action(host, { type: 'pause' });
    expect(
      (
        await success<RoomConnection>(host, 'room:resume', hostConnection.session)
      ).room.members.every((m) => !m.ready),
    ).toBe(true);
  });

  it('主持人暗骰广播遮罩行为，重连后的结果仍被隐藏', async () => {
    const { url } = await setup();
    const host = await client(url),
      player = await client(url);
    const h = await create(host),
      p = await joinRoom(player, h.room.code);
    const observed = nextState(player);
    await action(host, { type: 'roll', expression: '1d20+2', visibility: 'host' });
    expect((await observed).log.at(-1)).toMatchObject({
      type: 'roll',
      secret: { label: '1d20+2' },
      content: '1d20+2 = ？ · 结果 ？',
    });
    expect(
      (await ack(player, 'room:action', { type: 'roll', expression: '1d6', visibility: 'host' }))
        .ok,
    ).toBe(false);
    const hostView = await success<RoomConnection>(host, 'room:resume', h.session);
    expect(hostView.room.log.at(-1)?.roll?.total).toBe(13);
    player.disconnect();
    const restoredPlayer = await client(url);
    expect(
      (await success<RoomConnection>(restoredPlayer, 'room:resume', p.session)).room.log.some(
        (e) => e.type === 'roll' && !!e.secret && !e.roll,
      ),
    ).toBe(true);
    const badClient = await client(url);
    expect((await ack(badClient, 'room:resume', { ...h.session, token: '0'.repeat(64) })).ok).toBe(
      false,
    );
    expect(
      (await ack(badClient, 'room:resume', { ...h.session, memberId: p.session.memberId })).ok,
    ).toBe(false);
    expect(
      (await ack(badClient, 'room:action', { type: 'scene', title: '盗用', description: '' })).ok,
    ).toBe(false);
  });

  it('外部通讯模式拒绝房内消息，公开掷骰依旧可用', async () => {
    const { url } = await setup();
    const { host, player } = await activeRoom(url, 'external');
    expect((await ack(player, 'room:action', { type: 'message', content: '不应保存' })).ok).toBe(
      false,
    );
    const rolled = nextState(player, (room) => room.log.some((e) => e.type === 'roll'));
    await action(host, { type: 'roll', expression: '2d6', visibility: 'public' });
    expect((await rolled).log.at(-1)?.roll?.groups[0]?.rolls).toEqual([4, 4]);
    expect((await ack(host, 'room:action', { type: 'mode', mode: 'in-room' })).ok).toBe(false);
  });

  it('CoC7 检定由服务端生成，玩家不能提交结果或私密检定', async () => {
    const { url } = await setup();
    const host = await client(url),
      player = await client(url);
    const h = await create(host, 'coc'),
      p = await joinRoom(player, h.room.code, 'coc');
    await action(player, { type: 'character', character: character('coc') });
    const check = { kind: 'skill', key: 'spotHidden', dc: 0, modifier: 0, edge: 'normal' } as const;
    const state = nextState(host, (room) => room.log.some((event) => event.type === 'check'));
    await action(player, { type: 'check', check, visibility: 'public' });
    const event = (await state).log.at(-1)!;
    expect(event.check?.selected).toBe(55);
    expect(event.check?.target).toBe(character('coc').skills.spotHidden);
    expect(event.check?.success).toBe(55 <= character('coc').skills.spotHidden);
    expect(event.memberId).toBe(p.session.memberId);
    const monsterCheck = nextState(host, (room) => room.log.at(-1)?.check?.target === 180);
    await action(host, { type: 'check', check: { ...check, target: 180 }, visibility: 'public' });
    expect((await monsterCheck).log.at(-1)?.check).toMatchObject({
      target: 180,
      selected: 55,
      outcome: '困难成功',
    });
    expect(
      (await ack(player, 'room:action', { type: 'check', check, visibility: 'host' })).ok,
    ).toBe(false);
    expect(
      (
        await ack(player, 'room:action', {
          type: 'check',
          check,
          visibility: 'public',
          result: { selected: 1 },
        })
      ).ok,
    ).toBe(false);
  });

  it('主持权转移只限在线席位，旧主持人失去权限且全员重置准备', async () => {
    const { url } = await setup();
    const host = await client(url),
      player = await client(url);
    const h = await create(host),
      p = await joinRoom(player, h.room.code);
    await action(host, { type: 'ready', ready: true });
    await action(player, { type: 'character', character: character() });
    await action(player, { type: 'ready', ready: true });
    const offline = nextState(
      host,
      (room) => !room.members.find((m) => m.id === p.session.memberId)?.online,
    );
    player.disconnect();
    await offline;
    expect(
      (await ack(host, 'room:action', { type: 'transfer-host', memberId: p.session.memberId })).ok,
    ).toBe(false);
    const resumedPlayer = await client(url);
    await success<RoomConnection>(resumedPlayer, 'room:resume', p.session);
    await action(host, { type: 'transfer-host', memberId: p.session.memberId });
    expect(
      (await ack(host, 'room:action', { type: 'scene', title: '越权', description: '' })).ok,
    ).toBe(false);
    const room = (await success<RoomConnection>(resumedPlayer, 'room:resume', p.session)).room;
    expect(room.hostId).toBe(p.session.memberId);
    expect(room.members.every((m) => !m.ready)).toBe(true);
    expect((await ack(host, 'room:action', { type: 'ready', ready: true })).ok).toBe(false);
    expect(
      (
        await ack(resumedPlayer, 'room:action', {
          type: 'item-add',
          memberId: p.session.memberId,
          item: { id: '__proto__', name: '', quantity: -1, notes: '' },
        })
      ).ok,
    ).toBe(false);
  });

  it('同一席位多个连接直到最后断开才离线，主持人断线不转移角色', async () => {
    const { url } = await setup();
    const host = await client(url),
      player = await client(url);
    const h = await create(host),
      p = await joinRoom(player, h.room.code);
    const second = await client(url);
    await success<RoomConnection>(second, 'room:resume', p.session);
    const firstDisconnect = nextState(host);
    player.disconnect();
    expect((await firstDisconnect).members.find((m) => m.id === p.session.memberId)?.online).toBe(
      true,
    );
    const finalDisconnect = nextState(
      host,
      (room) => !room.members.find((m) => m.id === p.session.memberId)?.online,
    );
    second.disconnect();
    expect((await finalDisconnect).hostId).toBe(h.session.memberId);
    const newPlayer = await client(url);
    await success<RoomConnection>(newPlayer, 'room:resume', p.session);
    const hostOffline = nextState(
      newPlayer,
      (room) => !room.members.find((m) => m.id === h.session.memberId)?.online,
    );
    host.disconnect();
    expect((await hostOffline).hostId).toBe(h.session.memberId);
  });

  it('移除席位撤销令牌，主持人主动离开会转交并返回准备阶段', async () => {
    const { url } = await setup();
    const host = await client(url),
      player = await client(url);
    const h = await create(host),
      p = await joinRoom(player, h.room.code);
    const left = new Promise<{ reason: string }>((resolve) => player.once('room:left', resolve));
    await action(host, { type: 'kick', memberId: p.session.memberId });
    expect((await left).reason).toContain('移出');
    expect((await ack(player, 'room:resume', p.session)).ok).toBe(false);
    const p2 = await joinRoom(player, h.room.code);
    const transferred = nextState(player, (room) => room.hostId === p2.session.memberId);
    await action(host, { type: 'leave' });
    expect((await transferred).members[0]).toMatchObject({ role: 'host', ready: false });
    await action(player, { type: 'scene', title: '新主持', description: '允许编辑' });
  });

  it('重启后读回房间与暗骰，旧令牌可恢复且在线状态重置', async () => {
    const first = await setup();
    const host = await client(first.url),
      player = await client(first.url);
    const h = await create(host),
      p = await joinRoom(player, h.room.code);
    await action(host, { type: 'roll', expression: '1d6', visibility: 'host' });
    await first.server.close();
    servers.splice(servers.indexOf(first.server), 1);
    const second = await setup({ dataDir: first.dataDir });
    const resumedHost = await client(second.url);
    const h2 = await success<RoomConnection>(resumedHost, 'room:resume', h.session);
    expect(h2.room.log.some((e) => e.visibility === 'host')).toBe(true);
    expect(h2.room.members.find((m) => m.id === p.session.memberId)?.online).toBe(false);
    const resumedPlayer = await client(second.url);
    expect(
      (await success<RoomConnection>(resumedPlayer, 'room:resume', p.session)).room.log.every(
        (e) => e.visibility === 'public' || (!!e.secret && !e.roll && !e.check),
      ),
    ).toBe(true);
    const persisted = JSON.parse(readFileSync(join(first.dataDir, 'rooms.json'), 'utf8'));
    expect(persisted[0].tokens[h.session.memberId]).toBe(h.session.token);
  });

  it('拒绝不符合角色卡格式的物品编号，合法物品在重启后保留', async () => {
    const first = await setup();
    const host = await client(first.url),
      player = await client(first.url);
    const h = await create(host),
      p = await joinRoom(player, h.room.code);
    await action(player, { type: 'character', character: character() });
    const baseItem = { name: '旅途补给', quantity: 2, notes: '保存在人物卡中' };
    for (const invalidId of ['含中文', 'item/invalid', 'a'.repeat(81), '']) {
      expect(
        (
          await ack(player, 'room:action', {
            type: 'item-add',
            memberId: p.session.memberId,
            item: { ...baseItem, id: invalidId },
          })
        ).ok,
      ).toBe(false);
    }
    const item = { ...baseItem, id: `item_${'a'.repeat(74)}-` };
    expect(item.id).toHaveLength(80);
    await action(player, { type: 'item-add', memberId: p.session.memberId, item });
    await first.server.close();
    servers.splice(servers.indexOf(first.server), 1);
    const second = await setup({ dataDir: first.dataDir });
    const resumedPlayer = await client(second.url);
    const restored = await success<RoomConnection>(resumedPlayer, 'room:resume', p.session);
    expect(
      restored.room.members.find((member) => member.id === p.session.memberId)?.character?.items,
    ).toEqual([item]);
  });

  it('合法的二十五组骰子结果在重启后完整恢复', async () => {
    const first = await setup();
    const host = await client(first.url);
    const h = await create(host);
    const expression = Array.from({ length: 25 }, () => 'd2').join('+');
    await action(host, { type: 'roll', expression, visibility: 'public' });
    await first.server.close();
    servers.splice(servers.indexOf(first.server), 1);
    const second = await setup({ dataDir: first.dataDir });
    const resumedHost = await client(second.url);
    const restored = await success<RoomConnection>(resumedHost, 'room:resume', h.session);
    const roll = restored.room.log.find((event) => event.type === 'roll')?.roll;
    expect(roll?.expression).toBe(expression);
    expect(roll?.groups).toHaveLength(25);
    expect(
      roll?.groups.every((group) => group.count === 1 && group.sides === 2 && group.rolls[0] === 2),
    ).toBe(true);
    expect(roll?.total).toBe(50);
  });

  it('保存未分配完的草稿，但拒绝准备、审核通过和主持人加载玩家卡', async () => {
    const { url } = await setup();
    const host = await client(url),
      player = await client(url);
    const h = await create(host),
      p = await joinRoom(player, h.room.code);
    const draft = character();
    delete draft.creation;
    await action(player, { type: 'character', character: draft });
    expect((await ack(player, 'room:action', { type: 'ready', ready: true })).ok).toBe(false);
    expect((await ack(host, 'room:action', { type: 'character', character: character() })).ok).toBe(
      false,
    );
    const { room } = await success<RoomConnection>(player, 'room:resume', p.session);
    const member = room.members.find((m) => m.id === p.session.memberId)!;
    const review = {
      type: 'review-character',
      memberId: member.id,
      decision: 'approved',
      note: '',
      characterRevision: member.characterRevision,
      policyRevision: room.policyRevision,
    } as const;
    expect((await ack(player, 'room:action', review)).ok).toBe(false);
    expect((await ack(host, 'room:action', review)).ok).toBe(false);
    await action(host, { ...review, decision: 'changes', note: '请完成分配' });
    expect(
      (await success<RoomConnection>(player, 'room:resume', p.session)).room.members.find(
        (m) => m.id === member.id,
      )?.review.status,
    ).toBe('changes');
    expect(
      (
        await ack(player, 'room:action', {
          type: 'creation-policy',
          policy: h.room.creationPolicy,
          expectedRevision: 0,
        })
      ).ok,
    ).toBe(false);
  });

  it('完整保存、物品和资源变更使审核失效，版本过期的审批不能覆盖新卡', async () => {
    const { url } = await setup();
    const host = await client(url),
      player = await client(url);
    const h = await create(host),
      p = await joinRoom(player, h.room.code);
    await action(player, { type: 'character', character: character() });
    await action(player, { type: 'ready', ready: true });
    await approve(host, player, p.session);
    const approved = (
      await success<RoomConnection>(player, 'room:resume', p.session)
    ).room.members.find((m) => m.id === p.session.memberId)!;
    await action(player, { type: 'character', character: { ...character(), notes: '已修改' } });
    let current = (
      await success<RoomConnection>(player, 'room:resume', p.session)
    ).room.members.find((m) => m.id === p.session.memberId)!;
    expect(current.characterRevision).toBe(approved.characterRevision + 1);
    expect(current.review.status).toBe('pending');
    expect(current.ready).toBe(false);
    expect(
      (
        await ack(host, 'room:action', {
          type: 'review-character',
          memberId: p.session.memberId,
          decision: 'approved',
          note: '旧窗口',
          characterRevision: approved.characterRevision,
          policyRevision: 0,
        })
      ).ok,
    ).toBe(false);
    for (const mutation of [
      { type: 'resource', memberId: p.session.memberId, resource: 'hp', value: 8 },
      {
        type: 'item-add',
        memberId: p.session.memberId,
        item: { id: 'rope', name: '绳索', quantity: 1, notes: '' },
      },
      { type: 'item-remove', memberId: p.session.memberId, itemId: 'rope' },
    ] as RoomAction[]) {
      await approve(host, player, p.session);
      await action(player, { type: 'ready', ready: true });
      await action(player, mutation);
      current = (await success<RoomConnection>(player, 'room:resume', p.session)).room.members.find(
        (m) => m.id === p.session.memberId,
      )!;
      expect(current.review.status).toBe('pending');
      expect(current.ready).toBe(false);
    }
    await approve(host, player, p.session);
    await action(player, { type: 'ready', ready: true });
    await action(host, { type: 'ready', ready: true });
    await action(host, {
      type: 'creation-policy',
      policy: h.room.creationPolicy,
      expectedRevision: 0,
    });
    const changed = (await success<RoomConnection>(player, 'room:resume', p.session)).room;
    expect(changed.policyRevision).toBe(1);
    expect(changed.members.every((m) => !m.ready && m.review.status === 'pending')).toBe(true);
    expect(
      (
        await ack(host, 'room:action', {
          type: 'creation-policy',
          policy: h.room.creationPolicy,
          expectedRevision: 0,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await ack(host, 'room:action', {
          type: 'review-character',
          memberId: p.session.memberId,
          decision: 'approved',
          note: '',
          characterRevision: current.characterRevision,
          policyRevision: 0,
        })
      ).ok,
    ).toBe(false);
  });

  it('即使全员准备也必须审核才能开启，正式局内变更返回准备时重新审查', async () => {
    const { url } = await setup();
    const host = await client(url),
      player = await client(url);
    const h = await create(host),
      p = await joinRoom(player, h.room.code);
    await action(player, { type: 'character', character: character() });
    await action(player, { type: 'ready', ready: true });
    await action(host, { type: 'ready', ready: true });
    expect((await ack(host, 'room:action', { type: 'start' })).ok).toBe(false);
    await approve(host, player, p.session);
    await action(host, { type: 'start' });
    await action(player, {
      type: 'resource',
      memberId: p.session.memberId,
      resource: 'hp',
      value: 5,
    });
    await action(host, { type: 'pause' });
    const paused = (
      await success<RoomConnection>(player, 'room:resume', p.session)
    ).room.members.find((m) => m.id === p.session.memberId)!;
    expect(paused.character?.hp).toBe(5);
    expect(paused.ready).toBe(false);
    expect(paused.review.status).toBe('pending');
    await action(player, { type: 'ready', ready: true });
    await action(host, { type: 'ready', ready: true });
    expect((await ack(host, 'room:action', { type: 'start' })).ok).toBe(false);
  });

  it('主持人卡库独立保存，并在加入、广播、重连、移交及重启时只对当前主持人可见', async () => {
    const first = await setup();
    const host = await client(first.url);
    const h = await create(host, 'coc');
    expect(h.room.keeperCards).toEqual([]);
    const npc = { ...createKeeperCard('npc-bystander', { name: '秘密线人' }), notes: '主持人机密' };
    const monster = createKeeperCard('monster', { name: '秘密怪物' });
    await action(host, { type: 'keeper-save', cards: [npc, monster] });
    const player = await client(first.url),
      observer = await client(first.url);
    const p = await joinRoom(player, h.room.code, 'coc'),
      q = await joinRoom(observer, h.room.code, 'coc');
    expect(p.room.keeperCards).toEqual([]);
    expect(JSON.stringify(q.room)).not.toContain('主持人机密');
    await action(player, { type: 'character', character: character('coc') });
    await approve(host, player, p.session);
    const third = createKeeperCard('monster', { name: '另一个秘密怪物' });
    const hiddenUpdate = nextState(player);
    await action(host, { type: 'keeper-save', cards: [{ ...npc, name: '秘密线人更新' }, third] });
    expect((await hiddenUpdate).keeperCards).toEqual([]);
    expect(
      (await success<RoomConnection>(host, 'room:resume', h.session)).room.keeperCards,
    ).toHaveLength(3);
    await action(host, { type: 'keeper-delete', cardId: monster.id });
    expect((await ack(player, 'room:action', { type: 'keeper-save', cards: [third] })).ok).toBe(
      false,
    );
    expect((await ack(player, 'room:action', { type: 'keeper-delete', cardId: npc.id })).ok).toBe(
      false,
    );
    expect(
      (
        await ack(player, 'room:action', {
          type: 'keeper-save',
          cards: [third],
          memberId: h.session.memberId,
        })
      ).ok,
    ).toBe(false);
    const formerHost = nextState(host, (room) => room.hostId === p.session.memberId);
    await action(host, { type: 'transfer-host', memberId: p.session.memberId });
    const formerView = await formerHost;
    expect(formerView.keeperCards).toEqual([]);
    expect(JSON.stringify(formerView)).not.toContain('秘密线人');
    expect(formerView.members.every((m) => !m.ready && m.review.status === 'pending')).toBe(true);
    const newHost = (await success<RoomConnection>(player, 'room:resume', p.session)).room;
    expect(newHost.keeperCards.map((card) => card.id)).toEqual([npc.id, third.id]);
    expect(newHost.members.find((m) => m.id === p.session.memberId)?.character?.name).toBe('艾琳');
    expect(
      (await ack(player, 'room:action', { type: 'character', character: character('coc') })).ok,
    ).toBe(false);
    expect(
      (
        await ack(player, 'room:action', {
          type: 'resource',
          memberId: p.session.memberId,
          resource: 'hp',
          value: 1,
        })
      ).ok,
    ).toBe(false);
    expect((await ack(host, 'room:action', { type: 'keeper-delete', cardId: npc.id })).ok).toBe(
      false,
    );
    await first.server.close();
    servers.splice(servers.indexOf(first.server), 1);
    const second = await setup({ dataDir: first.dataDir });
    const resumedFormerHost = await client(second.url),
      resumedHost = await client(second.url),
      resumedObserver = await client(second.url);
    expect(
      (await success<RoomConnection>(resumedFormerHost, 'room:resume', h.session)).room.keeperCards,
    ).toEqual([]);
    expect(
      (await success<RoomConnection>(resumedObserver, 'room:resume', q.session)).room.keeperCards,
    ).toEqual([]);
    expect(
      (await success<RoomConnection>(resumedHost, 'room:resume', p.session)).room.keeperCards,
    ).toHaveLength(2);
    const inherited = nextState(resumedFormerHost, (room) => room.hostId === h.session.memberId);
    await action(resumedHost, { type: 'leave' });
    expect((await inherited).keeperCards).toHaveLength(2);
    expect(
      (await success<RoomConnection>(resumedObserver, 'room:resume', q.session)).room.keeperCards,
    ).toEqual([]);
  });

  it('卡库拒绝无效卡、重复编号、超额导入与 DND 房间，并支持大于旧512KiB的批量', async () => {
    const { url } = await setup();
    const host = await client(url);
    const h = await create(host, 'coc');
    const card = createKeeperCard('npc-bystander', { name: '批量线人' });
    expect(
      (await ack(host, 'room:action', { type: 'keeper-save', cards: [{ ...card, rule: 'dnd' }] }))
        .ok,
    ).toBe(false);
    expect((await ack(host, 'room:action', { type: 'keeper-save', cards: [card, card] })).ok).toBe(
      false,
    );
    const batch = Array.from({ length: 200 }, (_, index) => ({
      ...card,
      id: `npc-${index}`,
      notes: index < 40 ? '秘'.repeat(12000) : '',
    }));
    expect(Buffer.byteLength(JSON.stringify(batch))).toBeGreaterThan(512 * 1024);
    await action(host, { type: 'keeper-save', cards: batch });
    expect(
      (await success<RoomConnection>(host, 'room:resume', h.session)).room.keeperCards,
    ).toHaveLength(200);
    expect((await ack(host, 'room:action', { type: 'keeper-save', cards: [card] })).ok).toBe(false);
    expect(
      (await ack(host, 'room:action', { type: 'keeper-save', cards: [...batch, card] })).ok,
    ).toBe(false);
    expect(
      (await success<RoomConnection>(host, 'room:resume', h.session)).room.keeperCards,
    ).toHaveLength(200);
    const dndHost = await client(url);
    await create(dndHost);
    expect((await ack(dndHost, 'room:action', { type: 'keeper-save', cards: [card] })).ok).toBe(
      false,
    );
    expect((await ack(dndHost, 'room:action', { type: 'keeper-delete', cardId: card.id })).ok).toBe(
      false,
    );
    expect(
      (
        await ack(host, 'room:action', {
          type: 'creation-policy',
          policy: defaultCreationPolicy('dnd'),
          expectedRevision: 0,
        })
      ).ok,
    ).toBe(false);
  });

  it('限制人数、创建频率与载卡后的准备状态', async () => {
    const { url } = await setup();
    const host = await client(url);
    const h = await create(host);
    const members: Socket[] = [];
    for (let i = 0; i < 7; i++) {
      const socket = await client(url);
      await joinRoom(socket, h.room.code);
      members.push(socket);
    }
    const extra = await client(url);
    expect(
      (await ack(extra, 'room:join', { code: h.room.code, nickname: '第九人', rule: 'dnd' })).ok,
    ).toBe(false);
    const player = members[0]!;
    await action(player, { type: 'character', character: character() });
    await action(player, { type: 'ready', ready: true });
    const reset = nextState(
      host,
      (room) => !room.members.find((m) => m.character?.id === 'char-test')?.ready,
    );
    await action(player, { type: 'character', character: { ...character(), name: '换一张卡' } });
    expect((await reset).members.find((m) => m.character?.name === '换一张卡')?.ready).toBe(false);
    for (let i = 0; i < 9; i++) {
      const socket = await client(url);
      await create(socket);
    }
    expect(
      (
        await ack(extra, 'room:create', {
          name: '超额房间',
          nickname: '主持',
          rule: 'dnd',
          mode: 'in-room',
        })
      ).ok,
    ).toBe(false);
  });

  it('离线存档超过七天后过期，在线活动更新存档时间', async () => {
    let time = 1_800_000_000_000;
    const first = await setup({ now: () => time });
    const host = await client(first.url);
    const h = await create(host);
    await first.server.close();
    servers.splice(servers.indexOf(first.server), 1);
    time += 8 * 24 * 60 * 60 * 1000;
    const second = await setup({ dataDir: first.dataDir, now: () => time });
    const resumed = await client(second.url);
    expect((await ack(resumed, 'room:resume', h.session)).ok).toBe(false);
  });

  it('旧版正式房间迁移回准备阶段，保留卡片但要求重新分配和审核', async () => {
    const first = await setup();
    const { hostConnection: h, playerConnection: p } = await activeRoom(first.url);
    await first.server.close();
    servers.splice(servers.indexOf(first.server), 1);
    const path = join(first.dataDir, 'rooms.json');
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    const room = saved[0].room;
    delete room.creationPolicy;
    delete room.policyRevision;
    delete room.keeperCards;
    for (const member of room.members) {
      delete member.characterRevision;
      delete member.review;
      if (member.character) delete member.character.creation;
      member.ready = true;
    }
    writeFileSync(path, JSON.stringify(saved));
    const second = await setup({ dataDir: first.dataDir });
    const host = await client(second.url),
      player = await client(second.url);
    await success<RoomConnection>(host, 'room:resume', h.session);
    const restored = await success<RoomConnection>(player, 'room:resume', p.session);
    expect(restored.room.phase).toBe('lobby');
    expect(restored.room.keeperCards).toEqual([]);
    expect(restored.room.creationPolicy.rule).toBe('dnd');
    expect(restored.room.members.every((m) => !m.ready && m.review.status === 'pending')).toBe(
      true,
    );
    expect(restored.room.members.find((m) => m.id === p.session.memberId)?.character?.name).toBe(
      '艾琳',
    );
    expect((await ack(player, 'room:action', { type: 'ready', ready: true })).ok).toBe(false);
    expect((await ack(host, 'room:action', { type: 'start' })).ok).toBe(false);
  });

  it('开局重验人物卡，存档中伪造的通过和准备标记不能绕过分配规则', async () => {
    const first = await setup();
    const { host, hostConnection: h, playerConnection: p } = await activeRoom(first.url);
    await action(host, { type: 'pause' });
    await first.server.close();
    servers.splice(servers.indexOf(first.server), 1);
    const path = join(first.dataDir, 'rooms.json');
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    for (const member of saved[0].room.members) {
      member.ready = true;
      member.review.status = 'approved';
      member.review.reviewedAt = new Date().toISOString();
      if (member.character) delete member.character.creation;
    }
    writeFileSync(path, JSON.stringify(saved));
    const second = await setup({ dataDir: first.dataDir });
    const resumedHost = await client(second.url),
      resumedPlayer = await client(second.url);
    await success<RoomConnection>(resumedHost, 'room:resume', h.session);
    await success<RoomConnection>(resumedPlayer, 'room:resume', p.session);
    expect((await ack(resumedHost, 'room:action', { type: 'start' })).ok).toBe(false);
  });

  it('跳过结构损坏和已过期的存档', async () => {
    const first = await setup({ now: () => 1_800_000_000_000 });
    const host = await client(first.url);
    const h = await create(host);
    await first.server.close();
    servers.splice(servers.indexOf(first.server), 1);
    const saved = JSON.parse(readFileSync(join(first.dataDir, 'rooms.json'), 'utf8'));
    saved[0].room.mode = 'invalid';
    writeFileSync(join(first.dataDir, 'rooms.json'), JSON.stringify(saved));
    const second = await setup({ dataDir: first.dataDir });
    const resume = await client(second.url);
    expect((await ack(resume, 'room:resume', h.session)).ok).toBe(false);
  });
});

describe('主持人灵感服务', () => {
  const request = (url: string, session: Session, prompt = '让旅店里出现一个线索') =>
    fetch(`${url}/api/inspiration`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ roomCode: session.roomCode, memberId: session.memberId, prompt }),
    });
  it('未配置时明确返回 503，并拒绝玩家与无效凭证', async () => {
    const { url } = await setup({ geminiKey: '' });
    const host = await client(url),
      player = await client(url);
    const h = await create(host),
      p = await joinRoom(player, h.room.code);
    expect(await (await fetch(`${url}/api/status`)).json()).toEqual({ aiConfigured: false });
    expect((await request(url, h.session)).status).toBe(503);
    expect((await request(url, p.session)).status).toBe(403);
    expect((await request(url, { ...h.session, token: '0'.repeat(64) })).status).toBe(401);
  });

  it('只在显式请求时调用 Gemini，过滤私密日志并校验结构和频率', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init: init! });
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      suggestion: '柜台下藏着一封信。',
                      example: '老板悄悄将信推到你面前。',
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const { url } = await setup({ geminiKey: 'test-key', fetch: fakeFetch });
    const host = await client(url);
    const h = await create(host);
    await action(host, { type: 'scene', title: '余烬旅店', description: '风雨之夜' });
    await action(host, { type: 'roll', expression: '1d20', visibility: 'host' });
    expect(calls).toHaveLength(0);
    const response = await request(url, h.session, '主持私有便笺');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      suggestion: '柜台下藏着一封信。',
      example: '老板悄悄将信推到你面前。',
    });
    expect(calls).toHaveLength(1);
    expect(new Headers(calls[0]!.init.headers).get('x-goog-api-key')).toBe('test-key');
    const body = JSON.parse(calls[0]!.init.body as string);
    const prompt = JSON.parse(body.contents[0].parts[0].text);
    expect(prompt.context).toMatchObject({ scene: { title: '余烬旅店' }, recentMessages: [] });
    expect((await request(url, h.session)).status).toBe(429);
    const view = await success<RoomConnection>(host, 'room:resume', h.session);
    expect(
      view.room.log.some((e) => e.content.includes('主持私有便笺') || e.content.includes('柜台下')),
    ).toBe(false);
  });

  it('不转发上游错误、密钥或无效模型输出', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ error: 'secret test-key detail' }), { status: 403 });
    const { url } = await setup({ geminiKey: 'test-key', fetch: fakeFetch });
    const host = await client(url);
    const h = await create(host);
    const response = await request(url, h.session);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('test-key');
  });
});
