import { z } from 'zod';
export const IMAGE_RETENTION_DAYS = 14;
export const IMAGE_RETENTION_MS = IMAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
export const IMAGE_RETENTION_NOTICE =
  '图片在最后一次游玩结束后保留 14 天；返回准备、关闭房间或全员离线后开始计时，再次开团会续期。到期自动删除，恢复房间后显示占位符。';
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const ChatImageSchema = z
  .object({
    id: z.string().uuid(),
    mime: z.enum(IMAGE_MIMES),
    name: z.string().min(1).max(160),
    bytes: z.number().int().min(1).max(MAX_IMAGE_BYTES),
    reference: z
      .object({
        storeId: z.string().uuid(),
        path: z.string().regex(/^[a-f0-9-]{36}\.(png|jpg|gif|webp)$/),
        signature: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ChatImage = z.infer<typeof ChatImageSchema>;

export function imageFilename(image: Pick<ChatImage, 'id' | 'mime'>) {
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
  return `${image.id}.${ext[image.mime]}`;
}
