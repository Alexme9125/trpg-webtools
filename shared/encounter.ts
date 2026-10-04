import { z } from 'zod';
import { DndStatBlockSchema, type DndStatBlock } from './dnd';
import { KeeperCardSchema, type KeeperCard } from './keeper';
import { rollDice, type DieRandom } from './rules';
import type { CheckResult, Member, RuleId } from './types';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const score = z.number().int().min(0).max(100000).nullable();
const order = z.number().int().min(-100).max(100100).nullable();
const edge = z.enum(['normal', 'advantage', 'disadvantage']);
const resourceSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(120),
    maxUses: z.number().int().min(1).max(100000),
    remaining: z.number().int().min(0).max(100000),
    recharge: z.string().max(200),
  })
  .strict()
  .refine((r) => r.remaining <= r.maxUses, '剩余次数不能超过上限');

export const CombatantSchema = z
  .object({
    id,
    memberId: id.nullable(),
    sourceCardId: id.nullable(),
    source: z.union([KeeperCardSchema, DndStatBlockSchema]).nullable(),
    rule: z.enum(['dnd', 'coc']),
    kind: z.enum(['player', 'npc', 'monster']),
    name: z.string().trim().min(1).max(120),
    publicName: z.string().trim().min(1).max(60),
    revealed: z.boolean(),
    dex: score,
    initiative: order,
    initiativeOverride: order,
    hp: score,
    maxHp: score,
    ac: z.number().int().min(0).max(100).nullable(),
    tempHp: z.number().int().min(0).max(100000),
    conditions: z.array(z.string().trim().min(1).max(60)).max(20),
    concentration: z.string().max(200),
    deathSuccesses: z.number().int().min(0).max(3),
    deathFailures: z.number().int().min(0).max(3),
    stable: z.boolean(),
    majorWound: z.boolean(),
    dying: z.boolean(),
    firearmReady: z.boolean(),
    notes: z.string().max(4000),
    abilities: z.array(resourceSchema).max(201),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.hp !== null && c.maxHp !== null && c.hp > c.maxHp)
      ctx.addIssue({ code: 'custom', path: ['hp'], message: 'HP 不能超过已知上限' });
    if (new Set(c.abilities.map((a) => a.id)).size !== c.abilities.length)
      ctx.addIssue({ code: 'custom', path: ['abilities'], message: '能力编号重复' });
    if (new Set(c.conditions).size !== c.conditions.length)
      ctx.addIssue({ code: 'custom', path: ['conditions'], message: '状态重复' });
    if ((c.kind === 'player') !== (c.memberId !== null))
      ctx.addIssue({ code: 'custom', message: '玩家与成员引用不匹配' });
    if (
      c.source &&
      (c.source.rule !== c.rule || c.source.id !== c.sourceCardId || c.source.kind !== c.kind)
    )
      ctx.addIssue({ code: 'custom', message: '资料快照与参战者不匹配' });
    if (c.kind === 'player' && (c.source !== null || c.sourceCardId !== null))
      ctx.addIssue({ code: 'custom', message: '玩家不能使用怪物资料快照' });
  });
export type Combatant = z.infer<typeof CombatantSchema>;
export type EncounterResource = Combatant['abilities'][number];

export const EncounterSchema = z
  .object({
    participants: z.array(CombatantSchema).max(60),
    activeId: id.nullable(),
    round: z.number().int().min(0).max(100000),
    revision: z.number().int().min(0).max(1000000000),
  })
  .strict()
  .superRefine((state, ctx) => {
    const ids = new Set(state.participants.map((c) => c.id));
    if (ids.size !== state.participants.length)
      ctx.addIssue({ code: 'custom', message: '参战者编号重复' });
    const members = state.participants.flatMap((c) => (c.memberId ? [c.memberId] : []));
    if (new Set(members).size !== members.length)
      ctx.addIssue({ code: 'custom', message: '玩家重复参战' });
    if (state.activeId !== null && !ids.has(state.activeId))
      ctx.addIssue({ code: 'custom', path: ['activeId'], message: '当前回合引用不存在的参战者' });
  });
