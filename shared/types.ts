import type { Atlas } from './atlas';
import type { RoomConfig } from './room-config';
import type { ChatImage } from './media';
import type { CreationAllocation, CreationPolicy } from './creation';
import type { KeeperCard } from './keeper';
import type { DndStatBlock } from './dnd';
import type { EncounterAction, EncounterState } from './encounter';
import type { CharacterAdjustmentEdit, CharacterAdjustments } from './adjustments';
export type RuleId = 'dnd' | 'coc';
export type RoomMode = 'in-room' | 'external';
export type Role = 'host' | 'player';
export type Visibility = 'public' | 'host';
export type Edge = 'normal' | 'advantage' | 'disadvantage';

export interface Item {
  id: string;
  name: string;
  quantity: number;
  notes: string;
}
export interface Character {
  schemaVersion: 1;
  id: string;
  rule: RuleId;
  name: string;
  occupation: string;
  ancestry: string;
  background: string;
  age: number;
  level: number;
  attributes: Record<string, number>;
  skills: Record<string, number>;
  proficiencies: string[];
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  san: number;
  maxSan: number;
  ac: number;
  backstory: string;
  notes: string;
  traits: string[];
  items: Item[];
  creation?: CreationAllocation;
  adjustments?: CharacterAdjustments;
  createdAt: string;
  updatedAt: string;
}
export interface DiceGroup {
  count: number;
  sides: number;
  rolls: number[];
  sign: number;
}
export interface DiceResult {
  expression: string;
  groups: DiceGroup[];
  modifier: number;
  total: number;
}
export interface CheckRequest {
  kind: 'ability' | 'skill' | 'save' | 'attack' | 'sanity';
  key: string;
  dc: number;
  modifier: number;
  edge: Edge;
  target?: number;
}
export interface CheckResult {
  label: string;
  rolls: number[];
  selected: number;
  modifier: number;
  total: number;
  target: number;
  outcome: string;
  success: boolean;
}
export interface Member {
  id: string;
  name: string;
  role: Role;
  color: string;
  online: boolean;
  ready: boolean;
  character: Character | null;
  characterRevision: number;
  review: {
    status: 'pending' | 'approved' | 'changes';
    note: string;
    reviewedAt: string | null;
    characterRevision: number;
    policyRevision: number;
  };
}
export interface RoomEvent {
  id: string;
  type: 'system' | 'chat' | 'roll' | 'check';
  memberId: string;
  name: string;
  content: string;
  createdAt: string;
  visibility: Visibility;
  requestId?: string;
  image?: ChatImage;
  scene?: { title: string; description: string };
  imageDescription?: { name: string; description: string };
  /** Server-only label for redacting a compound secret roll. */
  secretLabel?: string;
  /** Player projection; never contains real roll data. */
  secret?: { label: string };
  roll?: DiceResult;
  check?: CheckResult;
}
export interface Room {
  code: string;
  name: string;
  rule: RuleId;
  hostId: string;
  mode: RoomMode;
  phase: 'lobby' | 'active';
  members: Member[];
  log: RoomEvent[];
  historyComplete?: boolean;
  historyBefore?: string;
  /** Host-only projection. Never exported with a room archive. */
  seatClaims?: { memberId: string; code: string }[];
  scene: { title: string; description: string };
  initiative: { memberId: string; value: number }[];
  activeTurn: number;
  round: number;
  createdAt: string;
  creationPolicy: CreationPolicy;
  policyRevision: number;
  configRevision: number;
  atlases: Atlas[];
  keeperCards: KeeperCard[];
  dndCards: DndStatBlock[];
  encounter: EncounterState;
}
export interface Session {
  roomCode: string;
  memberId: string;
  token: string;
}
export type Ack<T = null> = { ok: true; data: T } | { ok: false; error: string };
export interface RoomConnection {
  session: Session;
  room: Room;
}
export interface CreateRoomInput {
  name: string;
  nickname: string;
  rule: RuleId;
  mode: RoomMode;
  configuration?: RoomConfig;
}
export interface JoinRoomInput {
  seatCode?: string;
  code: string;
  nickname: string;
  rule: RuleId;
}
export type RoomAction =
  | EncounterAction
  | { type: 'atlas-save'; atlases: Atlas[] }
  | { type: 'atlas-delete'; atlasId: string }
  | { type: 'atlas-publish'; atlasId: string; sceneId: string }
  | { type: 'room-config'; configuration: RoomConfig; expectedRevision: number }
  | {
      type: 'character-adjust';
      memberId: string;
      characterId: string;
      expectedRevision: number;
      edit: CharacterAdjustmentEdit;
    }
  | { type: 'dnd-save'; cards: DndStatBlock[] }
  | { type: 'dnd-delete'; cardId: string }
  | { type: 'creation-policy'; policy: CreationPolicy; expectedRevision: number }
  | {
      type: 'review-character';
      memberId: string;
      decision: 'approved' | 'changes';
      note: string;
      characterRevision: number;
      policyRevision: number;
    }
  | { type: 'keeper-save'; cards: KeeperCard[] }
  | { type: 'keeper-delete'; cardId: string }
  | { type: 'character'; character: Character }
  | { type: 'ready'; ready: boolean }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'message'; content: string }
  | { type: 'roll'; expression: string; visibility: Visibility; requestId?: string }
  | { type: 'check'; check: CheckRequest; visibility: Visibility; requestId?: string }
  | { type: 'scene'; title: string; description: string }
  | { type: 'mode'; mode: RoomMode }
  | { type: 'resource'; memberId: string; resource: 'hp' | 'mp' | 'san'; value: number }
  | { type: 'item-add'; memberId: string; item: Item }
  | { type: 'item-remove'; memberId: string; itemId: string }
  | { type: 'initiative' }
  | { type: 'next-turn' }
  | { type: 'kick'; memberId: string }
  | { type: 'transfer-host'; memberId: string }
  | { type: 'leave' };
export interface Inspiration {
  suggestion: string;
  example: string;
}
