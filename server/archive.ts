import { createHash } from 'node:crypto';
import { Unzip, UnzipInflate, unzipSync, zip, strToU8 } from 'fflate';
import { z } from 'zod';
import { MAX_ARCHIVE_BYTES } from '../shared/archive.ts';
import { roomSchema, validRoomReferences } from '../shared/room-state.ts';
import { validateCreation } from '../shared/creation.ts';
import { parsePortable } from '../shared/portable.ts';
import { IMAGE_RETENTION_NOTICE, imageFilename, type ChatImage } from '../shared/media.ts';
import type { Room, RoomEvent } from '../shared/types.ts';

const limits: Record<string, number> = {
  'manifest.json': 8192,
  'room.json': 64 * 1024 * 1024,
  'context.md': 28 * 1024 * 1024,
  'README.md': 8192,
};
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const legacyManifestSchema = z
  .object({
    documentType: z.literal('interlude-room-archive'),
    schemaVersion: z.literal(1),
    exportedAt: z.iso.datetime(),
    hashes: z
      .object({
        'room.json': z.string().regex(/^[a-f0-9]{64}$/),
        'context.md': z.string().regex(/^[a-f0-9]{64}$/),
        'README.md': z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  })
  .strict();
const manifestSchema = z.union([
  legacyManifestSchema,
  legacyManifestSchema.extend({ schemaVersion: z.literal(2), includeImages: z.boolean() }),
]);
const explanation = `# 幕间 · 全局存档\n\n选择对应规则 → 创建房间 → 从全局存档续团 → 选择此 ZIP → 预览后恢复。无需手动解压。\n\nroom.json 保存房间配置、角色及修正、审核、地图与场景、NPC / 数据块、遭遇状态和完整可用记录。context.md 供人或外部 AI 阅读。\n\n“导出图片”默认开启：仅在上下文中记录图片的服务端存储路径，并保存用于恢复的图片引用；ZIP 不包含图片文件，也不会下载原图。关闭时以主持人填写的文字描述替代图片。\n\n${IMAGE_RETENTION_NOTICE}清理每分钟检查一次，停机期间到期的图片在启动时清理。仅预览、导出存档或查看图片不会续期；未开团的图片从上传时起保留 14 天。\n\n引用只能在原服务器（或同时迁移图片目录与 DATA_DIR/images.json 的服务器）读取。不要将 ZIP 当作图片备份。路径指向服务器配置的 IMAGE_DIR 中的文件；服务器外不可直接访问该路径。删除或无法找到的图片会显示占位符，有补充描述时仍可阅读文字。\n\n存档包含主持人私密资料和暗骰真实结果，请交给可信任的主持人保管。没有登录令牌、席位恢复码或服务端 API 密钥。\n\n恢复会创建新的房间码，保留原来的准备 / 进行阶段、资源和行动顺序。主持人在“全局存档”中分别复制席位恢复码；玩家选择同一规则，在加入房间时填写新房间码和自己的恢复码。每个恢复码只可使用一次。\n\n旧版本已经丢弃的历史无法补回；historyComplete 为 false 时，存档仅包含升级时仍保留的记录及之后的完整记录。原始图片无法从文字描述恢复。\n\n请勿直接修改 ZIP 内文件；导入时会检查版本、大小、内容校验和与状态引用。\n`;
function transcript(room: Room, path: (image: ChatImage) => string, includeImages: boolean) {
  const heading = `# ${room.name}\n\n规则：${room.rule === 'coc' ? 'CoC 7' : 'D&D 5e 2014 / SRD 5.1'}\n阶段：${room.phase === 'active' ? '进行中' : '准备中'}\n场景：${room.scene.title}\n${room.scene.description}\n\n历史：${room.historyComplete === false ? '旧版本此前已截断，仅包含现存历史及升级后的全部记录' : '完整'}\n\n图片：${includeImages ? '仅保留服务端路径引用，不包含图片文件。' : '以主持人填写的文字描述替代。'}${IMAGE_RETENTION_NOTICE}\n\n## 过程记录（含主持人私密内容）\n\n`;
  return (
    heading +
    room.log
      .map((e) => {
        const description = e.imageDescription
          ? `\n\n> 图片「${e.imageDescription.name}」的替代描述：\n> ${e.imageDescription.description.replace(/\n/g, '\n> ')}`
          : '';
        // A code span records the server path without embedding/downloading images in Markdown viewers.
        const reference = e.image
          ? `\n\n图片「${e.image.name}」的服务端路径：\n\n\`\` ${path(e.image)
              .replace(/`/g, '%60')
              .replace(/[\r\n]/g, '')} \`\`\n\n（仅引用；过期或原服务器不可用时显示占位符。）`
          : '';
        return `### ${e.createdAt} · ${e.name}${e.visibility === 'host' ? '（主持人暗骰）' : ''}\n\n${e.content}${e.scene?.description ? `\n\n${e.scene.description}` : ''}${reference}${description}\n`;
      })
      .join('\n')
  );
}
export async function exportArchive(
  room: Room,
  descriptions: Record<string, string>,
  exportedAt: string,
  options: { includeImages?: boolean; imagePath?: (image: ChatImage) => string } = {},
): Promise<Uint8Array> {
  const includeImages = options.includeImages ?? true;
  // Runtime projections (seat claims) and all session credentials are excluded by the strict schema.
  const snapshot = roomSchema.parse(room) as Room;
  snapshot.members.forEach((m) => {
    m.online = false;
  });
  snapshot.log = snapshot.log.map((e) => {
    const { requestId: _requestId, ...event } = e;
    if (!event.image) return event;
    const description = descriptions[event.image.id]?.trim();
    if ((!includeImages && !description) || (description && description.length > 2000))
      throw new Error('请为每张图片填写 1–2000 字的替代描述；如有新图片，请刷新图片清单。');
    if (includeImages) {
      if (!event.image.reference || event.image.reference.path !== imageFilename(event.image))
        throw new Error('图片引用尚未就绪，请重新连接房间后再导出。');
      return {
        ...event,
        ...(description ? { imageDescription: { name: event.image.name, description } } : {}),
      };
    }
    const { image, ...rest } = event;
    return { ...rest, imageDescription: { name: image.name, description: description! } };
  });
  const files: Record<string, Uint8Array> = {
    'room.json': strToU8(JSON.stringify(snapshot)),
    'context.md': strToU8(transcript(snapshot, options.imagePath ?? imageFilename, includeImages)),
    'README.md': strToU8(explanation),
  };
  const hashes = Object.fromEntries(
    Object.entries(files).map(([key, value]) => [key, digest(value)]),
  );
  files['manifest.json'] = strToU8(
    JSON.stringify({
      documentType: 'interlude-room-archive',
      schemaVersion: 2,
      includeImages,
      exportedAt,
      hashes,
    }),
  );
  for (const [key, value] of Object.entries(files))
    if (value.length > limits[key])
      throw new Error('房间存档超过单文件容量，请联系部署者保留服务器数据。');
  const bytes = await new Promise<Uint8Array>((resolve, reject) =>
    zip(files, { level: 6 }, (error, data) => (error ? reject(error) : resolve(data))),
  );
  if (bytes.length > MAX_ARCHIVE_BYTES)
    throw new Error('压缩后的存档超过 32 MiB，未截断任何记录。');
  return bytes;
}