export type EncounterState = z.infer<typeof EncounterSchema>;
export const CombatantPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    publicName: z.string().trim().min(1).max(60).optional(),
    revealed: z.boolean().optional(),
    dex: score.optional(),
    initiativeOverride: order.optional(),
    hp: score.optional(),
    maxHp: score.optional(),
    tempHp: z.number().int().min(0).max(100000).optional(),
    conditions: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
    concentration: z.string().max(200).optional(),
    deathSuccesses: z.number().int().min(0).max(3).optional(),
    deathFailures: z.number().int().min(0).max(3).optional(),
    stable: z.boolean().optional(),
    majorWound: z.boolean().optional(),
    dying: z.boolean().optional(),
    firearmReady: z.boolean().optional(),
    notes: z.string().max(4000).optional(),
    abilities: z.array(resourceSchema).max(201).optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, '没有要更新的内容');
export type CombatantPatch = z.infer<typeof CombatantPatchSchema>;

export const EncounterActionSchemas = [
  z
    .object({
      type: z.literal('encounter-add'),
      cardId: id,
      count: z.number().int().min(1).max(20),
    })
    .strict(),
  z
    .object({
      type: z.literal('encounter-update'),
      combatantId: id,
      patch: CombatantPatchSchema,
      expectedRevision: z.number().int().min(0).max(1000000000),
    })
    .strict(),
  z.object({ type: z.literal('encounter-remove'), combatantId: id }).strict(),
  z.object({ type: z.literal('encounter-clear') }).strict(),
  z
    .object({
      type: z.literal('coc-melee'),
      attacker: z.string().trim().min(1).max(60),
      defender: z.string().trim().min(1).max(60),
      attackSkill: z.number().int().min(0).max(100000),
      defenseSkill: z.number().int().min(0).max(100000),
      defense: z.enum(['dodge', 'fight-back']),
      attackEdge: edge,
      defenseEdge: edge,
      visibility: z.enum(['public', 'host']),
    })
    .strict(),
] as const;
export type EncounterAction = z.infer<(typeof EncounterActionSchemas)[number]>;
export const emptyEncounter = (): EncounterState => ({
  participants: [],
  activeId: null,
  round: 0,
  revision: 0,
});

function updated(
  state: EncounterState,
  participants: Combatant[],
  activeId = state.activeId,
  round = state.round,
): EncounterState {
  return EncounterSchema.parse({ participants, activeId, round, revision: state.revision + 1 });
}

function survivingTurn(
  state: EncounterState,
  next: Combatant[],
): { activeId: string | null; round: number } {
  if (!next.length) return { activeId: null, round: 0 };
  if (!state.activeId || next.some((p) => p.id === state.activeId))
    return { activeId: state.activeId, round: state.round };
  const index = state.participants.findIndex((p) => p.id === state.activeId);
  for (let offset = 1; offset <= state.participants.length; offset++) {
    const nextIndex = (index + offset) % state.participants.length;
    const candidate = state.participants[nextIndex];
    if (next.some((p) => p.id === candidate.id))
      return {
        activeId: candidate.id,
        round:
          state.round + (state.round > 0 && index + offset >= state.participants.length ? 1 : 0),
      };
  }
  return { activeId: next[0].id, round: state.round };
}

const base = (rule: RuleId) => ({
  rule,
  initiative: null,
  initiativeOverride: null,
  tempHp: 0,
  conditions: [],
  concentration: '',
  deathSuccesses: 0,
  deathFailures: 0,
  stable: false,
  majorWound: false,
  dying: false,
  firearmReady: false,
  notes: '',
  abilities: [],
});

/** Instances keep their own snapshot, so template edits and deletions never change a running scene. */
export function addEncounterCards(
  state: EncounterState,
  cards: (KeeperCard | DndStatBlock)[],
  count: number,
): EncounterState {
  if (!Number.isInteger(count) || count < 1 || count > 20 || !cards.length)
    throw new Error('每次从一份资料生成 1–20 个参战者');
  if (state.participants.length + cards.length * count > 60)
    throw new Error('每场最多 60 个参战者');
  const next = [...state.participants];
  for (const raw of cards) {
    const card = raw.rule === 'coc' ? KeeperCardSchema.parse(raw) : DndStatBlockSchema.parse(raw);
    for (let i = 0; i < count; i++) {
      const sibling = next.filter((p) => p.sourceCardId === card.id).length + 1;
      const instance: Combatant = {
        ...base(card.rule),
        id: crypto.randomUUID(),
        kind: card.kind,
        memberId: null,
        sourceCardId: card.id,
        source: structuredClone(card),
        name: `${card.name} · ${sibling}`.slice(0, 120),
        publicName: `${card.kind === 'npc' ? '人物' : '生物'} ${next.filter((p) => p.kind !== 'player').length + 1}`,
        revealed: false,
        dex: card.attributes.dex,
        hp: card.hp,
        maxHp: card.maxHp,
        ac: card.rule === 'dnd' ? card.ac : null,
      };
      if (card.rule === 'dnd') {
        instance.abilities = [
          ...card.traits,
          ...card.actions,
          ...card.reactions,
          ...card.legendaryActions,
        ]
          .filter((a) => a.uses !== null || a.recharge.trim())
          .map((a) => ({
            id: crypto.randomUUID(),
            name: a.name,
            maxUses: a.uses ?? 1,
            remaining: a.uses ?? 1,
            recharge: a.recharge,
          }))
          .filter((a) => a.maxUses > 0);
        if (card.legendaryActionCount && card.legendaryActionCount > 0)
          instance.abilities.push({
            id: crypto.randomUUID(),
            name: '传奇动作点数',
            maxUses: card.legendaryActionCount,
            remaining: card.legendaryActionCount,
            recharge: '自己回合开始时恢复（主持人确认）',
          });
      }
      next.push(CombatantSchema.parse(instance));
    }
  }
  return updated(state, next);
}

