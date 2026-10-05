import type { ChatImage } from './media';
import type { Room, RuleId } from './types';
export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
export interface ArchiveSummary {
  name: string;
  rule: RuleId;
  phase: Room['phase'];
  scene: string;
  exportedAt: string;
  eventCount: number;
  historyComplete: boolean;
  players: { name: string; character: string }[];
  atlasCount: number;
  cardCount: number;
  imageCount: number;
}
export interface ArchivePreparation {
  summary: ArchiveSummary;
  images: {
    image: ChatImage;
    path: string;
    sender: string;
    content: string;
    createdAt: string;
    description: string;
  }[];
}
export function archiveSummary(room: Room, exportedAt: string): ArchiveSummary {
  return {
    name: room.name,
    rule: room.rule,
    phase: room.phase,
    scene: room.scene.title,
    exportedAt,
    eventCount: room.log.length,
    historyComplete: room.historyComplete !== false,
    players: room.members
      .filter((m) => m.role === 'player')
      .map((m) => ({ name: m.name, character: m.character?.name ?? '尚未制卡' })),
    atlasCount: room.atlases.length,
    cardCount: room.keeperCards.length + room.dndCards.length,
    imageCount: room.log.filter((e) => e.image).length,
  };
}
