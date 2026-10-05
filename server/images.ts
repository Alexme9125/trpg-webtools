import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ChatImage } from '../shared/media';
import { MAX_IMAGE_BYTES, imageFilename } from '../shared/media';
/** Only raster formats; never serve active SVG / HTML, even if a client changes the filename. */
export function decodeImage(base64: string, mime: ChatImage['mime']): Buffer {
  if (
    !base64 ||
    base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
    base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
  )
    throw new Error('图片数据无效或超过 8 MiB');
  const data = Buffer.from(base64, 'base64');
  if (data.toString('base64') !== base64) throw new Error('图片编码无效');
  if (data.length > MAX_IMAGE_BYTES) throw new Error('图片不能超过 8 MiB');
  const isImage =
    mime === 'image/png'
      ? data.length >= 24 &&
        data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
        data.toString('ascii', 12, 16) === 'IHDR'
      : mime === 'image/jpeg'
        ? data.length >= 4 && data[0] === 255 && data[1] === 216 && data[2] === 255
        : mime === 'image/gif'
          ? data.length >= 13 && ['GIF87a', 'GIF89a'].includes(data.toString('ascii', 0, 6))
          : data.length >= 16 &&
            data.toString('ascii', 0, 4) === 'RIFF' &&
            data.toString('ascii', 8, 12) === 'WEBP';
  if (!isImage) throw new Error('文件内容与图片格式不符，请使用 PNG、JPEG、GIF 或 WebP 图片');
  return data;
}
export function imagePath(directory: string, image: ChatImage) {
  return resolve(directory, imageFilename(image));
}
export function saveImage(directory: string, image: ChatImage, bytes: Buffer) {
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(imagePath(directory, image), bytes, { mode: 0o600, flag: 'wx' });
  } catch {
    throw new Error('图片保存失败，请检查 IMAGE_DIR 的权限和可用空间');
  }
}
export function removeImage(directory: string, image: ChatImage) {
  const path = imagePath(directory, image);
  if (existsSync(path)) unlinkSync(path);
}
