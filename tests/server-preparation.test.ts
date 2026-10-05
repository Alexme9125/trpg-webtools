import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { createAppServer } from '../server/app';
import { parseAtlases } from '../shared/atlas';
import { ATLAS_IMPORT_TEMPLATE } from '../shared/atlas-guide';
import { roomConfiguration } from '../shared/room-config';
import { syncAllocation } from '../shared/creation';
import type { Ack, RoomAction, RoomConnection, Session } from '../shared/types';
import { preparedCharacter } from './fixtures/adjustment-character';

const sockets: Socket[] = [],
  servers: ReturnType<typeof createAppServer>[] = [],
  dirs: string[] = [];
async function server(
  dataDir = mkdtempSync(join(tmpdir(), 'interlude-preparation-')),
  imageDir = join(dataDir, 'custom-images'),
) {
  if (!dirs.includes(dataDir)) dirs.push(dataDir);
  const app = createAppServer({ dataDir, imageDir });
  servers.push(app);
  return { app, dataDir, imageDir, url: `http://127.0.0.1:${await app.listen()}` };
}
async function client(url: string) {
  const socket = io(url, { transports: ['websocket'], reconnection: false, forceNew: true });
  sockets.push(socket);
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
async function good<T>(socket: Socket, event: string, input: unknown) {
  const result = await ack<T>(socket, event, input);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
const act = (socket: Socket, input: RoomAction) => good(socket, 'room:action', input);
const state = async (socket: Socket, session: Session) =>
  (await good<RoomConnection>(socket, 'room:resume', session)).room;
async function bad(socket: Socket, input: unknown) {
  const r = await ack(socket, 'room:action', input);
  expect(r.ok).toBe(false);
  return r.ok ? '' : r.error;
}
async function setup(active = false) {
  const env = await server();
  const host = await client(env.url),
    player = await client(env.url);
  const h = await good<RoomConnection>(host, 'room:create', {
    name: '备团测试',
    nickname: 'KP',
    rule: 'coc',
    mode: 'in-room',
  });
  const p = await good<RoomConnection>(player, 'room:join', {
    code: h.room.code,
    nickname: '玩家',
    rule: 'coc',
  });
  await act(player, { type: 'character', character: preparedCharacter('coc') });
  const approve = async () => {
    const room = await state(host, h.session),
      m = room.members.find((m) => m.id === p.session.memberId)!;
    await act(host, {
      type: 'review-character',
      memberId: m.id,
      decision: 'approved',
      note: '',
      characterRevision: m.characterRevision,
      policyRevision: room.policyRevision,
    });
  };
  await approve();
  await act(host, { type: 'ready', ready: true });
  await act(player, { type: 'ready', ready: true });
  if (active) await act(host, { type: 'start' });
  return { ...env, host, player, h, p, approve };
}
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6szsAAAAASUVORK5CYII=';
const imageInput = () => ({
  name: '场景.png',
  mime: 'image/png',
  data: png,
  content: '看看这张地图',
  requestId: crypto.randomUUID(),
});
const headers = (s: Session) => ({
  authorization: `Bearer ${s.token}`,
  'x-interlude-member': s.memberId,
});
const upload = (url: string, s: Session, input: unknown = imageInput()) =>
  fetch(`${url}/api/rooms/${s.roomCode}/images`, {
    method: 'POST',
    headers: { ...headers(s), 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
const getImage = (url: string, s: Session, id: string) =>
  fetch(`${url}/api/rooms/${s.roomCode}/images/${id}`, { headers: headers(s) });
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.disconnect());
  for (const app of servers.splice(0)) await app.close();
  dirs.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }));
});

