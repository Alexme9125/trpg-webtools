import { describe, expect, it, vi } from 'vitest';
import {
  createDndStatBlock,
  DndStatBlockSchema,
  type DndAction,
  type DndStatBlock,
} from '../shared/dnd';
import {
  addEncounterCards,
  CombatantSchema,
  compareCocMelee,
  concentrationDC,
  deathSaveSuggestion,
  emptyEncounter,
  EncounterSchema,
  encounterView,
  nextEncounterTurn,
  orderEncounter,
  removeCombatant,
  syncEncounterPlayers,
  updateCombatant,
  validateEncounterReferences,
  type CombatantPatch,
  type EncounterState,
} from '../shared/encounter';
import { createKeeperCard } from '../shared/keeper';
import { createCharacter, rollCheck } from '../shared/rules';
import type { CheckResult, Member, RuleId } from '../shared/types';

function sequence(...values: number[]) {
  let index = 0;
  return vi.fn((_sides: number) => {
    if (index >= values.length) throw new Error('Test dice sequence exhausted');
    return values[index++];
  });
}

function cocCheck(target: number, roll: number): CheckResult {
  const units = roll % 10;
  const tens = roll === 100 ? 0 : Math.floor(roll / 10);
  return rollCheck(
    'coc',
    null,
    {
      kind: 'skill',
      key: '近战',
      dc: 0,
      modifier: 0,
      edge: 'normal',
      target,
    },
    sequence(units + 1, tens + 1),
  );
}

function dndCard(name = '桥灯守卫', dex: number | null = 12): DndStatBlock {
  const card = createDndStatBlock('npc-bridge-guard');
  return { ...card, name, attributes: { ...card.attributes, dex } };
}

function member(id: string, rule: RuleId = 'dnd', patch: Partial<Member> = {}): Member {
  const character = createCharacter(rule, () => 4);
  return {
    id,
    name: `成员 ${id}`,
    role: 'player',
    color: '#778899',
    online: true,
    ready: true,
    character: {
      ...character,
      id: `character-${id}`,
      name: `角色 ${id}`,
      occupation: rule === 'dnd' ? '战士' : '记者',
      hp: 10,
      maxHp: 20,
      ac: 16,
      attributes: { ...character.attributes, dex: rule === 'dnd' ? 14 : 60 },
    },
    characterRevision: 1,
    review: {
      status: 'approved',
      note: '',
      reviewedAt: null,
      characterRevision: 1,
      policyRevision: 0,
    },
    ...patch,
  };
}

function threeNpcs(): EncounterState {
  return orderEncounter(
    addEncounterCards(
      emptyEncounter(),
      [dndCard('甲', 16), dndCard('乙', 14), dndCard('丙', 12)],
      1,
    ),
    'dnd',
    () => 10,
  );
}