/** Characters remain the single source of player HP; their encounter-only notes/counters survive refreshes. */
export function syncEncounterPlayers(state: EncounterState, members: Member[]): EncounterState {
  const players = members.filter((m) => m.role === 'player' && m.character);
  const ids = new Set(players.map((m) => m.id));
  const next = state.participants.filter((p) => p.memberId === null || ids.has(p.memberId));
  for (const member of players) {
    const card = member.character!;
    const index = next.findIndex((p) => p.memberId === member.id);
    const previous = index >= 0 ? next[index] : undefined;
    const player: Combatant = {
      ...(previous ?? base(card.rule)),
      id: member.id,
      kind: 'player',
      rule: card.rule,
      memberId: member.id,
      sourceCardId: null,
      source: null,
      name: (card.name || member.name).slice(0, 120),
      publicName: (card.name || member.name).slice(0, 60),
      revealed: true,
      dex: card.attributes.dex,
      hp: card.hp,
      maxHp: card.maxHp,
      ac: card.rule === 'dnd' ? card.ac : null,
    };
    if (previous?.hp === 0 && card.hp > 0 && card.rule === 'dnd') {
      player.deathSuccesses = 0;
      player.deathFailures = 0;
      player.stable = false;
    }
    if (index >= 0) next[index] = player;
    else next.push(player);
  }
  if (JSON.stringify(next) === JSON.stringify(state.participants)) return state;
  const turn = survivingTurn(state, next);
  return updated(state, next, turn.activeId, turn.round);
}

export function orderEncounter(
  state: EncounterState,
  rule: RuleId,
  rng?: DieRandom,
): EncounterState {
  if (!state.participants.length) throw new Error('先加入玩家角色或 NPC／怪物');
  for (const c of state.participants) {
    if (c.rule !== rule) throw new Error('参战者规则与房间不一致');
    if (c.dex === null && c.initiativeOverride === null)
      throw new Error(`${c.name} 缺少敏捷，请先补充或手填行动值`);
  }
  const next = state.participants
    .map((c) => ({
      ...c,
      initiative:
        c.initiativeOverride ??
        (rule === 'dnd'
          ? rollDice('1d20', rng).total + Math.floor((c.dex! - 10) / 2)
          : c.dex! + (c.firearmReady ? 50 : 0)),
    }))
    .sort((a, b) => b.initiative - a.initiative);
  return updated(state, next, next[0]?.id ?? null, 1);
}

export function nextEncounterTurn(state: EncounterState): EncounterState {
  if (!state.activeId || !state.participants.length) throw new Error('请先生成行动顺序');
  const nextIndex =
    (state.participants.findIndex((p) => p.id === state.activeId) + 1) % state.participants.length;
  return updated(
    state,
    state.participants,
    state.participants[nextIndex].id,
    state.round + (nextIndex === 0 ? 1 : 0),
  );
}

