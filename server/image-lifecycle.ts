import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  ChatImageSchema,
  IMAGE_RETENTION_MS,
  imageFilename,
  type ChatImage,
} from '../shared/media.ts';
import { imagePath, removeImage } from './images.ts';

const fileSchema = z
  .object({
    image: ChatImageSchema.omit({ reference: true }),
    expiresAt: z.number().finite(),
    deletedAt: z.number().finite().nullable(),
  })
  .strict();
const catalogSchema = z
  .object({
    version: z.literal(1),
    storeId: z.string().uuid(),
    secret: z.string().regex(/^[a-f0-9]{64}$/),
    files: z.record(z.string().uuid(), fileSchema),
  })
  .strict();
const mimeByExtension = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
} as const;

/** Private persistent metadata outlives rooms. The active-room map is rebuilt from live sessions.
 * An archive carries a signed reference, never this key or a session credential.
 */
export class ImageLifecycle {
  private catalog: z.infer<typeof catalogSchema>;
  private activeRooms = new Map<string, Set<string>>();
  private dirty = false;
  private readonly catalogPath: string;
  constructor(
    dataDir: string,
    private readonly directory: string,
  ) {
    this.catalogPath = resolve(dataDir, 'images.json');
    mkdirSync(dataDir, { recursive: true });
    if (existsSync(this.catalogPath)) {
      try {
        this.catalog = catalogSchema.parse(JSON.parse(readFileSync(this.catalogPath, 'utf8')));
      } catch {
        throw new Error('图片保留记录 images.json 无法读取，请从备份恢复；未删除图片文件。');
      }
    } else {
      this.catalog = {
        version: 1,
        storeId: randomUUID(),
        secret: randomBytes(32).toString('hex'),
        files: {},
      };
      this.dirty = true;
      this.flush();
    }
  }
  private signature(image: ChatImage) {
    return createHmac('sha256', this.catalog.secret)
      .update(
        JSON.stringify([
          this.catalog.storeId,
          image.id,
          imageFilename(image),
          image.mime,
          image.bytes,
        ]),
      )
      .digest('hex');
  }
  private signed(image: ChatImage): ChatImage {
    return {
      ...image,
      reference: {
        storeId: this.catalog.storeId,
        path: imageFilename(image),
        signature: this.signature(image),
      },
    };
  }
  private authorized(image: ChatImage) {
    const ref = image.reference,
      file = this.catalog.files[image.id];
    return !!(
      ref &&
      file &&
      ref.storeId === this.catalog.storeId &&
      ref.path === imageFilename(image) &&
      file.image.id === image.id &&
      file.image.mime === image.mime &&
      file.image.bytes === image.bytes &&
      /^[a-f0-9]{64}$/.test(ref.signature) &&
      timingSafeEqual(Buffer.from(ref.signature, 'hex'), Buffer.from(this.signature(image), 'hex'))
    );
  }
  private regular(image: ChatImage) {
    try {
      const stat = lstatSync(imagePath(this.directory, image));
      return stat.isFile() && stat.size === image.bytes;
    } catch {
      return false;
    }
  }
  private inUse(id: string) {
    return [...this.activeRooms.values()].some((ids) => ids.has(id));
  }
  isRoomActive(code: string) {
    return this.activeRooms.has(code);
  }
  register(image: ChatImage, time: number): ChatImage {
    if (this.catalog.files[image.id]) throw new Error('图片编号已存在');
    const { reference: _reference, ...base } = image;
    this.catalog.files[image.id] = {
      image: base,
      expiresAt: time + IMAGE_RETENTION_MS,
      deletedAt: null,
    };
    this.dirty = true;
    this.flush();
    return this.signed(base);
  }
  rollbackUpload(image: ChatImage) {
    removeImage(this.directory, image);
    delete this.catalog.files[image.id];
    for (const ids of this.activeRooms.values()) ids.delete(image.id);
    this.dirty = true;
    this.flush();
  }
  /** Only called on validated local rooms during migration, never on uploaded archives. */
  recover(image: ChatImage, lastPlayedAt: number): ChatImage {
    if (!image.reference) {
      const existing = this.catalog.files[image.id];
      if (!existing) {
        const { reference: _ref, ...base } = image;
        this.catalog.files[image.id] = {
          image: base,
          expiresAt: lastPlayedAt + IMAGE_RETENTION_MS,
          deletedAt: this.regular(image) ? null : lastPlayedAt,
        };
      } else if (existing.deletedAt === null)
        existing.expiresAt = Math.max(existing.expiresAt, lastPlayedAt + IMAGE_RETENTION_MS);
      this.dirty = true;
      return this.signed(image);
    }
    if (this.authorized(image)) {
      const file = this.catalog.files[image.id];
      if (file.deletedAt === null && lastPlayedAt + IMAGE_RETENTION_MS > file.expiresAt) {
        file.expiresAt = lastPlayedAt + IMAGE_RETENTION_MS;
        this.dirty = true;
      }
    }
    return image;
  }
  available(image: ChatImage, time: number): boolean {
    if (!this.authorized(image)) return false;
    const file = this.catalog.files[image.id];
    if (file.deletedAt !== null) return false;
    if (!this.regular(image)) {
      file.deletedAt = time;
      this.dirty = true;
      return false;
    }
    if (!this.inUse(image.id) && time >= file.expiresAt) {
      removeImage(this.directory, image);
      file.deletedAt = time;
      this.dirty = true;
      return false;
    }
    return true;
  }
  /** Starting/continuing real play renews references; reading/exporting/previewing never does. */
  setSession(code: string, images: ChatImage[], active: boolean, time: number) {
    if (active) {
      const ids = new Set<string>();
      for (const image of images)
        if (this.available(image, time)) {
          ids.add(image.id);
          const file = this.catalog.files[image.id];
          file.expiresAt = Math.max(file.expiresAt, time + IMAGE_RETENTION_MS);
          this.dirty = true;
        }
      this.activeRooms.set(code, ids);
    } else {
      const previous = this.activeRooms.get(code);
      if (previous)
        for (const id of previous) {
          const file = this.catalog.files[id];
          if (file && file.deletedAt === null) {
            file.expiresAt = Math.max(file.expiresAt, time + IMAGE_RETENTION_MS);
            this.dirty = true;
          }
        }
      this.activeRooms.delete(code);
    }
    this.flush();
  }
  endMissingRooms(codes: Set<string>, time: number) {
    for (const code of this.activeRooms.keys())
      if (!codes.has(code)) this.setSession(code, [], false, time);
  }
  contextPath(image: ChatImage) {
    return this.authorized(image)
      ? imagePath(this.directory, image)
      : (image.reference?.path ?? imageFilename(image));
  }
  /** Adopt orphaned UUID filenames only; never traverse folders or follow symbolic links. */
  discoverOrphans() {
    if (!existsSync(this.directory)) return;
    for (const file of readdirSync(this.directory, { withFileTypes: true })) {
      const match = file.name.match(
        /^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.(png|jpg|gif|webp)$/,
      );
      if (!match || !file.isFile() || this.catalog.files[match[1]]) continue;
      const stat = lstatSync(resolve(this.directory, file.name));
      const parsed = ChatImageSchema.safeParse({
        id: match[1],
        mime: mimeByExtension[match[2] as keyof typeof mimeByExtension],
        name: file.name,
        bytes: stat.size,
      });
      if (!parsed.success) continue;
      this.catalog.files[match[1]] = {
        image: parsed.data,
        expiresAt: stat.mtimeMs + IMAGE_RETENTION_MS,
        deletedAt: null,
      };
      this.dirty = true;
    }
  }
  collect(time: number) {
    for (const file of Object.values(this.catalog.files))
      if (file.deletedAt === null && !this.inUse(file.image.id) && time >= file.expiresAt) {
        // Unlink only our managed raster filename. An unexpected symlink is left untouched.
        if (this.regular(file.image)) removeImage(this.directory, file.image);
        file.deletedAt = time;
        this.dirty = true;
      }
    this.flush();
  }
  flush() {
    if (!this.dirty) return;
    const temp = `${this.catalogPath}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(this.catalog), { mode: 0o600 });
    renameSync(temp, this.catalogPath);
    this.dirty = false;
  }
}
