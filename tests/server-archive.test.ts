import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { createHash } from 'node:crypto';
import { exportArchive, readArchive } from '../server/archive';
import { archiveSummary } from '../shared/archive';
import { createDndStatBlock } from '../shared/dnd';
import { createKeeperCard } from '../shared/keeper';
import type { Room } from '../shared/types';
import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  renameSync,
} from 'node:fs';
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
import { IMAGE_RETENTION_MS, imageFilename } from '../shared/media';
import { existsSync } from 'node:fs';

const sockets: Socket[] = [],
  servers: ReturnType<typeof createAppServer>[] = [],
  dirs: string[] = [];
let clock = Date.now();
async function server(
  dataDir = mkdtempSync(join(tmpdir(), 'interlude-preparation-')),
  imageDir = join(dataDir, 'custom-images'),
) {
  if (!dirs.includes(dataDir)) dirs.push(dataDir);
  const app = createAppServer({
    dataDir,
    imageDir,
    now: () => clock,
    rng: (sides) => Math.floor(sides / 2) + 1,
  });
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
async function setup(active = false, rule: 'coc' | 'dnd' = 'coc') {
  const env = await server();
  const host = await client(env.url),
    player = await client(env.url);
  const h = await good<RoomConnection>(host, 'room:create', {
    name: '备团测试',
    nickname: 'KP',
    rule,
    mode: 'in-room',
  });
  const p = await good<RoomConnection>(player, 'room:join', {
    code: h.room.code,
    nickname: '玩家',
    rule,
  });
  await act(player, { type: 'character', character: preparedCharacter(rule) });
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

const zipExport = (url: string, s: Session, descriptions = {}, includeImages?: boolean) =>
  fetch(`${url}/api/rooms/${s.roomCode}/archive`, {
    method: 'POST',
    headers: { ...headers(s), 'content-type': 'application/json' },
    body: JSON.stringify({ descriptions, includeImages }),
  });
const prep = (url: string, s: Session) =>
  fetch(`${url}/api/rooms/${s.roomCode}/archive`, { headers: headers(s) });
const restore = (url: string, bytes: Uint8Array, rule = 'coc') =>
  fetch(`${url}/api/archives/restore`, {
    method: 'POST',
    headers: {
      'content-type': 'application/zip',
      'x-interlude-nickname': encodeURIComponent('续团KP'),
      'x-interlude-rule': rule,
    },
    body: Buffer.from(bytes),
  });
const download = async (url: string, s: Session, descriptions = {}, includeImages?: boolean) => {
  const response = await zipExport(url, s, descriptions, includeImages);
  if (!response.ok) throw new Error(await response.text());
  return new Uint8Array(await response.arrayBuffer());
};
const rewrite = (bytes: Uint8Array, edit: (room: any) => void) => {
  const files = unzipSync(bytes),
    room = JSON.parse(strFromU8(files['room.json']));
  edit(room);
  files['room.json'] = strToU8(JSON.stringify(room));
  const manifest = JSON.parse(strFromU8(files['manifest.json']));
  manifest.hashes['room.json'] = createHash('sha256').update(files['room.json']).digest('hex');
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  return zipSync(files);
};

describe('archive image references and session retention', () => {
  const day = 24 * 60 * 60 * 1000;
  it('defaults to signed references and real configured paths, with no binary or private catalog key', async () => {
    const env = await setup(true);
    expect((await upload(env.url, env.p.session)).status).toBe(201);
    const image = (await state(env.host, env.h.session)).log.at(-1)!.image!;
    const bytes = await download(env.url, env.h.session);
    const files = unzipSync(bytes),
      archived = readArchive(bytes);
    expect(Object.keys(files).sort()).toEqual([
      'README.md',
      'context.md',
      'manifest.json',
      'room.json',
    ]);
    expect(JSON.parse(strFromU8(files['manifest.json']))).toMatchObject({
      schemaVersion: 2,
      includeImages: true,
    });
    expect(archived.room.log.find((e) => e.image)?.image).toEqual(image);
    const all = Object.values(files).map((bytes) => strFromU8(bytes)).join('');
    expect(all).toContain(join(env.imageDir, imageFilename(image)));
    expect(all).not.toContain(png);
    expect(all).not.toContain(env.h.session.token);
    expect(all).not.toContain(
      JSON.parse(readFileSync(join(env.dataDir, 'images.json'), 'utf8')).secret,
    );
    const restored = (await (await restore(env.url, bytes)).json()) as RoomConnection;
    expect((await getImage(env.url, restored.session, image.id)).status).toBe(200);
    const visitor = await client(env.url);
    const seat = await good<RoomConnection>(visitor, 'room:join', {
      code: restored.room.code,
      nickname: '归来',
      rule: 'coc',
      seatCode: restored.room.seatClaims![0].code,
    });
    expect((await getImage(env.url, seat.session, image.id)).status).toBe(200);
    expect(
      (await getImage(env.url, { ...seat.session, token: '0'.repeat(64) }, image.id)).status,
    ).toBe(403);
  });
  it('keeps the description-only option and reads legacy version 1 exports', async () => {
    const env = await setup(true);
    await upload(env.url, env.p.session);
    const image = (await state(env.host, env.h.session)).log.at(-1)!.image!;
    expect((await zipExport(env.url, env.h.session, {}, false)).status).toBe(400);
    const bytes = await download(env.url, env.h.session, { [image.id]: '北门钥匙' }, false);
    const files = unzipSync(bytes);
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    expect(manifest.includeImages).toBe(false);
    manifest.schemaVersion = 1;
    delete manifest.includeImages;
    files['manifest.json'] = strToU8(JSON.stringify(manifest));
    const parsed = readArchive(zipSync(files));
    expect(parsed.room.log.some((e) => e.image)).toBe(false);
    expect(parsed.room.log.find((e) => e.imageDescription)?.imageDescription?.description).toBe(
      '北门钥匙',
    );
    expect((await restore(env.url, zipSync(files))).status).toBe(201);
  });
  it('retains optional descriptions and prevents forged paths or references from exposing images', async () => {
    const env = await setup(true);
    await upload(env.url, env.p.session);
    const image = (await state(env.host, env.h.session)).log.at(-1)!.image!;
    const bytes = await download(env.url, env.h.session, { [image.id]: '北侧暗门' });
    const goodRestore = (await (await restore(env.url, bytes)).json()) as RoomConnection;
    expect((await (await prep(env.url, goodRestore.session)).json()).images[0].description).toBe(
      '北侧暗门',
    );
    const badProof = rewrite(bytes, (room) => {
      room.log.find((e: any) => e.image).image.reference.signature = '0'.repeat(64);
    });
    const forged = (await (await restore(env.url, badProof)).json()) as RoomConnection;
    expect((await getImage(env.url, forged.session, image.id)).status).toBe(410);
    const pathEscape = rewrite(bytes, (room) => {
      room.log.find((e: any) => e.image).image.reference.path = '../rooms.json';
    });
    expect((await restore(env.url, pathEscape)).status).toBe(400);
    const missingProof = rewrite(bytes, (room) => {
      delete room.log.find((e: any) => e.image).image.reference;
    });
    expect((await restore(env.url, missingProof)).status).toBe(400);
    const other = await server();
    const foreign = (await (await restore(other.url, bytes)).json()) as RoomConnection;
    expect((await getImage(other.url, foreign.session, image.id)).status).toBe(410);
    expect(existsSync(join(env.imageDir, imageFilename(image)))).toBe(true);
  });
  it('protects an active room for more than 14 days, then physically deletes 14 days after pause', async () => {
    const env = await setup(true);
    await upload(env.url, env.p.session);
    const image = (await state(env.host, env.h.session)).log.at(-1)!.image!;
    const bytes = await download(env.url, env.h.session);
    clock += 20 * day;
    env.app.maintain();
    expect((await getImage(env.url, env.p.session, image.id)).status).toBe(200);
    await act(env.host, { type: 'pause' });
    const ended = clock;
    clock = ended + IMAGE_RETENTION_MS - 1;
    env.app.maintain();
    expect(existsSync(join(env.imageDir, imageFilename(image)))).toBe(true);
    // Pure preview and export cannot prolong retention.
    expect((await zipExport(env.url, env.h.session)).status).toBe(200);
    expect(
      (
        await fetch(`${env.url}/api/archives/inspect`, {
          method: 'POST',
          headers: { 'content-type': 'application/zip' },
          body: Buffer.from(bytes),
        })
      ).status,
    ).toBe(200);
    clock++;
    env.app.maintain();
    expect(existsSync(join(env.imageDir, imageFilename(image)))).toBe(false);
    expect((await getImage(env.url, env.h.session, image.id)).status).toBe(410);
    const restored = (await (await restore(env.url, bytes)).json()) as RoomConnection;
    await state(await client(env.url), restored.session);
    expect((await getImage(env.url, restored.session, image.id)).status).toBe(410);
  });
  it('renews on actual resumed play and counts from the latest ending across shared archives', async () => {
    const env = await setup(true);
    await upload(env.url, env.p.session);
    const image = (await state(env.host, env.h.session)).log.at(-1)!.image!;
    const bytes = await download(env.url, env.h.session);
    await act(env.host, { type: 'pause' });
    clock += 10 * day;
    const restored = (await (await restore(env.url, bytes)).json()) as RoomConnection;
    const nextHost = await client(env.url);
    await state(nextHost, restored.session);
    clock += 10 * day;
    env.app.maintain();
    expect((await getImage(env.url, restored.session, image.id)).status).toBe(200);
    await act(nextHost, { type: 'pause' });
    const end = clock;
    clock = end + IMAGE_RETENTION_MS - 1;
    expect((await getImage(env.url, env.h.session, image.id)).status).toBe(200);
    clock++;
    env.app.maintain();
    expect((await getImage(env.url, restored.session, image.id)).status).toBe(410);
  });
  it('preserves retention beyond expired room records and clears images after restart at the deadline', async () => {
    const env = await setup(true);
    await upload(env.url, env.p.session);
    const image = (await state(env.host, env.h.session)).log.at(-1)!.image!;
    const bytes = await download(env.url, env.h.session);
    // Server closure disconnects every seat, recording the end of the session.
    clock += day;
    await env.app.close();
    servers.splice(servers.indexOf(env.app), 1);
    const ended = clock;
    clock = ended + 8 * day;
    const next = await server(env.dataDir, env.imageDir);
    next.app.maintain();
    expect(JSON.parse(readFileSync(join(env.dataDir, 'rooms.json'), 'utf8'))).toHaveLength(0);
    expect(existsSync(join(env.imageDir, imageFilename(image)))).toBe(true);
    const restored = (await (await restore(next.url, bytes)).json()) as RoomConnection;
    // Importing without going online does not start a session or renew the image.
    expect((await getImage(next.url, restored.session, image.id)).status).toBe(200);
    await next.app.close();
    servers.splice(servers.indexOf(next.app), 1);
    clock = ended + IMAGE_RETENTION_MS;
    const restarted = await server(env.dataDir, env.imageDir);
    expect(existsSync(join(env.imageDir, imageFilename(image)))).toBe(false);
    expect((await getImage(restarted.url, restored.session, image.id)).status).toBe(410);
  });
  it('migrates pre-retention rooms without dropping image history and persists signed references', async () => {
    const env = await setup(true);
    await upload(env.url, env.p.session);
    const image = (await state(env.host, env.h.session)).log.at(-1)!.image!;
    await env.app.close();
    servers.splice(servers.indexOf(env.app), 1);
    const roomsPath = join(env.dataDir, 'rooms.json');
    const entries = JSON.parse(readFileSync(roomsPath, 'utf8'));
    delete entries[0].imageSessionAt;
    entries[0].room.log.forEach((e: any) => {
      if (e.image) delete e.image.reference;
    });
    writeFileSync(roomsPath, JSON.stringify(entries));
    rmSync(join(env.dataDir, 'images.json'));
    clock += 2 * day;
    const next = await server(env.dataDir, env.imageDir);
    expect((await getImage(next.url, env.h.session, image.id)).status).toBe(200);
    const bytes = await download(next.url, env.h.session);
    expect(readArchive(bytes).room.log.find((e) => e.image)?.image?.reference).toBeDefined();
    const restored = (await (await restore(next.url, bytes)).json()) as RoomConnection;
    expect((await getImage(next.url, restored.session, image.id)).status).toBe(200);
  });
});

describe('masked secret events', () => {
  it('whitelists live, reconnected and historical dice/check projections without result data', async () => {
    const { host, player, h, p, url } = await setup();
    const seen: Room[] = [];
    player.on('room:state', (room) => seen.push(room));
    await act(host, {
      type: 'roll',
      expression: '2d20+19',
      visibility: 'host',
      requestId: 'secret-id',
    });
    await act(host, {
      type: 'check',
      check: { kind: 'skill', key: '侦查', dc: 0, target: 79, modifier: 0, edge: 'normal' },
      visibility: 'host',
    });
    const hv = await state(host, h.session),
      pv = await state(player, p.session);
    expect(hv.log.at(-2)?.roll?.total).toBe(41);
    const secret = pv.log.at(-2)!;
    expect(secret).toEqual({
      id: hv.log.at(-2)!.id,
      type: 'roll',
      memberId: h.session.memberId,
      name: 'KP',
      content: '2d20+19 = ？ · 结果 ？',
      createdAt: hv.log.at(-2)!.createdAt,
      visibility: 'host',
      secret: { label: '2d20+19' },
    });
    expect(pv.log.at(-1)?.secret?.label).toBe(hv.log.at(-1)?.check?.label);
    for (const room of [...seen, pv])
      for (const e of room.log.filter((e) => e.visibility === 'host')) {
        expect(e.roll).toBeUndefined();
        expect(e.check).toBeUndefined();
        expect(e.requestId).toBeUndefined();
      }
    const history = await (
      await fetch(`${url}/api/rooms/${h.room.code}/history`, { headers: headers(p.session) })
    ).json();
    expect(history.events.at(-2)).toEqual(secret);
    expect((await prep(url, p.session)).status).toBe(403);
    expect((await zipExport(url, p.session)).status).toBe(403);
    expect((await prep(url, { ...p.session, token: '0'.repeat(64) })).status).toBe(403);
  });
});

describe('complete room archives and resumable seats', () => {
  it('keeps more than 300 events on disk and archives the complete context with safe image substitutions', async () => {
    const { host, player, h, p, url, dataDir } = await setup(true);
    const uploadResult = await upload(url, p.session);
    expect(uploadResult.status).toBe(201);
    const original = await state(host, h.session),
      image = original.log.at(-1)!.image!;
    for (let i = 0; i < 305; i++) {
      clock += 3000;
      await act(host, { type: 'message', content: `历史-${i}` });
    }
    const current = await state(host, h.session);
    expect(current.log).toHaveLength(300);
    expect(current.historyBefore).toBeTruthy();
    const disk = JSON.parse(readFileSync(join(dataDir, 'rooms.json'), 'utf8'))[0];
    expect(disk.room.log.length).toBeGreaterThan(305);
    expect(disk.room.historyComplete).toBe(true);
    expect((await getImage(url, p.session, image.id)).status).toBe(200);
    expect((await prep(url, h.session)).status).toBe(200);
    expect((await (await prep(url, h.session)).json()).images[0].image.id).toBe(image.id);
    expect((await zipExport(url, h.session, {}, false)).status).toBe(400);
    const bytes = await download(
      url,
      h.session,
      {
        [image.id]: '码头地图：北门通向仓库，木箱后藏有钥匙。',
      },
      false,
    );
    const parsed = readArchive(bytes);
    expect(parsed.room.log.length).toBe(disk.room.log.length);
    expect(parsed.room.log[0].content).toContain('创建了房间');
    expect(
      parsed.room.log.find((e) => e.imageDescription)?.imageDescription?.description,
    ).toContain('钥匙');
    expect(parsed.room.log.some((e) => e.image)).toBe(false);
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual([
      'README.md',
      'context.md',
      'manifest.json',
      'room.json',
    ]);
    const all = Object.values(files)
      .map((b) => strFromU8(b))
      .join('');
    expect(all).not.toContain(h.session.token);
    expect(all).not.toContain(p.session.token);
    expect(all).not.toContain(png);
    expect(all).toContain('历史-0');
    expect(all).toContain('历史-304');
    expect((await (await prep(url, h.session)).json()).images[0].description).toContain('钥匙');
    const older = await (
      await fetch(`${url}/api/rooms/${h.room.code}/history?before=${current.historyBefore}`, {
        headers: headers(p.session),
      })
    ).json();
    expect(older.events[0].content).toContain('创建了房间');
    expect(older.hasMore).toBe(false);
  });
  it('restores live resources, modifiers, review, libraries and encounter without resetting the story', async () => {
    const { host, player, h, p, url } = await setup(true);
    await act(host, { type: 'atlas-save', atlases: parseAtlases(ATLAS_IMPORT_TEMPLATE) });
    const npc = createKeeperCard('npc');
    npc.attributes.dex = 50;
    await act(host, { type: 'keeper-save', cards: [npc] });
    await act(host, { type: 'encounter-add', cardId: npc.id, count: 2 });
    await act(host, { type: 'initiative' });
    await act(host, { type: 'next-turn' });
    await act(host, { type: 'scene', title: '停在钟楼', description: '二楼的门刚刚打开。' });
    await act(host, { type: 'resource', memberId: p.session.memberId, resource: 'hp', value: 3 });
    let current = await state(host, h.session),
      member = current.members.find((m) => m.id === p.session.memberId)!;
    await act(host, {
      type: 'character-adjust',
      memberId: member.id,
      characterId: member.character!.id,
      expectedRevision: member.characterRevision,
      edit: {
        kind: 'add-effect',
        effect: {
          id: 'fog',
          name: '浓雾',
          endCondition: '离开钟楼',
          enabled: true,
          changes: [{ target: 'skill', key: 'spotHidden', amount: -10 }],
        },
      },
    });
    await act(host, { type: 'roll', expression: '1d100', visibility: 'host' });
    current = await state(host, h.session);
    const bytes = await download(url, h.session);
    const response = await restore(url, bytes);
    expect(response.status).toBe(201);
    const r = (await response.json()) as RoomConnection;
    expect(r.room.code).not.toBe(h.room.code);
    expect(r.session.token).not.toBe(h.session.token);
    expect(r.room.phase).toBe('active');
    expect(r.room.scene).toEqual(current.scene);
    expect(r.room.encounter).toEqual(current.encounter);
    expect(r.room.atlases).toEqual(current.atlases);
    expect(r.room.keeperCards).toEqual(current.keeperCards);
    expect(r.room.members.find((m) => m.id === p.session.memberId)?.character).toEqual(
      current.members.find((m) => m.id === p.session.memberId)?.character,
    );
    expect(r.room.members.find((m) => m.id === p.session.memberId)?.review).toEqual(
      current.members.find((m) => m.id === p.session.memberId)?.review,
    );
    expect(r.room.members.every((m) => !m.online)).toBe(true);
    const rh = await client(url),
      rp = await client(url);
    await state(rh, r.session);
    expect((await ack(rp, 'room:resume', { ...p.session, roomCode: r.room.code })).ok).toBe(false);
    expect(
      (await ack(rp, 'room:join', { code: r.room.code, nickname: '林雾', rule: 'coc' })).ok,
    ).toBe(false);
    expect(
      (
        await ack(rp, 'room:join', {
          code: r.room.code,
          nickname: '林雾',
          rule: 'coc',
          seatCode: 'F'.repeat(16),
        })
      ).ok,
    ).toBe(false);
    const joined = await good<RoomConnection>(rp, 'room:join', {
      code: r.room.code,
      nickname: '林雾续团',
      rule: 'coc',
      seatCode: r.room.seatClaims![0].code,
    });
    expect(joined.session.memberId).toBe(p.session.memberId);
    expect(joined.session.token).not.toBe(p.session.token);
    expect(joined.room.seatClaims).toEqual([]);
    expect(joined.room.keeperCards).toEqual([]);
    expect(joined.room.atlases).toEqual([]);
    expect(joined.room.log.find((e) => e.type === 'roll')?.secret).toBeDefined();
    expect((await state(rh, r.session)).seatClaims).toEqual([]);
    const duplicate = await client(url);
    expect(
      (
        await ack(duplicate, 'room:join', {
          code: r.room.code,
          nickname: '冒领',
          rule: 'coc',
          seatCode: r.room.seatClaims![0].code,
        })
      ).ok,
    ).toBe(false);
    await act(rp, { type: 'message', content: '继续上次的故事' });
    expect((await state(rh, r.session)).log.at(-1)?.content).toBe('继续上次的故事');
    const second = readArchive(await download(url, r.session));
    expect(second.room.log[0]).toEqual(readArchive(bytes).room.log[0]);
    expect(second.room.log.at(-1)?.content).toBe('继续上次的故事');
  });
  it('persists unclaimed seats across a server restart and does not export their credentials', async () => {
    const env = await setup(true),
      bytes = await download(env.url, env.h.session);
    const r = (await (await restore(env.url, bytes)).json()) as RoomConnection;
    const second = await download(env.url, r.session);
    expect(strFromU8(unzipSync(second)['room.json'])).not.toContain(r.room.seatClaims![0].code);
    env.host.disconnect();
    env.player.disconnect();
    await env.app.close();
    servers.splice(servers.indexOf(env.app), 1);
    const next = await server(env.dataDir, env.imageDir),
      h = await client(next.url),
      p = await client(next.url);
    expect((await state(h, r.session)).seatClaims).toEqual(r.room.seatClaims);
    expect(
      (
        await good<RoomConnection>(p, 'room:join', {
          code: r.room.code,
          nickname: '玩家',
          rule: 'coc',
          seatCode: r.room.seatClaims![0].code,
        })
      ).room.phase,
    ).toBe('active');
  });
  it('migrates old truncated history honestly without changing the active game or losing future events', async () => {
    const env = await setup(true);
    env.host.disconnect();
    env.player.disconnect();
    await env.app.close();
    servers.splice(servers.indexOf(env.app), 1);
    const path = join(env.dataDir, 'rooms.json'),
      data = JSON.parse(readFileSync(path, 'utf8'));
    delete data[0].room.historyComplete;
    delete data[0].seatClaims;
    delete data[0].imageDescriptions;
    const event = data[0].room.log[0];
    data[0].room.log = Array.from({ length: 300 }, (_, i) => ({ ...event, id: `legacy-${i}` }));
    writeFileSync(path, JSON.stringify(data));
    const next = await server(env.dataDir, env.imageDir),
      h = await client(next.url);
    expect((await state(h, env.h.session)).phase).toBe('active');
    await act(h, { type: 'message', content: '升级后的完整记录' });
    const archived = readArchive(await download(next.url, env.h.session));
    expect(archived.room.historyComplete).toBe(false);
    expect(archived.room.log).toHaveLength(301);
  });
  it('keeps rejected restores atomic, and restores the original lobby and review gate', async () => {
    const env = await setup(false),
      bytes = await download(env.url, env.h.session);
    const before = JSON.parse(readFileSync(join(env.dataDir, 'rooms.json'), 'utf8')).length;
    expect((await restore(env.url, bytes, 'dnd')).status).toBe(400);
    expect((await restore(env.url, new Uint8Array([1, 2, 3]))).status).toBe(400);
    expect(JSON.parse(readFileSync(join(env.dataDir, 'rooms.json'), 'utf8'))).toHaveLength(before);
    const r = (await (await restore(env.url, bytes)).json()) as RoomConnection;
    expect(r.room.phase).toBe('lobby');
    const h = await client(env.url);
    await state(h, r.session);
    expect(await bad(h, { type: 'start' })).toContain('上线');
  });
  it('rolls back a seat claim on disk failure so the player can retry', async () => {
    const env = await setup(true),
      r = (await (
        await restore(env.url, await download(env.url, env.h.session))
      ).json()) as RoomConnection;
    const socket = await client(env.url),
      target = join(env.dataDir, 'rooms.json'),
      backup = join(env.dataDir, 'rooms.bak');
    renameSync(target, backup);
    mkdirSync(target);
    const input = {
      code: r.room.code,
      nickname: '玩家',
      rule: 'coc',
      seatCode: r.room.seatClaims![0].code,
    };
    try {
      expect((await ack(socket, 'room:join', input)).ok).toBe(false);
    } finally {
      rmSync(target, { recursive: true });
      renameSync(backup, target);
    }
    const result = await good<RoomConnection>(socket, 'room:join', input);
    expect(result.session.memberId).toBe(env.p.session.memberId);
  });
});

describe('archive format and bounded importer', () => {
  it('restores D&D stat blocks, independent NPC resources and current turn', async () => {
    const env = await setup(true, 'dnd');
    const card = createDndStatBlock('npc-bridge-guard');
    await act(env.host, { type: 'dnd-save', cards: [card] });
    await act(env.host, { type: 'encounter-add', cardId: card.id, count: 2 });
    await act(env.host, { type: 'initiative' });
    let before = await state(env.host, env.h.session);
    const npc = before.encounter.participants.find((p) => !p.memberId)!;
    await act(env.host, {
      type: 'encounter-update',
      combatantId: npc.id,
      expectedRevision: before.encounter.revision,
      patch: { hp: 1, concentration: '雾云术' },
    });
    await act(env.host, { type: 'next-turn' });
    before = await state(env.host, env.h.session);
    const bytes = await download(env.url, env.h.session);
    const result = await restore(env.url, bytes, 'dnd');
    expect(result.status).toBe(201);
    const resumed = (await result.json()) as RoomConnection;
    expect(resumed.room.encounter).toEqual(before.encounter);
    expect(resumed.room.dndCards).toEqual(before.dndCards);
    expect(resumed.room.phase).toBe('active');
  });
  it('rejects an active archive that bypasses approval or allocation rules', async () => {
    const env = await setup(true),
      bytes = await download(env.url, env.h.session);
    expect(() =>
      readArchive(
        rewrite(bytes, (room) => {
          room.members[1].review.status = 'pending';
        }),
      ),
    ).toThrow('未通过审核');
    expect(() =>
      readArchive(
        rewrite(bytes, (room) => {
          room.creationPolicy.cocSkillCap = 1;
        }),
      ),
    ).toThrow();
  });
  it('bounds actual inflated bytes even when ZIP sizes lie and rejects duplicate entry names', async () => {
    const env = await setup(),
      bytes = await download(env.url, env.h.session),
      base = unzipSync(bytes);
    const oversized = zipSync({ ...base, 'README.md': strToU8('x'.repeat(9000)) });
    const view = new DataView(oversized.buffer, oversized.byteOffset, oversized.byteLength);
    // Forge only the declared uncompressed size of README. The inflater must still count output.
    for (let i = 0; i < oversized.length - 46; i++) {
      const sig = view.getUint32(i, true);
      if (
        sig === 0x04034b50 &&
        new TextDecoder().decode(oversized.subarray(i + 30, i + 39)) === 'README.md'
      )
        view.setUint32(i + 22, 1, true);
      if (
        sig === 0x02014b50 &&
        new TextDecoder().decode(oversized.subarray(i + 46, i + 55)) === 'README.md'
      )
        view.setUint32(i + 24, 1, true);
    }
    expect(() => readArchive(oversized)).toThrow('解压内容过大');
    const duplicate = zipSync({ ...base, 'fake.json': base['room.json'] });
    for (let i = 0; i < duplicate.length - 9; i++)
      if (new TextDecoder().decode(duplicate.subarray(i, i + 9)) === 'fake.json')
        duplicate.set(strToU8('room.json'), i);
    expect(() => readArchive(duplicate)).toThrow('重复');
  });

  it('previews a valid archive without creating a room', async () => {
    const env = await setup(),
      bytes = await download(env.url, env.h.session);
    const before = readFileSync(join(env.dataDir, 'rooms.json'), 'utf8');
    const res = await fetch(`${env.url}/api/archives/inspect`, {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: Buffer.from(bytes),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).eventCount).toBe(readArchive(bytes).room.log.length);
    expect(readFileSync(join(env.dataDir, 'rooms.json'), 'utf8')).toBe(before);
  });
  it('rejects bad checksums, unsupported versions, unknown files, paths, excessive output and missing files', async () => {
    const env = await setup(),
      bytes = await download(env.url, env.h.session),
      base = unzipSync(bytes);
    const cases: Record<string, Uint8Array>[] = [
      { ...base, 'room.json': strToU8('{}') },
      { ...base, '../room.json': base['room.json'] },
      { ...base, 'extra.txt': strToU8('no') },
      { ...base, 'README.md': strToU8('a'.repeat(8193)) },
    ];
    const manifest = JSON.parse(strFromU8(base['manifest.json']));
    manifest.schemaVersion = 99;
    cases.push({ ...base, 'manifest.json': strToU8(JSON.stringify(manifest)) });
    const missing = { ...base };
    delete missing['room.json'];
    cases.push(missing);
    cases.forEach((files) => expect(() => readArchive(zipSync(files))).toThrow());
    expect(() => readArchive(new Uint8Array(32 * 1024 * 1024 + 1))).toThrow();
    expect(() => readArchive(new Uint8Array())).toThrow();
    expect(() => readArchive(bytes.subarray(0, bytes.length - 22))).toThrow();
  });
  it.each([
    'rule',
    'host',
    'member',
    'encounter',
    'tokens',
    'secret',
    'image',
    'duplicate',
    'prototype',
  ])('rejects invalid %s content even in a correctly hashed ZIP', async (kind) => {
    const env = await setup(),
      bytes = await download(env.url, env.h.session);
    const broken = rewrite(bytes, (room) => {
      if (kind === 'rule') room.rule = 'dnd';
      if (kind === 'host') room.hostId = 'missing';
      if (kind === 'member') room.members.push(room.members[0]);
      if (kind === 'encounter') room.initiative = [{ memberId: 'missing', value: 10 }];
      if (kind === 'tokens') room.tokens = { hello: 'bad' };
      if (kind === 'secret') room.log[0].secret = { label: 'masked' };
      if (kind === 'image')
        room.log[0].image = {
          id: crypto.randomUUID(),
          name: 'raw.png',
          mime: 'image/png',
          bytes: 2,
        };
      if (kind === 'duplicate') room.log.push(room.log[0]);
      if (kind === 'prototype')
        Object.defineProperty(room, '__proto__', { value: { polluted: true }, enumerable: true });
    });
    expect(() => readArchive(broken)).toThrow();
  });
});