describe('private room atlases', () => {
  it('stores multiple scenes privately and publishes only a selected public scene', async () => {
    const { host, player, h, p } = await setup();
    const [atlas] = parseAtlases(ATLAS_IMPORT_TEMPLATE);
    await act(host, { type: 'atlas-save', atlases: [atlas] });
    expect((await state(player, p.session)).atlases).toEqual([]);
    await act(host, { type: 'atlas-publish', atlasId: atlas.id, sceneId: atlas.scenes[1].id });
    const visible = await state(player, p.session);
    expect(visible.scene).toEqual({
      title: atlas.scenes[1].title,
      description: atlas.scenes[1].description,
    });
    expect(JSON.stringify(visible)).not.toContain('守夜人');
    expect(visible.configRevision).toBe(1);
    expect((await state(host, h.session)).atlases).toEqual([atlas]);
    await act(host, { type: 'atlas-delete', atlasId: atlas.id });
    expect((await state(host, h.session)).scene).toEqual(visible.scene);
  });
  it('rejects player changes, mismatched rules, dangling references and duplicate batches atomically', async () => {
    const { host, player, h } = await setup();
    const [atlas] = parseAtlases(ATLAS_IMPORT_TEMPLATE);
    expect(await bad(player, { type: 'atlas-save', atlases: [atlas] })).toContain('主持人');
    expect(await bad(host, { type: 'atlas-save', atlases: [{ ...atlas, rule: 'dnd' }] })).toContain(
      '不匹配',
    );
    await bad(host, { type: 'atlas-save', atlases: [atlas, atlas] });
    await bad(host, {
      type: 'atlas-save',
      atlases: [{ ...atlas, scenes: [{ ...atlas.scenes[0], mapId: 'missing' }] }],
    });
    expect((await state(host, h.session)).atlases).toEqual([]);
    await act(host, { type: 'atlas-save', atlases: [atlas] });
    expect(
      await bad(player, { type: 'atlas-publish', atlasId: atlas.id, sceneId: atlas.scenes[0].id }),
    ).toContain('主持人');
    expect(await bad(player, { type: 'atlas-delete', atlasId: atlas.id })).toContain('主持人');
  });
  it('persists and hands private collections to the new host, stripping old-host views', async () => {
    const { app, dataDir, imageDir, host, player, h, p } = await setup();
    const atlases = parseAtlases(ATLAS_IMPORT_TEMPLATE);
    await act(host, { type: 'atlas-save', atlases });
    await act(host, { type: 'transfer-host', memberId: p.session.memberId });
    expect((await state(host, h.session)).atlases).toEqual([]);
    expect((await state(player, p.session)).atlases).toEqual(atlases);
    host.disconnect();
    player.disconnect();
    await app.close();
    servers.splice(servers.indexOf(app), 1);
    const next = await server(dataDir, imageDir),
      resumed = await client(next.url);
    expect((await state(resumed, p.session)).atlases).toEqual(atlases);
  });
});

describe('portable room configuration and dedicated pools', () => {
  it('applies one validated configuration atomically and invalidates old ready/approval state', async () => {
    const { host, player, h, p } = await setup();
    const before = await state(host, h.session),
      config = roomConfiguration(before);
    config.name = '新配置';
    config.mode = 'external';
    config.creationPolicy.allowInterestOnOccupation = false;
    config.creationPolicy.ranges = [{ field: 'attributeTotal', min: 200, max: 550 }];
    config.scene = { title: '码头', description: '雨' };
    expect(
      await bad(player, { type: 'room-config', configuration: config, expectedRevision: 0 }),
    ).toContain('主持人');
    await act(host, {
      type: 'room-config',
      configuration: config,
      expectedRevision: before.configRevision,
    });
    const after = await state(host, h.session);
    expect(roomConfiguration(after)).toEqual(config);
    expect(after.code).toBe(before.code);
    expect(after.members.map((m) => m.character)).toEqual(before.members.map((m) => m.character));
    expect(after.members.every((m) => !m.ready && m.review.status === 'pending')).toBe(true);
    expect(after.policyRevision).toBe(before.policyRevision + 1);
    expect(
      await bad(host, { type: 'room-config', configuration: config, expectedRevision: 0 }),
    ).toContain('已更新');
    expect(await bad(player, { type: 'ready', ready: true })).toContain('分配');
    expect(await bad(host, { type: 'start' })).toContain('审核');
    let card = structuredClone(after.members.find((m) => m.id === p.session.memberId)!.character!);
    if (card.creation?.rule !== 'coc') throw new Error();
    for (const key of [...card.creation.occupationSkills, 'creditRating'])
      card.creation.personal[key] = 0;
    card = syncAllocation(card);
    await act(player, { type: 'character', character: card });
    await act(player, { type: 'ready', ready: true });
  });
  it('rejects active import and mismatched rules while retaining current room state', async () => {
    const { host, h } = await setup(true);
    const before = await state(host, h.session);
    expect(
      await bad(host, {
        type: 'room-config',
        configuration: roomConfiguration(before),
        expectedRevision: 0,
      }),
    ).toContain('准备阶段');
    await act(host, { type: 'pause' });
    await bad(host, {
      type: 'room-config',
      configuration: { ...roomConfiguration(before), rule: 'dnd' },
      expectedRevision: 0,
    });
    expect((await state(host, h.session)).name).toBe(before.name);
  });
  it('detects concurrent mode and scene changes before applying imported configuration', async () => {
    const { host, h } = await setup();
    const config = roomConfiguration(await state(host, h.session));
    await act(host, { type: 'scene', title: '新场景', description: '' });
    expect(
      await bad(host, { type: 'room-config', configuration: config, expectedRevision: 0 }),
    ).toContain('已更新');
    await act(host, { type: 'mode', mode: 'external' });
    expect((await state(host, h.session)).configRevision).toBe(2);
  });
  it('creates a fresh room from an exported configuration without reusing identities', async () => {
    const { url, host, h } = await setup();
    const configuration = roomConfiguration(await state(host, h.session));
    configuration.creationPolicy.allowInterestOnOccupation = false;
    const newHost = await client(url);
    const next = await good<RoomConnection>(newHost, 'room:create', {
      name: 'unused',
      nickname: '新 KP',
      rule: 'coc',
      mode: 'external',
      configuration,
    });
    expect(roomConfiguration(next.room)).toEqual(configuration);
    expect(next.room.code).not.toBe(h.room.code);
    expect(next.session.token).not.toBe(h.session.token);
    expect(next.room.members).toHaveLength(1);
    expect(next.room.atlases).toEqual([]);
  });
});