describe('CoC 7 melee opposed checks', () => {
  it.each([
    ['普通成功', 50, 40, 80, 70],
    ['困难成功', 50, 20, 80, 30],
    ['极难成功', 50, 9, 80, 12],
    ['大成功', 50, 1, 80, 1],
  ])(
    'equal %s favors dodge but favors the attacker against fight-back',
    (_level, at, ar, dt, dr) => {
      const attack = cocCheck(Number(at), Number(ar));
      const defense = cocCheck(Number(dt), Number(dr));
      expect(compareCocMelee(attack, defense, 'dodge')).toContain('防守方闪避成功');
      expect(compareCocMelee(attack, defense, 'fight-back')).toContain('进攻方命中');
    },
  );

  it.each(['dodge', 'fight-back'] as const)(
    'both failures cause no damage for %s, even if one is a fumble',
    (response) => {
      expect(compareCocMelee(cocCheck(50, 70), cocCheck(20, 99), response)).toContain('双方失败');
      expect(compareCocMelee(cocCheck(20, 100), cocCheck(50, 100), response)).toContain(
        '均未造成伤害',
      );
    },
  );

  it('compares success levels rather than raw roll size or skill magnitude', () => {
    const hard = cocCheck(40, 19);
    const extreme = cocCheck(95, 18);
    expect(compareCocMelee(hard, extreme, 'fight-back')).toContain('反击只造成普通伤害');
    expect(compareCocMelee(extreme, hard, 'dodge')).toContain('进攻方命中');
    expect(compareCocMelee(cocCheck(90, 80), cocCheck(40, 39), 'fight-back')).toContain(
      '进攻方命中',
    );
    expect(compareCocMelee(cocCheck(50, 100), cocCheck(50, 45), 'fight-back')).toContain(
      '防守方反击成功',
    );
  });

  it('uses floored hard/extreme boundaries for odd skill values', () => {
    const target = 59;
    const results = [11, 12, 29, 30, 59, 60].map((roll) => cocCheck(target, roll));
    expect(results.map((result) => result.outcome)).toEqual([
      '极难成功',
      '困难成功',
      '困难成功',
      '普通成功',
      '普通成功',
      '失败',
    ]);
    expect(compareCocMelee(results[0], results[1], 'dodge')).toContain('进攻方命中');
    expect(compareCocMelee(results[2], results[3], 'dodge')).toContain('进攻方命中');
    expect(compareCocMelee(results[1], results[2], 'dodge')).toContain('防守方闪避成功');
    expect(compareCocMelee(results[4], results[5], 'fight-back')).toContain('进攻方命中');
  });

  it('keeps above-100 skill thresholds while 100 remains a fumble and 1 remains critical', () => {
    expect([30, 31, 75, 76, 99, 100].map((roll) => cocCheck(150, roll).outcome)).toEqual([
      '极难成功',
      '困难成功',
      '困难成功',
      '普通成功',
      '普通成功',
      '大失败',
    ]);
    expect(compareCocMelee(cocCheck(150, 30), cocCheck(100, 21), 'dodge')).toContain('进攻方命中');
    expect(compareCocMelee(cocCheck(150, 31), cocCheck(100, 20), 'fight-back')).toContain(
      '防守方反击成功',
    );
    expect(compareCocMelee(cocCheck(100000, 100), cocCheck(49, 96), 'fight-back')).toContain(
      '双方失败',
    );
    expect(compareCocMelee(cocCheck(0, 1), cocCheck(100000, 2), 'dodge')).toContain('进攻方命中');
  });
});