/** Stream small compressed chunks and bound ACTUAL output, not untrusted ZIP size metadata.
 * Nothing is ever extracted to the filesystem. Reject unknown paths and duplicate entries.
 */
export function readArchive(bytes: Uint8Array): { room: Room; exportedAt: string } {
  if (!bytes.length || bytes.length > MAX_ARCHIVE_BYTES)
    throw new Error('存档 ZIP 不能为空或超过 32 MiB。');
  try {
    // Read only directory metadata first; filter=false never inflates or allocates
    // the declared file size. This also rejects missing ZIP end records.
    const directory = new Map<string, { size: number; compression: number }>();
    unzipSync(bytes, {
      filter: (file) => {
        if (
          !Object.hasOwn(limits, file.name) ||
          directory.has(file.name) ||
          ![0, 8].includes(file.compression)
        )
          throw new Error('ZIP 包含未知文件、重复名称或不支持的压缩方式。');
        if (file.originalSize > limits[file.name]) throw new Error('ZIP 解压内容过大。');
        directory.set(file.name, { size: file.originalSize, compression: file.compression });
        return false;
      },
    });
    if (directory.size !== 4) throw new Error('ZIP 文件不完整。');
    const files = new Map<string, Uint8Array>();
    const seen = new Set<string>();
    let failure: Error | null = null;
    const unzip = new Unzip((file) => {
      if (
        !Object.hasOwn(limits, file.name) ||
        seen.has(file.name) ||
        ![0, 8].includes(file.compression)
      )
        throw new Error('ZIP 包含未知文件、重复名称或不支持的压缩方式。');
      seen.add(file.name);
      const max = limits[file.name];
      if (file.originalSize !== undefined && file.originalSize > max)
        throw new Error('ZIP 解压内容过大。');
      const chunks: Uint8Array[] = [];
      let size = 0;
      file.ondata = (error, data, final) => {
        if (error) {
          failure = error;
          file.terminate();
          return;
        }
        size += data.length;
        if (size > max) {
          failure = new Error('ZIP 解压内容过大。');
          file.terminate();
          return;
        }
        chunks.push(data);
        if (final) {
          if (
            size !== directory.get(file.name)?.size ||
            file.compression !== directory.get(file.name)?.compression
          ) {
            failure = new Error('ZIP 文件目录与实际内容不一致。');
            return;
          }
          const result = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
          }
          files.set(file.name, result);
        }
      };
      file.start();
    });
    unzip.register(UnzipInflate);
    for (let offset = 0; offset < bytes.length; offset += 256) {
      unzip.push(bytes.subarray(offset, offset + 256), offset + 256 >= bytes.length);
      if (failure) throw failure;
    }
    if (files.size !== 4) throw new Error('ZIP 文件不完整。');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const manifest = manifestSchema.parse(
      parsePortable(decoder.decode(files.get('manifest.json')), limits['manifest.json']),
    );
    for (const [key, expected] of Object.entries(manifest.hashes))
      if (digest(files.get(key)!) !== expected)
        throw new Error('存档校验失败，文件可能被修改或损坏。');
    const room = roomSchema.parse(
      parsePortable(decoder.decode(files.get('room.json')), limits['room.json']),
    ) as Room;
    if (
      !validRoomReferences(room) ||
      room.log.some(
        (e) =>
          !validEvent(e) ||
          (e.image &&
            (manifest.schemaVersion === 1 ||
              !manifest.includeImages ||
              !e.image.reference ||
              e.image.reference.path !== imageFilename(e.image))),
      ) ||
      new Set(room.log.map((e) => e.id)).size !== room.log.length
    )
      throw new Error('存档角色、记录或遭遇引用无效。');
    if (
      room.phase === 'active' &&
      room.members.some(
        (m) =>
          m.role === 'player' &&
          (!m.character ||
            m.review.status !== 'approved' ||
            m.review.policyRevision !== room.policyRevision ||
            m.review.characterRevision > m.characterRevision ||
            validateCreation(m.character, room.creationPolicy).length > 0),
      )
    )
      throw new Error('进行中的存档含未通过审核或不符合制卡要求的角色，请检查存档。');
    return { room, exportedAt: manifest.exportedAt };
  } catch (error) {
    throw new Error(
      `无法读取幕间存档：${error instanceof z.ZodError ? '结构或版本不受支持。' : (error as Error).message}`,
    );
  }
}
function validEvent(e: RoomEvent) {
  return (
    (e.type === 'roll') === !!e.roll &&
    (e.type === 'check') === !!e.check &&
    (!e.image || (e.type === 'chat' && e.visibility === 'public')) &&
    (!e.imageDescription || e.type === 'chat')
  );
}
