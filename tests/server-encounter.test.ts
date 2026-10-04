import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { defaultCreationPolicy, suggestAllocation } from '../shared/creation.ts';
import { createDndStatBlock } from '../shared/dnd.ts';
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
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), 'interlude-encounter-'));
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

const snapshot = async (socket: Socket, session: Session) =>
  (await success<RoomConnection>(socket, 'room:resume', session)).room;
const rejected = async (socket: Socket, value: unknown) => {
  const result = await ack(socket, 'room:action', value);
  expect(result.ok).toBe(false);
  return !result.ok ? result.error : '';
};
async function pair(rule: 'dnd' | 'coc' = 'dnd') {
  const environment = await setup();
  const host = await client(environment.url),
    player = await client(environment.url);
  const h = await create(host, rule),
    p = await joinRoom(player, h.room.code, rule);
  return { ...environment, host, player, h, p };
}

describe('authoritative encounter and private D&D library', () => {
  it('filters private libraries and hidden NPCs from join, resume and raw broadcast payloads', async () => {
    const { url, host, player, h, p } = await pair();
    const secret = {
      ...createDndStatBlock('npc-bridge-guard'),
      name: '真实秘密名字',
      notes: '私密线索',
      spellcasting: '秘密法术',
    };
    const broadcasts: Room[] = [];
    player.on('room:state', (room) => broadcasts.push(room));
    await action(host, { type: 'dnd-save', cards: [secret] });
    await action(host, { type: 'encounter-add', cardId: secret.id, count: 2 });
    const room = await snapshot(host, h.session);
    expect(room.dndCards).toHaveLength(1);
    expect(room.encounter.participants).toHaveLength(2);
    expect((await snapshot(player, p.session)).encounter.participants).toEqual([]);
    const another = await client(url);
    const joined = await joinRoom(another, h.room.code);
    expect(JSON.stringify(joined.room)).not.toContain(secret.id);
    const first = room.encounter.participants[0];
    await action(host, {
      type: 'encounter-update',
      combatantId: first.id,
      expectedRevision: room.encounter.revision,
      patch: {
        revealed: true,
        publicName: '桥头守卫',
        notes: '参战私密备注',
        concentration: '隐秘专注',
        tempHp: 3,
      },
    });
    const visible = await snapshot(player, p.session);
    expect(visible.encounter.participants).toHaveLength(1);
    expect(visible.encounter.participants[0]).toMatchObject({
      name: '桥头守卫',
      source: null,
      sourceCardId: null,
      hp: null,
      maxHp: null,
      dex: null,
      ac: null,
      notes: '',
      concentration: '',
      tempHp: 0,
      abilities: [],
    });
    for (const state of broadcasts) {
      expect(JSON.stringify(state)).not.toMatch(
        /真实秘密名字|私密线索|秘密法术|参战私密备注|隐秘专注/,
      );
      expect(state.dndCards).toEqual([]);
    }
  });

  it('rejects player impersonation, malformed payloads, wrong-rule operations and duplicate card IDs', async () => {
    const { host, player } = await pair();
    const card = createDndStatBlock();
    for (const value of [
      { type: 'dnd-save', cards: [card] },
      { type: 'dnd-delete', cardId: card.id },
      { type: 'encounter-add', cardId: card.id, count: 1 },
      { type: 'encounter-clear' },
      { type: 'encounter-remove', combatantId: 'unknown' },
      { type: 'encounter-update', combatantId: 'unknown', expectedRevision: 0, patch: { hp: 0 } },
      {
        type: 'coc-melee',
        attacker: 'a',
        defender: 'b',
        attackSkill: 50,
        defenseSkill: 50,
        defense: 'dodge',
        attackEdge: 'normal',
        defenseEdge: 'normal',
        visibility: 'public',
      },
    ])
      expect(await rejected(player, value)).toContain('主持人');
    await rejected(player, { type: 'dnd-save', cards: [card], role: 'host' });
    await rejected(host, { type: 'dnd-save', cards: [card, card] });
    await rejected(host, { type: 'dnd-save', cards: [{ ...card, extra: 'smuggled' }] });
    await rejected(host, { type: 'dnd-save', cards: [createKeeperCard('npc-bystander')] });
    expect(
      await rejected(host, { type: 'keeper-save', cards: [createKeeperCard('npc-bystander')] }),
    ).toContain('CoC');
    const coc = await pair('coc');
    expect(await rejected(coc.host, { type: 'dnd-save', cards: [card] })).toContain('D&D');
    expect(
      await rejected(host, {
        type: 'coc-melee',
        attacker: 'a',
        defender: 'b',
        attackSkill: 50,
        defenseSkill: 50,
        defense: 'dodge',
        attackEdge: 'normal',
        defenseEdge: 'normal',
        visibility: 'public',
      }),
    ).toContain('CoC');
  });

  it('keeps cloned NPC HP, conditions and ability counters independent of siblings and templates', async () => {
    const { host, h } = await pair();
    const card = createDndStatBlock('npc-bridge-guard');
    card.actions[0].uses = 3;
    await action(host, { type: 'dnd-save', cards: [card] });
    await action(host, { type: 'encounter-add', cardId: card.id, count: 2 });
    let room = await snapshot(host, h.session);
    const [first, second] = room.encounter.participants;
    expect(first.id).not.toBe(second.id);
    const abilities = first.abilities.map((a) => ({ ...a, remaining: 1 }));
    await action(host, {
      type: 'encounter-update',
      combatantId: first.id,
      expectedRevision: room.encounter.revision,
      patch: { hp: 1, conditions: ['倒地'], abilities },
    });
    await action(host, {
      type: 'dnd-save',
      cards: [{ ...card, name: '后续新模板', hp: 2, maxHp: 2 }],
    });
    await action(host, { type: 'dnd-delete', cardId: card.id });
    room = await snapshot(host, h.session);
    expect(room.dndCards).toEqual([]);
    expect(room.encounter.participants[0]).toMatchObject({ hp: 1, conditions: ['倒地'] });
    expect(room.encounter.participants[1]).toMatchObject({ hp: card.hp, conditions: [] });
    expect(room.encounter.participants[0].abilities[0].remaining).toBe(1);
    expect(room.encounter.participants[1].abilities[0].remaining).toBe(3);
    expect(room.encounter.participants[0].source?.name).toBe(card.name);
  });

  it('synchronizes player HP both ways, invalidates lobby review and rejects stale or base-stat patches', async () => {
    const { host, player, h, p } = await pair();
    await action(player, { type: 'character', character: character() });
    await approve(host, player, p.session);
    await action(player, { type: 'ready', ready: true });
    let room = await snapshot(host, h.session);
    const revision = room.encounter.revision;
    await action(host, {
      type: 'encounter-update',
      combatantId: p.session.memberId,
      expectedRevision: revision,
      patch: { hp: 1 },
    });
    room = await snapshot(host, h.session);
    const m = room.members.find((m) => m.id === p.session.memberId)!;
    expect(m.character!.hp).toBe(1);
    expect(m.ready).toBe(false);
    expect(m.review.status).toBe('pending');
    expect(room.encounter.participants[0].hp).toBe(1);
    expect(
      await rejected(host, {
        type: 'encounter-update',
        combatantId: p.session.memberId,
        expectedRevision: revision,
        patch: { hp: 2 },
      }),
    ).toContain('更新');
    for (const patch of [
      { maxHp: 1000 },
      { dex: 30 },
      { hp: null },
      { name: '越权' },
      { hp: m.character!.maxHp + 1 },
    ])
      await rejected(host, {
        type: 'encounter-update',
        combatantId: p.session.memberId,
        expectedRevision: room.encounter.revision,
        patch,
      });
    await action(player, {
      type: 'resource',
      memberId: p.session.memberId,
      resource: 'hp',
      value: 2,
    });
    room = await snapshot(host, h.session);
    expect(room.encounter.participants[0].hp).toBe(2);
    await rejected(host, { type: 'encounter-remove', combatantId: p.session.memberId });
  });

  it('uses independent combatants in initiative and preserves the legacy player projection', async () => {
    const { url } = await setup();
    const { host, player, hostConnection: h, playerConnection: p } = await activeRoom(url);
    const card = createDndStatBlock('npc-bridge-guard');
    await action(host, { type: 'dnd-save', cards: [card] });
    await action(host, { type: 'encounter-add', cardId: card.id, count: 2 });
    let room = await snapshot(host, h.session);
    const npc = room.encounter.participants.find((c) => c.memberId === null)!;
    await action(host, {
      type: 'encounter-update',
      combatantId: npc.id,
      expectedRevision: room.encounter.revision,
      patch: { initiativeOverride: 100 },
    });
    await action(host, { type: 'initiative' });
    room = await snapshot(host, h.session);
    expect(room.encounter.activeId).toBe(npc.id);
    expect(room.encounter.participants).toHaveLength(3);
    expect(room.initiative).toEqual([{ memberId: p.session.memberId, value: 13 }]);
    expect(room.round).toBe(1);
    const privateTurn = await snapshot(player, p.session);
    expect(privateTurn.encounter.activeId).toBeNull();
    for (let i = 0; i < 3; i++) await action(host, { type: 'next-turn' });
    expect((await snapshot(host, h.session)).round).toBe(2);
  });

  it('hands private libraries and NPC progress to the new host and removes promoted or departed players', async () => {
    const { host, player, h, p } = await pair();
    const card = { ...createDndStatBlock('npc-bridge-guard'), notes: '主持人秘密' };
    await action(player, { type: 'character', character: character() });
    await action(host, { type: 'dnd-save', cards: [card] });
    await action(host, { type: 'encounter-add', cardId: card.id, count: 1 });
    let room = await snapshot(host, h.session);
    const npc = room.encounter.participants.find((c) => c.memberId === null)!;
    await action(host, {
      type: 'encounter-update',
      combatantId: npc.id,
      expectedRevision: room.encounter.revision,
      patch: { hp: 1 },
    });
    await action(host, { type: 'transfer-host', memberId: p.session.memberId });
    room = await snapshot(player, p.session);
    expect(room.dndCards[0].notes).toBe('主持人秘密');
    expect(room.encounter.participants).toHaveLength(1);
    expect(room.encounter.participants[0].hp).toBe(1);
    expect(room.members.find((m) => m.id === p.session.memberId)!.character).not.toBeNull();
    expect(JSON.stringify(await snapshot(host, h.session))).not.toContain('主持人秘密');
    await rejected(host, { type: 'dnd-delete', cardId: card.id });
    await action(host, { type: 'character', character: character() });
    expect((await snapshot(player, p.session)).encounter.participants).toHaveLength(2);
    await action(host, { type: 'leave' });
    expect((await snapshot(player, p.session)).encounter.participants).toHaveLength(1);
  });

  it('preserves templates, independent HP and player privacy over restart', async () => {
    const { host, player, h, p, server, dataDir } = await pair();
    const card = { ...createDndStatBlock('npc-bridge-guard'), notes: '重启秘密' };
    await action(host, { type: 'dnd-save', cards: [card] });
    await action(host, { type: 'encounter-add', cardId: card.id, count: 2 });
    let room = await snapshot(host, h.session);
    await action(host, {
      type: 'encounter-update',
      combatantId: room.encounter.participants[0].id,
      expectedRevision: room.encounter.revision,
      patch: { hp: 1 },
    });
    host.disconnect();
    player.disconnect();
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    const restarted = await setup({ dataDir });
    const newHost = await client(restarted.url),
      newPlayer = await client(restarted.url);
    room = await snapshot(newHost, h.session);
    expect(room.dndCards).toHaveLength(1);
    expect(room.encounter.participants.map((c) => c.hp)).toEqual([1, card.hp]);
    expect(room.members.find((m) => m.id === p.session.memberId)!.online).toBe(false);
    expect(JSON.stringify(await snapshot(newPlayer, p.session))).not.toContain('重启秘密');
  });

  it('migrates newly added fields without resetting active phase, approval or the CoC private library', async () => {
    const { url, server, dataDir } = await setup();
    const { host, player, hostConnection: h, playerConnection: p } = await activeRoom(url);
    host.disconnect();
    player.disconnect();
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    const saved = JSON.parse(readFileSync(join(dataDir, 'rooms.json'), 'utf8'));
    delete saved[0].room.dndCards;
    delete saved[0].room.encounter;
    writeFileSync(join(dataDir, 'rooms.json'), JSON.stringify(saved));
    const restarted = await setup({ dataDir });
    const newHost = await client(restarted.url);
    const room = await snapshot(newHost, h.session);
    expect(room.phase).toBe('active');
    expect(room.members.find((m) => m.id === p.session.memberId)!.review.status).toBe('approved');
    expect(room.dndCards).toEqual([]);
    expect(room.encounter.participants).toEqual([]);
    // Independently exercise existing CoC templates under the same migration.
    const coc = await pair('coc');
    const card = createKeeperCard('npc-bystander');
    await action(coc.host, { type: 'keeper-save', cards: [card] });
    await coc.server.close();
    servers.splice(servers.indexOf(coc.server), 1);
    const cocSaved = JSON.parse(readFileSync(join(coc.dataDir, 'rooms.json'), 'utf8'));
    delete cocSaved[0].room.dndCards;
    delete cocSaved[0].room.encounter;
    writeFileSync(join(coc.dataDir, 'rooms.json'), JSON.stringify(cocSaved));
    const cocRestart = await setup({ dataDir: coc.dataDir });
    const cocHost = await client(cocRestart.url);
    expect((await snapshot(cocHost, coc.h.session)).keeperCards[0].id).toBe(card.id);
  });

  it.each(['rule', 'member', 'duplicate', 'active'] as const)(
    'rejects corrupted saved combatant %s instead of broadcasting it',
    async (corruption) => {
      const { host, player, h, p, server, dataDir } = await pair();
      const card = createDndStatBlock('npc-bridge-guard');
      await action(host, { type: 'dnd-save', cards: [card] });
      await action(host, { type: 'encounter-add', cardId: card.id, count: 1 });
      host.disconnect();
      player.disconnect();
      await server.close();
      servers.splice(servers.indexOf(server), 1);
      const saved = JSON.parse(readFileSync(join(dataDir, 'rooms.json'), 'utf8'));
      const encounter = saved[0].room.encounter;
      if (corruption === 'rule') encounter.participants[0].rule = 'coc';
      if (corruption === 'member') {
        encounter.participants[0] = {
          ...encounter.participants[0],
          id: 'missing-member',
          kind: 'player',
          memberId: 'missing-member',
          source: null,
          sourceCardId: null,
        };
      }
      if (corruption === 'duplicate') encounter.participants.push(encounter.participants[0]);
      if (corruption === 'active') encounter.activeId = 'missing-active';
      writeFileSync(join(dataDir, 'rooms.json'), JSON.stringify(saved));
      const restarted = await setup({ dataDir });
      const socket = await client(restarted.url);
      expect((await ack(socket, 'room:resume', h.session)).ok).toBe(false);
      expect((await ack(socket, 'room:resume', p.session)).ok).toBe(false);
    },
  );

  it('enforces batch and encounter count limits atomically and clear advances revision', async () => {
    const { host, h } = await pair();
    const card = createDndStatBlock('npc-bridge-guard');
    await action(host, { type: 'dnd-save', cards: [card] });
    for (const count of [0, 21, 1.5])
      await rejected(host, { type: 'encounter-add', cardId: card.id, count });
    for (let i = 0; i < 3; i++)
      await action(host, { type: 'encounter-add', cardId: card.id, count: 20 });
    let room = await snapshot(host, h.session);
    expect(room.encounter.participants).toHaveLength(60);
    await rejected(host, { type: 'encounter-add', cardId: card.id, count: 1 });
    expect((await snapshot(host, h.session)).encounter.participants).toHaveLength(60);
    await rejected(host, {
      type: 'dnd-save',
      cards: Array.from({ length: 201 }, (_, i) => ({ ...card, id: `batch-${i}` })),
    });
    expect((await snapshot(host, h.session)).dndCards).toHaveLength(1);
    const revision = room.encounter.revision;
    await action(host, { type: 'encounter-clear' });
    room = await snapshot(host, h.session);
    expect(room.encounter.participants).toEqual([]);
    expect(room.encounter.revision).toBeGreaterThan(revision);
  });

  it('CoC opposed checks respect hidden logs and only produce advice, with no automatic HP changes', async () => {
    const { host, player, h, p } = await pair('coc');
    const card = createKeeperCard('npc-bystander');
    await action(host, { type: 'keeper-save', cards: [card] });
    await action(host, { type: 'encounter-add', cardId: card.id, count: 2 });
    const before = await snapshot(host, h.session);
    const duel: RoomAction = {
      type: 'coc-melee',
      attacker: '进攻方',
      defender: '防守方',
      attackSkill: 80,
      defenseSkill: 20,
      defense: 'dodge',
      attackEdge: 'normal',
      defenseEdge: 'normal',
      visibility: 'host',
    };
    await action(host, duel);
    let room = await snapshot(host, h.session);
    const result = room.log.at(-1)!;
    expect(result.visibility).toBe('host');
    expect(result.content).toMatch(/55／80.*55／20.*不自动扣除 HP/);
    expect(room.encounter.participants.map((c) => c.hp)).toEqual(
      before.encounter.participants.map((c) => c.hp),
    );
    expect((await snapshot(player, p.session)).log.some((e) => e.id === result.id)).toBe(false);
    await action(host, { ...duel, visibility: 'public' });
    room = await snapshot(player, p.session);
    expect(room.log.at(-1)!.content).toContain('不自动扣除 HP');
    expect(JSON.stringify(room)).not.toContain(card.name);
  });
  it('rolls back character, HP, new instances and kicks when atomic persistence fails', async () => {
    const { host, player, h, p, dataDir } = await pair();
    const card = createDndStatBlock('npc-bridge-guard');
    await action(player, { type: 'character', character: character() });
    await action(host, { type: 'dnd-save', cards: [card] });
    const before = await snapshot(host, h.session);
    // Drain older broadcasts on this transport before observing failed writes.
    await snapshot(player, p.session);
    const beforeDisk = readFileSync(join(dataDir, 'rooms.json'), 'utf8');
    const blockingDirectory = join(dataDir, `rooms.json.${process.pid}.tmp`);
    mkdirSync(blockingDirectory);
    let broadcastCount = 0,
      leftCount = 0;
    player.on('room:state', () => broadcastCount++);
    player.on('room:left', () => leftCount++);
    const changes: Array<[Socket, RoomAction]> = [
      [player, { type: 'character', character: { ...character(), name: '失败的新名字' } }],
      [player, { type: 'resource', memberId: p.session.memberId, resource: 'hp', value: 1 }],
      [
        host,
        {
          type: 'encounter-update',
          combatantId: p.session.memberId,
          expectedRevision: before.encounter.revision,
          patch: { hp: 1 },
        },
      ],
      [host, { type: 'encounter-add', cardId: card.id, count: 2 }],
      [host, { type: 'kick', memberId: p.session.memberId }],
    ];
    try {
      for (const [socket, change] of changes)
        expect(await rejected(socket, change)).toContain('存档保存失败');
      expect(readFileSync(join(dataDir, 'rooms.json'), 'utf8')).toBe(beforeDisk);
      expect(broadcastCount).toBe(0);
      expect(leftCount).toBe(0);
    } finally {
      rmSync(blockingDirectory, { recursive: true });
    }
    expect(await snapshot(host, h.session)).toEqual(before);
    expect((await snapshot(player, p.session)).members).toHaveLength(2);
  });

  it('rejects overflowing player synchronization without changing the character or encounter', async () => {
    const { host, player, h, p } = await pair();
    const card = createDndStatBlock('npc-bridge-guard');
    await action(host, { type: 'dnd-save', cards: [card] });
    for (let i = 0; i < 3; i++)
      await action(host, { type: 'encounter-add', cardId: card.id, count: 20 });
    expect(await rejected(player, { type: 'character', character: character() })).toContain('60');
    const room = await snapshot(host, h.session);
    expect(room.members.find((m) => m.id === p.session.memberId)!.character).toBeNull();
    expect(room.encounter.participants).toHaveLength(60);
  });

  it('preserves large legal snapshot batches beyond incoming-action limits', async () => {
    const { host, h, dataDir } = await pair();
    const card = createDndStatBlock('npc-bridge-guard');
    card.actions = Array.from({ length: 50 }, (_, i) => ({
      ...card.actions[0],
      id: `action-${i}`,
      description: '大型资料'.repeat(750),
    }));
    await action(host, { type: 'dnd-save', cards: [card] });
    await action(host, { type: 'encounter-add', cardId: card.id, count: 20 });
    const room = await snapshot(host, h.session);
    expect(room.encounter.participants).toHaveLength(20);
    expect(Buffer.byteLength(JSON.stringify(room), 'utf8')).toBeGreaterThan(8 * 1024 * 1024);
    expect(
      JSON.parse(readFileSync(join(dataDir, 'rooms.json'), 'utf8'))[0].room.encounter.participants,
    ).toHaveLength(20);
  });

  it('keeps NPC turn progress through explicit host departure and automatically transfers private access', async () => {
    const { url } = await setup();
    const { host, player, hostConnection: h, playerConnection: p } = await activeRoom(url);
    const card = { ...createDndStatBlock('npc-bridge-guard'), notes: '继任私密资料' };
    await action(host, { type: 'dnd-save', cards: [card] });
    await action(host, { type: 'encounter-add', cardId: card.id, count: 1 });
    let room = await snapshot(host, h.session);
    const npc = room.encounter.participants.find((c) => c.memberId === null)!;
    await action(host, {
      type: 'encounter-update',
      combatantId: npc.id,
      expectedRevision: room.encounter.revision,
      patch: { hp: 1, initiativeOverride: 100 },
    });
    await action(host, { type: 'initiative' });
    await action(host, { type: 'leave' });
    room = await snapshot(player, p.session);
    expect(room.hostId).toBe(p.session.memberId);
    expect(room.phase).toBe('lobby');
    expect(room.encounter).toMatchObject({ activeId: npc.id, round: 1 });
    expect(room.encounter.participants).toHaveLength(1);
    expect(room.encounter.participants[0].hp).toBe(1);
    expect(room.dndCards[0].notes).toBe('继任私密资料');
  });

  it('correlates roll and check results with optional request IDs and preserves their privacy over restart', async () => {
    const { host, player, h, p, server, dataDir } = await pair();
    await action(host, {
      type: 'roll',
      expression: '1d20',
      visibility: 'host',
      requestId: 'private-roll',
    });
    await action(host, {
      type: 'check',
      check: { kind: 'ability', key: 'str', target: 10, dc: 10, modifier: 2, edge: 'normal' },
      visibility: 'public',
      requestId: 'public-check',
    });
    const room = await snapshot(host, h.session);
    expect(room.log.find((e) => e.requestId === 'private-roll')!.roll).toBeDefined();
    expect(room.log.find((e) => e.requestId === 'public-check')!.check).toBeDefined();
    const playerRoom = await snapshot(player, p.session);
    expect(playerRoom.log.some((e) => e.requestId === 'private-roll')).toBe(false);
    expect(playerRoom.log.some((e) => e.requestId === 'public-check')).toBe(true);
    await rejected(host, { type: 'roll', expression: '1d20', visibility: 'public', requestId: '' });
    host.disconnect();
    player.disconnect();
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    const restarted = await setup({ dataDir });
    const resumedHost = await client(restarted.url),
      resumedPlayer = await client(restarted.url);
    expect(
      (await snapshot(resumedHost, h.session)).log.some((e) => e.requestId === 'private-roll'),
    ).toBe(true);
    expect(
      (await snapshot(resumedPlayer, p.session)).log.some((e) => e.requestId === 'private-roll'),
    ).toBe(false);
  });
});