describe('encounter initiative and turns', () => {
  it('rolls D&D d20 plus the floored DEX modifier, preserves ties, and ignores firearm readiness', () => {
    let state = addEncounterCards(
      emptyEncounter(),
      [dndCard('低敏捷', 9), dndCard('高敏捷', 18), dndCard('第三位', 10)],
      1,
    );
    state = updateCombatant(state, state.participants[0].id, { firearmReady: true });
    const before = structuredClone(state);
    const rng = sequence(20, 15, 1);
    const ordered = orderEncounter(state, 'dnd', rng);
    expect(ordered.participants.map((entry) => entry.name)).toEqual([
      '低敏捷 · 1',
      '高敏捷 · 1',
      '第三位 · 1',
    ]);
    expect(ordered.participants.map((entry) => entry.initiative)).toEqual([19, 19, 1]);
    expect(rng.mock.calls.map(([sides]) => sides)).toEqual([20, 20, 20]);
    expect(ordered).toMatchObject({
      activeId: state.participants[0].id,
      round: 1,
      revision: state.revision + 1,
    });
    expect(state).toEqual(before);
  });

  it('uses CoC DEX plus 50 for readied firearms without rolling any dice', () => {
    const slow = createKeeperCard('npc-bystander', { name: '已备枪械' });
    slow.attributes.dex = 40;
    const fast = createKeeperCard('npc-bystander', { name: '敏捷调查者' });
    fast.attributes.dex = 80;
    let state = addEncounterCards(emptyEncounter(), [slow, fast], 1);
    state = updateCombatant(state, state.participants[0].id, { firearmReady: true });
    const rng = vi.fn(() => 1);
    const ordered = orderEncounter(state, 'coc', rng);
    expect(ordered.participants.map((entry) => entry.initiative)).toEqual([90, 80]);
    expect(ordered.participants[0].name).toContain('已备枪械');
    expect(rng).not.toHaveBeenCalled();
  });

  it.each(['dnd', 'coc'] as const)(
    'lets a manual %s override replace all initiative computation, including unknown DEX',
    (rule) => {
      const card = rule === 'dnd' ? dndCard('手动', null) : createKeeperCard('monster-blank');
      card.attributes.dex = null;
      let state = addEncounterCards(emptyEncounter(), [card], 1);
      const id = state.participants[0].id;
      state = updateCombatant(state, id, { initiativeOverride: 0, firearmReady: true });
      const rng = vi.fn(() => 1);
      expect(orderEncounter(state, rule, rng).participants[0].initiative).toBe(0);
      state = updateCombatant(state, id, { initiativeOverride: -10 });
      expect(orderEncounter(state, rule, rng).participants[0].initiative).toBe(-10);
      expect(rng).not.toHaveBeenCalled();
    },
  );

  it('validates the whole initiative roster before dice are consumed or any state changes', () => {
    const state = addEncounterCards(
      emptyEncounter(),
      [dndCard('已知', 14), dndCard('未知', null)],
      1,
    );
    const before = structuredClone(state);
    const rng = vi.fn(() => 15);
    expect(() => orderEncounter(state, 'dnd', rng)).toThrow('未知');
    expect(rng).not.toHaveBeenCalled();
    expect(state).toEqual(before);
    expect(() => orderEncounter(state, 'coc', rng)).toThrow('规则');
    expect(() => orderEncounter(emptyEncounter(), 'dnd', rng)).toThrow('先加入');
    expect(rng).not.toHaveBeenCalled();
  });

  it('advances one turn at a time and increments rounds only on wrapping', () => {
    const state = threeNpcs();
    const before = structuredClone(state);
    const second = nextEncounterTurn(state);
    const third = nextEncounterTurn(second);
    const wrapped = nextEncounterTurn(third);
    expect([second.activeId, third.activeId, wrapped.activeId]).toEqual([
      state.participants[1].id,
      state.participants[2].id,
      state.participants[0].id,
    ]);
    expect([second.round, third.round, wrapped.round]).toEqual([1, 1, 2]);
    expect(wrapped.revision).toBe(state.revision + 3);
    expect(state).toEqual(before);
    expect(() => nextEncounterTurn(emptyEncounter())).toThrow('先生成');
  });

  it('removes the active middle NPC by selecting its next surviving turn', () => {
    const state = nextEncounterTurn(threeNpcs());
    const before = structuredClone(state);
    const removed = removeCombatant(state, state.activeId!);
    expect(removed.activeId).toBe(state.participants[2].id);
    expect(removed.round).toBe(1);
    expect(removed.participants.map((entry) => entry.id)).toEqual([
      state.participants[0].id,
      state.participants[2].id,
    ]);
    expect(state).toEqual(before);
  });

  it('increments the round when deleting the active tail wraps to the first survivor', () => {
    const state = nextEncounterTurn(nextEncounterTurn(threeNpcs()));
    const result = removeCombatant(state, state.activeId!);
    expect(result.activeId).toBe(state.participants[0].id);
    expect(result.round).toBe(2);
    const notStarted = removeCombatant({ ...state, round: 0 }, state.activeId!);
    expect(notStarted.activeId).toBe(state.participants[0].id);
    expect(notStarted.round).toBe(0);
  });

  it('keeps an unaffected active turn and clears the round when the last NPC is removed', () => {
    const state = threeNpcs();
    const fewer = removeCombatant(state, state.participants[2].id);
    expect(fewer.activeId).toBe(state.activeId);
    expect(fewer.round).toBe(state.round);
    const one = removeCombatant(fewer, fewer.participants[1].id);
    const empty = removeCombatant(one, one.participants[0].id);
    expect(empty).toMatchObject({ participants: [], activeId: null, round: 0 });
    expect(() => removeCombatant(state, 'missing')).toThrow('已不在');
  });
});

