import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ImageLifecycle } from '../server/image-lifecycle';
import { imagePath, saveImage } from '../server/images';
import { IMAGE_RETENTION_MS, type ChatImage } from '../shared/media';

const day = 24 * 60 * 60 * 1000;
const start = Date.UTC(2026, 9, 5);
const dirs: string[] = [];
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'interlude-image-life-'));
  dirs.push(dir);
  const imageDir = join(dir, 'custom-images');
  const store = new ImageLifecycle(dir, imageDir);
  const bytes = Buffer.from('GIF89a0000000');
  const base: ChatImage = {
    id: randomUUID(),
    mime: 'image/gif',
    name: 'map.gif',
    bytes: bytes.length,
  };
  saveImage(imageDir, base, bytes);
  const image = store.register(base, start);
  return { dir, imageDir, store, image, base, bytes, path: imagePath(imageDir, image) };
}
afterEach(() => dirs.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));

describe('independent server image retention', () => {
  it('deletes only at 14 days after the latest session end, even across long active sessions', () => {
    const e = setup();
    e.store.setSession('A', [e.image], true, start);
    e.store.collect(start + 30 * day);
    expect(existsSync(e.path)).toBe(true);
    expect(e.store.available(e.image, start + 30 * day)).toBe(true);
    const ended = start + 30 * day;
    e.store.setSession('A', [], false, ended);
    e.store.collect(ended + IMAGE_RETENTION_MS - 1);
    expect(existsSync(e.path)).toBe(true);
    e.store.collect(ended + IMAGE_RETENTION_MS);
    expect(existsSync(e.path)).toBe(false);
    expect(e.store.available(e.image, ended + IMAGE_RETENTION_MS)).toBe(false);
  });
  it('keeps shared references while either room is active and renews from the last room to end', () => {
    const e = setup();
    e.store.setSession('A', [e.image], true, start);
    e.store.setSession('A', [], false, start + day);
    e.store.setSession('B', [e.image], true, start + 10 * day);
    e.store.setSession('C', [e.image], true, start + 12 * day);
    e.store.endMissingRooms(new Set(['C']), start + 13 * day);
    e.store.collect(start + 40 * day);
    expect(existsSync(e.path)).toBe(true);
    e.store.endMissingRooms(new Set(), start + 40 * day);
    e.store.collect(start + 54 * day - 1);
    expect(existsSync(e.path)).toBe(true);
    e.store.collect(start + 54 * day);
    expect(existsSync(e.path)).toBe(false);
  });
  it('persists deadlines across restart; reads and path exports do not renew them', () => {
    const e = setup();
    e.store.setSession('A', [e.image], true, start);
    e.store.setSession('A', [], false, start + day);
    const before = readFileSync(join(e.dir, 'images.json'), 'utf8');
    const next = new ImageLifecycle(e.dir, e.imageDir);
    expect(next.available(e.image, start + 14 * day)).toBe(true);
    expect(next.contextPath(e.image)).toBe(e.path);
    next.collect(start + 14 * day);
    expect(readFileSync(join(e.dir, 'images.json'), 'utf8')).toBe(before);
    next.collect(start + 15 * day);
    expect(existsSync(e.path)).toBe(false);
  });
  it('does not resurrect expired references, even if an old archive is played again or files reappear', () => {
    const e = setup();
    e.store.setSession('late', [e.image], true, start + 15 * day);
    expect(existsSync(e.path)).toBe(false);
    saveImage(e.imageDir, e.image, e.bytes);
    e.store.recover(e.image, start + 16 * day);
    e.store.setSession('later', [e.image], true, start + 16 * day);
    expect(e.store.available(e.image, start + 16 * day)).toBe(false);
  });
  it('rejects forged identities, MIME, byte counts, signatures and foreign server references', () => {
    const e = setup(),
      other = setup();
    const ref = e.image.reference!;
    for (const forged of [
      { ...e.image, id: randomUUID() },
      { ...e.image, bytes: 1 },
      { ...e.image, mime: 'image/png' as const },
      { ...e.image, reference: undefined },
      { ...e.image, reference: { ...ref, signature: '0'.repeat(64) } },
      { ...e.image, reference: { ...ref, path: '../map.gif' } },
      { ...e.image, reference: { ...ref, storeId: randomUUID() } },
      other.image,
    ])
      expect(e.store.available(forged, start)).toBe(false);
    expect(e.store.available(e.image, start)).toBe(true);
    expect(existsSync(e.path)).toBe(true);
  });
  it('migrates trusted legacy metadata without giving old images a fresh 14 days at startup', () => {
    const e = setup();
    rmSync(join(e.dir, 'images.json'));
    const migrated = new ImageLifecycle(e.dir, e.imageDir);
    const image = migrated.recover(e.base, start + day);
    expect(image.reference).toBeDefined();
    migrated.collect(start + 15 * day - 1);
    expect(migrated.available(image, start + 15 * day - 1)).toBe(true);
    migrated.collect(start + 15 * day);
    expect(existsSync(e.path)).toBe(false);
  });
  it('uses a persisted final session heartbeat to recover a interrupted metadata write', () => {
    const e = setup();
    const next = new ImageLifecycle(e.dir, e.imageDir);
    next.recover(e.image, start + 8 * day);
    next.collect(start + 15 * day);
    expect(next.available(e.image, start + 15 * day)).toBe(true);
    next.collect(start + 22 * day);
    expect(existsSync(e.path)).toBe(false);
  });
  it('cleans orphan managed rasters by mtime but leaves other files, nested folders and symlinks alone', () => {
    const e = setup();
    const orphan = join(e.imageDir, `${randomUUID()}.png`);
    writeFileSync(orphan, e.bytes);
    utimesSync(orphan, new Date(start), new Date(start));
    const unrelated = join(e.imageDir, 'notes.png');
    writeFileSync(unrelated, e.bytes);
    const nested = join(e.imageDir, 'nested');
    mkdirSync(nested);
    const nestedFile = join(nested, `${randomUUID()}.png`);
    writeFileSync(nestedFile, e.bytes);
    const link = join(e.imageDir, `${randomUUID()}.png`);
    symlinkSync(unrelated, link);
    e.store.discoverOrphans();
    e.store.collect(start + IMAGE_RETENTION_MS);
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(unrelated)).toBe(true);
    expect(existsSync(nestedFile)).toBe(true);
    expect(existsSync(link)).toBe(true);
  });
  it('renders externally missing images unavailable and does not follow a replaced symlink', () => {
    const e = setup();
    rmSync(e.path);
    const target = join(e.dir, 'private-file');
    writeFileSync(target, e.bytes);
    symlinkSync(target, e.path);
    expect(e.store.available(e.image, start)).toBe(false);
    e.store.collect(start + IMAGE_RETENTION_MS);
    expect(existsSync(target)).toBe(true);
    expect(existsSync(e.path)).toBe(true);
  });
  it('fails safely on a corrupt private catalog without removing the original files', () => {
    const e = setup();
    writeFileSync(join(e.dir, 'images.json'), '{');
    expect(() => new ImageLifecycle(e.dir, e.imageDir)).toThrow('images.json');
    expect(existsSync(e.path)).toBe(true);
  });
});