export function updateCombatant(
  state: EncounterState,
  combatantId: string,
  raw: CombatantPatch,
): EncounterState {
  const patch = CombatantPatchSchema.parse(raw);
  const c = state.participants.find((p) => p.id === combatantId);
  if (!c) throw new Error('该参战者已不在本场');
  if (c.memberId && ['name', 'publicName', 'revealed', 'dex', 'maxHp'].some((key) => key in patch))
    throw new Error('玩家基础资料请在角色卡中修改并重新审核');
  if (c.memberId && patch.hp === null) throw new Error('玩家 HP 不能留空');
  const next = CombatantSchema.parse({ ...c, ...patch });
  if (c.rule === 'dnd' && ((c.hp === 0 && next.hp !== null && next.hp > 0) || next.stable)) {
    next.deathSuccesses = 0;
    next.deathFailures = 0;
    if (next.hp !== null && next.hp > 0) next.stable = false;
  }
  return updated(
    state,
    state.participants.map((p) => (p.id === c.id ? next : p)),
  );
}

export function removeCombatant(state: EncounterState, combatantId: string): EncounterState {
  const index = state.participants.findIndex((p) => p.id === combatantId);
  if (index < 0) throw new Error('该参战者已不在本场');
  if (state.participants[index].memberId) throw new Error('玩家随角色同步，请在房间管理中处理离席');
  const next = state.participants.filter((p) => p.id !== combatantId);
  const turn = survivingTurn(state, next);
  return updated(state, next, turn.activeId, turn.round);
}

/** Strip host data before it ever reaches a player's socket, including hidden turn IDs. */
export function encounterView(state: EncounterState, isHost: boolean): EncounterState {
  if (isHost) return state;
  const participants = state.participants
    .filter((c) => c.kind === 'player' || c.revealed)
    .map((c): Combatant => {
      if (c.kind === 'player') return { ...c, notes: '' };
      return {
        ...base(c.rule),
        id: c.id,
        kind: c.kind,
        memberId: null,
        sourceCardId: null,
        source: null,
        name: c.publicName,
        publicName: c.publicName,
        revealed: true,
        dex: null,
        initiative: c.initiative,
        hp: null,
        maxHp: null,
        ac: null,
        conditions: c.conditions,
      };
    });
  return {
    ...state,
    participants,
    activeId: participants.some((c) => c.id === state.activeId) ? state.activeId : null,
  };
}

export function validateEncounterReferences(
  state: EncounterState,
  members: Member[],
  rule: RuleId,
): boolean {
  if (!EncounterSchema.safeParse(state).success) return false;
  return state.participants.every(
    (c) =>
      c.rule === rule &&
      (c.memberId
        ? members.some(
            (m) =>
              m.id === c.memberId &&
              m.role === 'player' &&
              m.character?.rule === rule &&
              c.id === m.id,
          )
        : c.source !== null && c.source.rule === rule && c.sourceCardId === c.source.id),
  );
}

export function compareCocMelee(
  attack: CheckResult,
  defense: CheckResult,
  response: 'dodge' | 'fight-back',
): string {
  const level = (r: CheckResult) => {
    if (!r.success) return 0;
    if (r.selected === 1) return 4;
    if (r.selected <= Math.floor(r.target / 5)) return 3;
    if (r.selected <= Math.floor(r.target / 2)) return 2;
    return 1;
  };
  const a = level(attack),
    d = level(defense);
  if (a === 0 && d === 0) return '双方失败，本次均未造成伤害。';
  if (response === 'dodge')
    return a > d
      ? '进攻方命中；请按武器与成功等级裁定伤害。'
      : '防守方闪避成功，未受此次攻击伤害。';
  return a >= d
    ? '进攻方命中；请按武器与成功等级裁定伤害。'
    : '防守方反击成功；反击只造成普通伤害。';
}

export function concentrationDC(damage: number): number {
  if (!Number.isInteger(damage) || damage < 0 || damage > 100000)
    throw new Error('伤害须为 0–100000 的整数');
  return Math.max(10, Math.floor(damage / 2));
}

export function deathSaveSuggestion(roll: number): {
  successes: number;
  failures: number;
  heal: number;
  text: string;
} {
  if (!Number.isInteger(roll) || roll < 1 || roll > 20) throw new Error('死亡豁免原始骰须为 1–20');
  if (roll === 20)
    return { successes: 0, failures: 0, heal: 1, text: '自然 20：恢复 1 HP，清除死亡豁免计数。' };
  if (roll === 1) return { successes: 0, failures: 2, heal: 0, text: '自然 1：记录两次失败。' };
  return roll >= 10
    ? { successes: 1, failures: 0, heal: 0, text: '记录一次成功；三次成功后稳定。' }
    : {
        successes: 0,
        failures: 1,
        heal: 0,
        text: '记录一次失败；三次失败意味着死亡，由主持人确认。',
      };
}