describe('template snapshots and per-instance resources', () => {
  it('isolates snapshots, conditions and ability counters across duplicates and template edits', () => {
    const template = dndCard();
    template.hp = 7;
    template.actions[0].uses = 3;
    template.actions[0].recharge = '每日';
    const before = structuredClone(template);
    const state = addEncounterCards(emptyEncounter(), [template], 2);
    const [first, second] = state.participants;
    expect(first.id).not.toBe(second.id);
    expect(first.sourceCardId).toBe(template.id);
    expect(first.abilities[0].id).not.toBe(second.abilities[0].id);
    const changed = updateCombatant(state, first.id, {
      hp: 1,
      conditions: ['倒地'],
      abilities: [{ ...first.abilities[0], remaining: 1 }],
    });
    expect(changed.participants[0]).toMatchObject({
      hp: 1,
      conditions: ['倒地'],
      abilities: [{ remaining: 1, maxUses: 3 }],
    });
    expect(changed.participants[1]).toMatchObject({
      hp: 7,
      conditions: [],
      abilities: [{ remaining: 3 }],
    });
    expect(template).toEqual(before);
    expect(state.participants[0].hp).toBe(7);
    template.maxHp = 999;
    template.actions[0].description = '模板已经修改';
    expect(changed.participants[0].source).toEqual(before);
    expect(changed.participants[1].source).toEqual(before);
    changed.participants[0].source!.notes = '修改一份快照';
    expect(changed.participants[1].source!.notes).toBe(before.notes);
  });

  it('accepts every legal D&D action resource boundary plus legendary resources', () => {
    const template = dndCard('名'.repeat(120), 30);
    const action = (group: string, i: number): DndAction => ({
      id: `${group}-${i}`,
      name: '能'.repeat(120),
      description: '',
      attackBonus: null,
      damage: '',
      saveDc: null,
      saveAbility: '',
      uses: 100000,
      recharge: '恢'.repeat(200),
    });
    for (const group of ['traits', 'actions', 'reactions', 'legendaryActions'] as const)
      template[group] = Array.from({ length: 50 }, (_, i) => action(group, i));
    template.legendaryActionCount = 100;
    expect(DndStatBlockSchema.safeParse(template).success).toBe(true);
    const state = addEncounterCards(emptyEncounter(), [template], 1);
    const instance = state.participants[0];
    expect(instance.name).toHaveLength(120);
    expect(instance.abilities).toHaveLength(201);
    expect(instance.abilities[0]).toMatchObject({
      name: '能'.repeat(120),
      maxUses: 100000,
      remaining: 100000,
      recharge: '恢'.repeat(200),
    });
    expect(instance.abilities[200]).toMatchObject({
      name: '传奇动作点数',
      maxUses: 100,
      remaining: 100,
    });
    expect(EncounterSchema.safeParse(state).success).toBe(true);
    expect(
      CombatantSchema.safeParse({
        ...instance,
        abilities: [...instance.abilities, { ...instance.abilities[0], id: 'extra' }],
      }).success,
    ).toBe(false);
  });

  it('preserves unknown max HP/current HP instead of inventing or healing either', () => {
    const template = dndCard();
    template.hp = 7;
    template.maxHp = null;
    template.hitDice = '50d20 + 500';
    const first = addEncounterCards(emptyEncounter(), [template], 1).participants[0];
    expect(first).toMatchObject({ hp: 7, maxHp: null });
    template.hp = null;
    template.maxHp = 27;
    const second = addEncounterCards(emptyEncounter(), [template], 1).participants[0];
    expect(second).toMatchObject({ hp: null, maxHp: 27 });
  });

  it('enforces capacities and validates ability counters without changing old state', () => {
    const card = dndCard();
    let state = addEncounterCards(emptyEncounter(), [card], 20);
    state = addEncounterCards(state, [card], 20);
    state = addEncounterCards(state, [card], 20);
    const before = structuredClone(state);
    expect(state.participants).toHaveLength(60);
    expect(() => addEncounterCards(state, [card], 1)).toThrow('最多 60');
    expect(() => addEncounterCards(emptyEncounter(), [card], 21)).toThrow('1–20');
    expect(() => addEncounterCards(emptyEncounter(), [], 1)).toThrow();
    expect(() =>
      updateCombatant(state, state.participants[0].id, {
        abilities: [{ id: 'resource', name: '法术', maxUses: 1, remaining: 2, recharge: '' }],
      }),
    ).toThrow('不能超过');
    expect(state).toEqual(before);
  });
});