describe('authenticated image messages and disk storage', () => {
  it('lets both roles send, keeps the chosen directory and delivers exact bytes only to members', async () => {
    const { url, host, player, h, p, imageDir } = await setup(true);
    for (const sender of [h.session, p.session])
      expect((await upload(url, sender)).status).toBe(201);
    const room = await state(player, p.session),
      messages = room.log.filter((e) => e.image);
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('看看这张地图');
    expect(readdirSync(imageDir)).toHaveLength(2);
    const response = await getImage(url, p.session, messages[0].image!.id);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(png, 'base64'));
    expect(
      (await fetch(`${url}/api/rooms/${h.room.code}/images/${messages[0].image!.id}`)).status,
    ).toBe(403);
    await act(player, { type: 'leave' });
    expect((await getImage(url, p.session, messages[0].image!.id)).status).toBe(403);
    expect((await state(host, h.session)).log.filter((e) => e.image)).toHaveLength(2);
  });
  it('rejects uploads before the story, in external mode, or with invalid credentials', async () => {
    const { url, host, h, p } = await setup();
    expect((await upload(url, p.session)).status).toBe(403);
    await act(host, { type: 'mode', mode: 'external' });
    await act(host, { type: 'start' });
    expect((await upload(url, p.session)).status).toBe(403);
    expect((await upload(url, { ...h.session, token: '0'.repeat(64) })).status).toBe(403);
  });
  it('does not accept SVG/HTML renamed as images and cannot escape the configured directory', async () => {
    const { url, h, imageDir, host } = await setup(true);
    const input = imageInput();
    expect(
      (
        await upload(url, h.session, {
          ...input,
          data: Buffer.from('<svg>bad</svg>').toString('base64'),
        })
      ).status,
    ).toBe(400);
    expect((await upload(url, h.session, { ...input, mime: 'image/svg+xml' })).status).toBe(400);
    expect((await upload(url, h.session, { ...input, name: '../../example.png' })).status).toBe(
      201,
    );
    expect(readdirSync(imageDir)[0]).toMatch(/^[a-f0-9-]+\.png$/);
    expect((await state(host, h.session)).log.filter((e) => e.image)).toHaveLength(1);
  });
  it('keeps one message/file for a retried upload and restores images after a server restart', async () => {
    const { url, app, dataDir, imageDir, host, player, h, p } = await setup(true);
    const input = imageInput();
    const first = await upload(url, p.session, input),
      one = await first.json();
    const second = await upload(url, p.session, input);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(one);
    expect(readdirSync(imageDir)).toHaveLength(1);
    host.disconnect();
    player.disconnect();
    await app.close();
    servers.splice(servers.indexOf(app), 1);
    const next = await server(dataDir, imageDir),
      resumed = await client(next.url);
    const room = await state(resumed, h.session),
      image = room.log.find((e) => e.image)!.image!;
    expect((await getImage(next.url, h.session, image.id)).status).toBe(200);
  });
  it('rolls back both the event and new image if room persistence fails', async () => {
    const { url, host, h, dataDir, imageDir } = await setup(true);
    const before = await state(host, h.session);
    const path = join(dataDir, 'rooms.json');
    const saved = readFileSync(path);
    rmSync(path);
    mkdirSync(path);
    const result = await upload(url, h.session);
    expect(result.status).toBe(400);
    expect((await result.json()).error).toContain('存档');
    expect(readdirSync(imageDir)).toEqual([]);
    rmSync(path, { recursive: true });
    expect((await state(host, h.session)).log).toEqual(before.log);
    expect(saved.length).toBeGreaterThan(0);
  });
});
