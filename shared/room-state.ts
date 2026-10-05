import { z } from 'zod';
import { AtlasLibrarySchema } from './atlas.ts';
import { PublicSceneSchema } from './room-config.ts';
import { ChatImageSchema } from './media.ts';
import { CreationPolicySchema } from './creation.ts';
import { KeeperCardSchema } from './keeper.ts';
import { DndStatBlockSchema } from './dnd.ts';
import { EncounterSchema, validateEncounterReferences } from './encounter.ts';
import { getCharacterErrors } from './rules.ts';
import type { Character, Room, RoomEvent } from './types.ts';
const id = z.string().min(1).max(100);
const name = z.string().trim().min(1).max(60);
const ruleSchema = z.enum(['dnd', 'coc']);
const modeSchema = z.enum(['in-room', 'external']);
const visibilitySchema = z.enum(['public', 'host']);
const codeSchema = z.string().regex(/^[A-Z0-9]{6}$/);
const revision = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER - 1);
const reviewSchema = z
  .object({
    status: z.enum(['pending', 'approved', 'changes']),
    note: z.string().max(2000),
    reviewedAt: z.iso.datetime().nullable(),
    characterRevision: revision,
    policyRevision: revision,
  })
  .strict();
const characterSchema = z.custom<Character>((value) => {
  try {
    return getCharacterErrors(value as Character).length === 0;
  } catch {
    return false;
  }
}, '角色卡格式或数值无效');
const memberSchema = z
  .object({
    id,
    name,
    role: z.enum(['host', 'player']),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    online: z.boolean(),
    ready: z.boolean(),
    character: characterSchema.nullable(),
    characterRevision: revision,
    review: reviewSchema,
  })
  .strict();
const diceSchema = z
  .object({
    expression: z.string().max(120),
    groups: z
      .array(
        z
          .object({
            count: z.number().int().min(1).max(100),
            sides: z.number().int().min(2).max(1000),
            rolls: z.array(z.number().int()).max(100),
            sign: z.union([z.literal(-1), z.literal(1)]),
          })
          .strict()
          .refine(
            (group) =>
              group.rolls.length === group.count &&
              group.rolls.every((roll) => roll >= 1 && roll <= group.sides),
          ),
      )
      // Each group contains at least one die; rollDice permits 100 dice in total.
      .max(100),
    modifier: z.number().int(),
    total: z.number().int(),
  })
  .strict();
const checkResultSchema = z
  .object({
    label: z.string().max(200),
    rolls: z.array(z.number().int()).max(20),
    selected: z.number().int(),
    modifier: z.number().int(),
    total: z.number().int(),
    target: z.number().int(),
    outcome: z.string().max(200),
    success: z.boolean(),
  })
  .strict();
export const eventSchema = z
  .object({
    id,
    type: z.enum(['system', 'chat', 'roll', 'check']),
    memberId: z.string().max(100),
    name: z.string().max(60),
    content: z.string().max(4000),
    createdAt: z.iso.datetime(),
    visibility: visibilitySchema,
    requestId: id.optional(),
    image: ChatImageSchema.optional(),
    scene: PublicSceneSchema.optional(),
    imageDescription: z
      .object({ name: z.string().max(160), description: z.string().trim().min(1).max(2000) })
      .strict()
      .optional(),
    secretLabel: z.string().max(200).optional(),
    roll: diceSchema.optional(),
    check: checkResultSchema.optional(),
  })
  .strict();
export const roomSchema = z
  .object({
    code: codeSchema,
    name,
    rule: ruleSchema,
    hostId: id,
    mode: modeSchema,
    phase: z.enum(['lobby', 'active']),
    members: z.array(memberSchema).min(1).max(8),
    log: z.array(eventSchema),
    historyComplete: z.boolean().default(true),
    scene: PublicSceneSchema,
    initiative: z.array(z.object({ memberId: id, value: z.number().int() }).strict()).max(8),
    activeTurn: z.number().int().min(0).max(7),
    round: z.number().int().min(0).max(100000),
    createdAt: z.iso.datetime(),
    creationPolicy: CreationPolicySchema,
    policyRevision: revision,
    configRevision: revision,
    atlases: AtlasLibrarySchema,
    keeperCards: z.array(KeeperCardSchema).max(200),
    dndCards: z.array(DndStatBlockSchema).max(200),
    encounter: EncounterSchema,
  })
  .strict();

export function validRoomReferences(room: Room): boolean {
  const ids = new Set(room.members.map((m) => m.id));
  return !(
    ids.size !== room.members.length ||
    !ids.has(room.hostId) ||
    room.members.filter((m) => m.role === 'host').length !== 1 ||
    room.members.find((m) => m.id === room.hostId)?.role !== 'host' ||
    room.members.some((m) => m.character && m.character.rule !== room.rule) ||
    room.creationPolicy.rule !== room.rule ||
    room.atlases.some((a) => a.rule !== 'any' && a.rule !== room.rule) ||
    (room.rule !== 'coc' && room.keeperCards.length > 0) ||
    (room.rule !== 'dnd' && room.dndCards.length > 0) ||
    new Set(room.dndCards.map((card) => card.id)).size !== room.dndCards.length ||
    !validateEncounterReferences(room.encounter, room.members, room.rule) ||
    new Set(room.keeperCards.map((card) => card.id)).size !== room.keeperCards.length ||
    room.initiative.some((i) => !ids.has(i.memberId)) ||
    new Set(room.initiative.map((i) => i.memberId)).size !== room.initiative.length ||
    (room.initiative.length > 0 && room.activeTurn >= room.initiative.length)
  );
}
/** Whitelist visible fields. Never spread a private event into a player payload. */
export function visibleEvent(event: RoomEvent, isHost: boolean): RoomEvent | null {
  if (isHost || event.visibility === 'public') return event;
  if (!['roll', 'check'].includes(event.type) && !event.secretLabel) return null;
  const label = event.roll?.expression ?? event.check?.label ?? event.secretLabel ?? '暗骰';
  return {
    id: event.id,
    type: event.type === 'system' ? 'check' : event.type,
    memberId: event.memberId,
    name: event.name,
    createdAt: event.createdAt,
    visibility: 'host',
    content: `${label} = ？ · 结果 ？`,
    secret: { label },
  };
}