describe('encounter visibility and player synchronization', () => {
  it('hides unrevealed NPCs and hidden active IDs, and strips all private fields from revealed NPCs', () => {
    const template = dndCard('秘密真名');
    template.notes = '秘密剧情与弱点';
    template.hp = 5;
    template.actions[0].uses = 3;
    let state = addEncounterCards(emptyEncounter(), [template], 2);
    const secret = state.participants[0];
    const visible = state.participants[1];
    state = updateCombatant(state, visible.id, {
      publicName: '披斗篷的访客',
      revealed: true,
      notes: '私密战术',
      initiativeOverride: 99,
      concentration: '秘密法术',
      tempHp: 5,
      deathFailures: 2,
      firearmReady: true,
      majorWound: true,
      dying: true,
      conditions: ['倒地'],
    });
    state = { ...state, activeId: secret.id, round: 2 };
    const before = structuredClone(state);
    const publicState = encounterView(state, false);
    expect(publicState.participants).toHaveLength(1);
    expect(publicState.activeId).toBeNull();
    expect(publicState.participants[0]).toMatchObject({
      name: '披斗篷的访客',
      publicName: '披斗篷的访客',
      source: null,
      sourceCardId: null,
      dex: null,
      hp: null,
      maxHp: null,
      ac: null,
      notes: '',
      abilities: [],
      initiativeOverride: null,
      tempHp: 0,
      concentration: '',
      deathFailures: 0,
      firearmReady: false,
      majorWound: false,
      dying: false,
      conditions: ['倒地'],
    });
    const encoded = JSON.stringify(publicState);
    for (const secretValue of [
      '秘密真名',
      '秘密剧情与弱点',
      '私密战术',
      '秘密法术',
      template.id,
      secret.id,
    ])
      expect(encoded).not.toContain(secretValue);
    expect(state).toEqual(before);
    expect(encounterView(state, true)).toEqual(state);
  });

  it('shows a revealed active turn and player resources while hiding player encounter notes', () => {
    const player = member('player-a');
    let state = syncEncounterPlayers(addEncounterCards(emptyEncounter(), [dndCard()], 1), [player]);
    const npcId = state.participants[0].id;
    state = updateCombatant(state, npcId, { revealed: true, publicName: '守卫' });
    state = updateCombatant(state, player.id, {
      notes: '主持人记录的玩家秘密',
      conditions: ['受惊'],
      hp: 4,
    });
    state = { ...state, activeId: npcId, round: 1 };
    const view = encounterView(state, false);
    expect(view.activeId).toBe(npcId);
    expect(view.participants.find((entry) => entry.memberId === player.id)).toMatchObject({
      hp: 4,
      maxHp: 20,
      conditions: ['受惊'],
      notes: '',
    });
    expect(JSON.stringify(view)).not.toContain('主持人记录的玩家秘密');
  });

  it('syncs current player membership and authoritative card resources without erasing NPC state', () => {
    const kept = member('kept');
    const leaving = member('leaving');
    const host = member('host', 'dnd', { role: 'host' });
    const draft = member('draft', 'dnd', { character: null });
    let state = syncEncounterPlayers(addEncounterCards(emptyEncounter(), [dndCard()], 1), [
      kept,
      leaving,
      host,
      draft,
    ]);
    expect(state.participants).toHaveLength(3);
    const npcId = state.participants[0].id;
    state = updateCombatant(state, npcId, { hp: 2, notes: 'NPC 私密记录', conditions: ['倒地'] });
    state = updateCombatant(state, kept.id, {
      notes: '玩家临场笔记',
      initiativeOverride: 42,
      conditions: ['受惊'],
      concentration: '祝福术',
      tempHp: 5,
    });
    const npcBefore = structuredClone(state.participants[0]);
    kept.character = {
      ...kept.character!,
      name: '新角色名',
      hp: 6,
      maxHp: 25,
      ac: 18,
      attributes: { ...kept.character!.attributes, dex: 16 },
    };
    const result = syncEncounterPlayers(state, [kept, host, draft]);
    expect(result.participants).toHaveLength(2);
    expect(result.participants[0]).toEqual(npcBefore);
    expect(result.participants[1]).toMatchObject({
      memberId: kept.id,
      name: '新角色名',
      hp: 6,
      maxHp: 25,
      ac: 18,
      dex: 16,
      notes: '玩家临场笔记',
      initiativeOverride: 42,
      conditions: ['受惊'],
      concentration: '祝福术',
      tempHp: 5,
    });
    expect(result.participants.some((entry) => entry.memberId === leaving.id)).toBe(false);
    expect(syncEncounterPlayers(result, [kept, host, draft])).toBe(result);
    expect(validateEncounterReferences(result, [kept, host, draft], 'dnd')).toBe(true);
    expect(validateEncounterReferences(result, [kept, host, draft], 'coc')).toBe(false);
  });

  it('selects the first surviving successor when multiple players leave before and at the active turn', () => {
    const first = member('departed-first');
    const active = member('departed-active');
    const npcState = addEncounterCards(emptyEncounter(), [dndCard('甲'), dndCard('乙')], 1);
    const all = syncEncounterPlayers(npcState, [first, active]);
    const [npcA, npcB, playerA, playerB] = all.participants;
    const state = {
      ...all,
      participants: [playerA, npcA, playerB, npcB],
      activeId: playerB.id,
      round: 3,
    };
    const result = syncEncounterPlayers(state, []);
    expect(result.participants.map((entry) => entry.id)).toEqual([npcA.id, npcB.id]);
    expect(result.activeId).toBe(npcB.id);
    expect(result.round).toBe(3);
  });

  it('increments the round when synchronized departures wrap beyond the original active tail', () => {
    const first = member('departed-first');
    const last = member('departed-last');
    const npcState = addEncounterCards(emptyEncounter(), [dndCard('甲'), dndCard('乙')], 1);
    const all = syncEncounterPlayers(npcState, [first, last]);
    const [npcA, npcB, playerA, playerB] = all.participants;
    const state = {
      ...all,
      participants: [npcA, playerA, npcB, playerB],
      activeId: playerB.id,
      round: 3,
    };
    const result = syncEncounterPlayers(state, []);
    expect(result.participants.map((entry) => entry.id)).toEqual([npcA.id, npcB.id]);
    expect(result.activeId).toBe(npcA.id);
    expect(result.round).toBe(4);
  });

  it('appends a newly synchronized player without rerolling, reordering or changing the active slot', () => {
    const first = member('existing');
    const newcomer = member('newcomer');
    let state = syncEncounterPlayers(addEncounterCards(emptyEncounter(), [dndCard('NPC', 10)], 1), [
      first,
    ]);
    state = orderEncounter(state, 'dnd', sequence(18, 1));
    state = nextEncounterTurn(state);
    const before = structuredClone(state);
    const result = syncEncounterPlayers(state, [first, newcomer]);
    expect(result.participants.slice(0, 2)).toEqual(before.participants);
    expect(result.participants[2]).toMatchObject({
      memberId: newcomer.id,
      initiative: null,
      initiativeOverride: null,
    });
    expect(result.activeId).toBe(before.activeId);
    expect(result.round).toBe(before.round);
    expect(state).toEqual(before);
  });

  it('resets D&D death counters after healing and removes the host from player participation', () => {
    const player = member('healing');
    player.character!.hp = 0;
    let state = syncEncounterPlayers(emptyEncounter(), [player]);
    state = updateCombatant(state, player.id, { deathSuccesses: 2, deathFailures: 2 });
    player.character = { ...player.character!, hp: 1 };
    const healed = syncEncounterPlayers(state, [player]);
    expect(healed.participants[0]).toMatchObject({
      hp: 1,
      deathSuccesses: 0,
      deathFailures: 0,
      stable: false,
    });
    const promoted = syncEncounterPlayers({ ...healed, activeId: player.id, round: 4 }, [
      { ...player, role: 'host' },
    ]);
    expect(promoted).toMatchObject({ participants: [], activeId: null, round: 0 });
  });

  it.each(['name', 'publicName', 'revealed', 'dex', 'maxHp'] as const)(
    'does not permit changing player base %s in an encounter patch',
    (key) => {
      const player = member('player-a');
      const state = syncEncounterPlayers(emptyEncounter(), [player]);
      const before = structuredClone(state);
      const values = {
        name: '伪造名字',
        publicName: '伪造公开名',
        revealed: false,
        dex: 30,
        maxHp: 99,
      };
      expect(() =>
        updateCombatant(state, player.id, { [key]: values[key] } as CombatantPatch),
      ).toThrow('角色卡');
      expect(state).toEqual(before);
    },
  );

  it('rejects hidden base fields and null player HP, but lets scene-only state change', () => {
    const player = member('player-a');
    const state = syncEncounterPlayers(emptyEncounter(), [player]);
    for (const patch of [
      { ac: 50 },
      { rule: 'coc' },
      { sourceCardId: 'monster-id' },
      { memberId: null },
      { id: 'npc-id' },
      { source: dndCard() },
    ])
      expect(() => updateCombatant(state, player.id, patch as unknown as CombatantPatch)).toThrow();
    expect(() => updateCombatant(state, player.id, { hp: null })).toThrow('不能留空');
    expect(() => removeCombatant(state, player.id)).toThrow('随角色同步');
    const result = updateCombatant(state, player.id, {
      hp: 0,
      conditions: ['倒地'],
      notes: '本场记录',
      deathFailures: 1,
    });
    expect(result.participants[0]).toMatchObject({ hp: 0, conditions: ['倒地'], deathFailures: 1 });
    expect(player.character!.hp).toBe(10);
    expect(syncEncounterPlayers(result, [player]).participants[0].hp).toBe(10);
  });
});

