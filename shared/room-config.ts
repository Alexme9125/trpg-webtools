import { z } from 'zod';
import { CreationPolicySchema } from './creation';
import type { Room } from './types';
import { parsePortable, portableMarkdown } from './portable';

export const MAX_ROOM_CONFIG_BYTES = 128 * 1024;
export const PublicSceneSchema = z
  .object({
    title: z.string().max(100),
    description: z.string().max(4000),
  })
  .strict();
export const RoomConfigSchema = z
  .object({
    documentType: z.literal('interlude-room-config'),
    schemaVersion: z.literal(1),
    rule: z.enum(['coc', 'dnd']),
    name: z.string().trim().min(1).max(60),
    mode: z.enum(['in-room', 'external']),
    creationPolicy: CreationPolicySchema,
    scene: PublicSceneSchema,
  })
  .strict()
  .refine((c) => c.rule === c.creationPolicy.rule, '制卡规则与房间规则不匹配');
export type RoomConfig = z.infer<typeof RoomConfigSchema>;
export function roomConfiguration(room: Room): RoomConfig {
  return RoomConfigSchema.parse({
    documentType: 'interlude-room-config',
    schemaVersion: 1,
    rule: room.rule,
    name: room.name,
    mode: room.mode,
    creationPolicy: room.creationPolicy,
    scene: room.scene,
  });
}
export function parseRoomConfig(text: string): RoomConfig {
  const result = RoomConfigSchema.safeParse(parsePortable(text, MAX_ROOM_CONFIG_BYTES));
  if (!result.success)
    throw new Error(`房间配置无效：${result.error.issues[0]?.message ?? '请核对版本与字段'}`);
  return result.data;
}
export function exportRoomConfig(config: RoomConfig, format: 'json' | 'md') {
  const checked = RoomConfigSchema.parse(config);
  return format === 'json'
    ? JSON.stringify(checked, null, 2)
    : portableMarkdown(
        `${checked.name} · 房间配置`,
        checked,
        '包含房名、规则、演绎方式、制卡要求与当前公开场景。人员、凭证、记录和备团库另行保存。',
      );
}