describe('D&D concentration and death-save suggestions', () => {
  it.each([
    [0, 10],
    [1, 10],
    [19, 10],
    [20, 10],
    [21, 10],
    [22, 11],
    [23, 11],
    [99, 49],
    [100000, 50000],
  ])('damage %i produces concentration DC %i with halves rounded down', (damage, dc) => {
    expect(concentrationDC(damage)).toBe(dc);
  });

  it.each([-1, 1.5, 100001, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid concentration damage %s',
    (damage) => {
      expect(() => concentrationDC(damage)).toThrow('整数');
    },
  );

  it('distinguishes natural 1, natural 20 and the ordinary 9/10 boundary', () => {
    expect(deathSaveSuggestion(1)).toMatchObject({ successes: 0, failures: 2, heal: 0 });
    expect(deathSaveSuggestion(20)).toMatchObject({ successes: 0, failures: 0, heal: 1 });
    expect(deathSaveSuggestion(20).text).toContain('清除');
    expect(deathSaveSuggestion(9)).toMatchObject({ successes: 0, failures: 1, heal: 0 });
    expect(deathSaveSuggestion(10)).toMatchObject({ successes: 1, failures: 0, heal: 0 });
    expect(deathSaveSuggestion(19)).toMatchObject({ successes: 1, failures: 0, heal: 0 });
  });

  it.each([0, 21, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects non-d20 death-save input %s',
    (roll) => {
      expect(() => deathSaveSuggestion(roll)).toThrow('1–20');
    },
  );
});
