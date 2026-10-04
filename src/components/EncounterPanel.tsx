import { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronRight,
  Dices,
  Eye,
  EyeOff,
  Heart,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  Users,
} from 'lucide-react';
import type {
  CheckRequest,
  Edge,
  Room,
  RoomAction,
  RoomEvent,
  Visibility,
} from '../../shared/types';
import {
  concentrationDC,
  deathSaveSuggestion,
  type Combatant,
  type CombatantPatch,
} from '../../shared/encounter';
import { abilityModifier, proficiencyBonus } from '../../shared/rules';
import { DndBlockPreview } from './DndWorkshop';
import { Spinner } from './ui';

type Run = (action: RoomAction) => Promise<boolean>;
const nullable = (value: string) => (value === '' ? null : Number(value));
const conditions = [
  '倒地',
  '昏迷',
  '受擒',
  '束缚',
  '中毒',
  '恐慌',
  '目盲',
  '耳聋',
  '魅惑',
  '麻痹',
  '震慑',
  '失能',
  '隐形',
  '石化',
];
const editable = [
  'name',
  'publicName',
  'revealed',
  'dex',
  'initiativeOverride',
  'hp',
  'maxHp',
  'tempHp',
  'conditions',
  'concentration',
  'deathSuccesses',
  'deathFailures',
  'stable',
  'majorWound',
  'dying',
  'firearmReady',
  'notes',
  'abilities',
] as const;

export default function EncounterPanel({
  room,
  isHost,
  run,
  onOpenLibrary,
}: {
  room: Room;
  isHost: boolean;
  run: Run;
  onOpenLibrary?: () => void;
}) {
  const state = room.encounter;
  const [selected, setSelected] = useState('');
  const [cardId, setCardId] = useState('');
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  const cards = room.rule === 'dnd' ? room.dndCards : room.keeperCards;
  const selectedCard = cards.find((c) => c.id === cardId) ?? cards[0];
  const current = state.participants.find((p) => p.id === selected);
  useEffect(() => {
    if (!state.participants.some((c) => c.id === selected))
      setSelected(state.participants[0]?.id ?? '');
  }, [state.participants, selected]);
  const perform = async (action: RoomAction) => {
    setBusy(true);
    try {
      return await run(action);
    } finally {
      setBusy(false);
    }
  };
  const save = (patch: CombatantPatch, expectedRevision: number) =>
    run({ type: 'encounter-update', combatantId: selected, patch, expectedRevision });
  return (
    <section className="encounter-panel" aria-label="本场战斗记录">
      <div className="encounter-heading">
        <div>
          <span className="mini-label">AT THE TABLE</span>
          <h3>
            本场战斗 <span>{state.participants.length} 位</span>
          </h3>
          <p>
            {state.round ? `第 ${state.round} 轮` : '准备参战者，再排定行动顺序。'}
            {!isHost && state.round > 0 && !state.activeId ? ' · 当前由主持人处理未公开的回合' : ''}
          </p>
        </div>
        {isHost && (
          <div className="encounter-turn-controls">
            <button
              className="button secondary compact"
              disabled={busy || room.phase !== 'active' || !state.participants.length}
              onClick={() => void perform({ type: 'initiative' })}
            >
              <RefreshCw size={15} />
              {state.round ? '重新排定' : '生成顺序'}
            </button>
            <button
              className="button primary compact"
              disabled={busy || room.phase !== 'active' || !state.activeId}
              onClick={() => void perform({ type: 'next-turn' })}
            >
              下一位
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
      {isHost && (
        <>
          <p className="subtle-note">
            {room.rule === 'dnd'
              ? '以 D20＋敏捷调整值排定；同值按列表顺序，可手填行动值调整。'
              : '按 DEX 排定；已准备好的枪械可加 50。'}
            重新排定会回到第 1 轮。{room.phase !== 'active' && '开启故事后可生成顺序。'}
          </p>
          <div className="encounter-add">
            {cards.length ? (
              <>
                <label className="field">
                  从房间资料加入
                  <select
                    value={selectedCard?.id ?? ''}
                    onChange={(e) => setCardId(e.target.value)}
                  >
                    {cards.map((card) => (
                      <option key={card.id} value={card.id}>
                        {card.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field encounter-count">
                  个体数量
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={count}
                    onChange={(e) => setCount(Number(e.target.value))}
                  />
                </label>
                <button
                  className="button secondary"
                  disabled={
                    busy || !selectedCard || !Number.isInteger(count) || count < 1 || count > 20
                  }
                  onClick={() =>
                    selectedCard &&
                    void perform({ type: 'encounter-add', cardId: selectedCard.id, count })
                  }
                >
                  <Plus size={16} />
                  加入参战
                </button>
              </>
            ) : (
              <div>
                <b>房间还没有 NPC／怪物资料</b>
                <p>先将备团资料带入房间，再生成独立参战个体。</p>
                {onOpenLibrary && (
                  <button className="text-button" onClick={onOpenLibrary}>
                    <BookOpen size={16} />
                    前往主持人工具集
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
      <div className="encounter-layout">
        <div className="encounter-roster" aria-label="参战者列表">
          {!state.participants.length && (
            <div className="encounter-empty">
              <Users size={28} />
              <p>
                {isHost
                  ? '完成制卡的玩家自动出现。NPC 与怪物可在上方加入。'
                  : '等待主持人公布参战者与行动顺序。'}
              </p>
            </div>
          )}
          {state.participants.map((c) => (
            <button
              key={c.id}
              className={`encounter-row ${selected === c.id ? 'selected' : ''} ${state.activeId === c.id ? 'current' : ''}`}
              onClick={() => setSelected(c.id)}
            >
              <span className="encounter-order">{c.initiative ?? '—'}</span>
              <span className="encounter-row-name">
                <b>{isHost ? c.name : c.publicName}</b>
                <small>
                  {state.activeId === c.id ? '当前回合 · ' : ''}
                  {c.kind === 'player' ? '玩家' : c.revealed ? '已公开' : '仅主持人可见'}
                  {c.conditions.length ? ` · ${c.conditions.join('、')}` : ''}
                </small>
              </span>
              {isHost && c.kind !== 'player' ? (
                c.revealed ? (
                  <Eye size={14} />
                ) : (
                  <EyeOff size={14} />
                )
              ) : (
                <Users size={14} />
              )}
            </button>
          ))}
        </div>
        <div className="encounter-detail">
          {current ? (
            isHost ? (
              <CombatantEditor
                key={current.id}
                combatant={current}
                room={room}
                run={run}
                onSave={save}
                onRemove={() => perform({ type: 'encounter-remove', combatantId: current.id })}
              />
            ) : (
              <div className="encounter-public">
                <h3>{current.publicName}</h3>
                <p>
                  行动值 {current.initiative ?? '待排定'}
                  {current.kind === 'player' &&
                    ` · HP ${current.hp ?? '—'} / ${current.maxHp ?? '—'}`}
                </p>
                <div className="encounter-tags">
                  {current.conditions.map((c) => (
                    <span key={c}>{c}</span>
                  ))}
                </div>
                {current.kind === 'player' &&
                  (room.rule === 'dnd' ? (
                    <>
                      {current.tempHp > 0 && <p>临时 HP：{current.tempHp}</p>}
                      {current.concentration && <p>正在专注：{current.concentration}</p>}
                      {(current.hp === 0 ||
                        current.deathSuccesses > 0 ||
                        current.deathFailures > 0) && (
                        <p>
                          {current.stable
                            ? '伤势已稳定'
                            : `死亡豁免：${current.deathSuccesses} 次成功 · ${current.deathFailures} 次失败`}
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="encounter-tags">
                      {current.majorWound && <span>重伤</span>}
                      {current.dying && <span>濒死</span>}
                    </div>
                  ))}
                {current.kind !== 'player' && <p className="subtle-note">详细资料由主持人掌握。</p>}
              </div>
            )
          ) : (
            <div className="encounter-empty">
              <Shield size={34} strokeWidth={1.2} />
              <p>选择一位参战者，查看本场记录。</p>
            </div>
          )}
        </div>
      </div>
      {isHost && room.rule === 'coc' && <CocMelee room={room} run={run} />}
      {isHost && state.participants.length > 0 && (
        <div className="encounter-reset">
          {clearing ? (
            <>
              <span>清空本场个体和状态？资料库与玩家 HP 会保留。</span>
              <button
                className="text-button danger"
                disabled={busy}
                onClick={async () => {
                  if (await perform({ type: 'encounter-clear' })) setClearing(false);
                }}
              >
                确认清空
              </button>
              <button className="text-button" onClick={() => setClearing(false)}>
                取消
              </button>
            </>
          ) : (
            <button className="text-button" onClick={() => setClearing(true)}>
              <Trash2 size={14} />
              结束并清空本场记录
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function CombatantEditor({
  combatant: c,
  room,
  run,
  onSave,
  onRemove,
}: {
  combatant: Combatant;
  room: Room;
  run: Run;
  onSave: (patch: CombatantPatch, revision: number) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(c);
  const baseline = useRef(c);
  const [revision, setRevision] = useState(room.encounter.revision);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [customCondition, setCustomCondition] = useState('');
  const [counterName, setCounterName] = useState('');
  useEffect(() => {
    if (!touched) {
      setDraft(c);
      baseline.current = c;
      setRevision(room.encounter.revision);
    }
  }, [c, room.encounter.revision, touched]);
  const stale = touched && revision !== room.encounter.revision;
  const patch = (values: CombatantPatch) => {
    setDraft((d) => ({ ...d, ...values }));
    setTouched(true);
    setSaved(false);
  };
  const commit = async () => {
    const changes: Record<string, unknown> = {};
    for (const key of editable)
      if (JSON.stringify(draft[key]) !== JSON.stringify(baseline.current[key]))
        changes[key] = draft[key];
    if (!Object.keys(changes).length) {
      setTouched(false);
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (await onSave(changes as CombatantPatch, revision)) {
        setTouched(false);
        setSaved(true);
      } else setError('本次未保存。请核对数值；若记录已更新，重新载入后再修改。');
    } finally {
      setBusy(false);
    }
  };
  const toggle = (value: string) =>
    patch({
      conditions: draft.conditions.includes(value)
        ? draft.conditions.filter((x) => x !== value)
        : [...draft.conditions, value],
    });
  return (
    <div className="combatant-editor">
      <div className="combatant-heading">
        <div>
          <span className="mini-label">
            {c.kind === 'player' ? 'PLAYER CHARACTER' : 'ENCOUNTER INSTANCE'}
          </span>
          <h3>{c.name}</h3>
        </div>
        {c.kind !== 'player' && (
          <button
            className="icon-button"
            aria-label="移除参战个体"
            onClick={() => setRemoving(true)}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
      {removing && (
        <div className="dnd-delete-confirm">
          <span>将此个体移出本场？模板会保留。</span>
          <button className="text-button danger" onClick={() => void onRemove()}>
            确认移除
          </button>
          <button className="text-button" onClick={() => setRemoving(false)}>
            取消
          </button>
        </div>
      )}
      <div className="combatant-form">
        {c.kind !== 'player' && (
          <>
            <div className="dnd-fields">
              <label className="field">
                本场个体名称
                <input
                  maxLength={120}
                  value={draft.name}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </label>
              <label className="field">
                公开显示名称
                <input
                  maxLength={60}
                  value={draft.publicName}
                  onChange={(e) => patch({ publicName: e.target.value })}
                />
              </label>
            </div>
            <label className="combatant-checkbox">
              <input
                type="checkbox"
                checked={draft.revealed}
                onChange={(e) => patch({ revealed: e.target.checked })}
              />
              向玩家公开名称、行动顺序与状态
            </label>
            <p className="subtle-note">公开后，HP、完整数据块和私密笔记仍仅主持人可见。</p>
          </>
        )}
        <div className="combatant-vitals">
          <label className="field">
            当前 HP
            <input
              type="number"
              min={0}
              max={100000}
              placeholder="未知"
              value={draft.hp ?? ''}
              onChange={(e) => patch({ hp: nullable(e.target.value) })}
            />
          </label>
          <label className="field">
            HP 上限
            <input
              type="number"
              min={0}
              max={100000}
              placeholder="未知"
              disabled={c.kind === 'player'}
              value={draft.maxHp ?? ''}
              onChange={(e) => patch({ maxHp: nullable(e.target.value) })}
            />
          </label>
          {room.rule === 'dnd' && (
            <label className="field">
              临时 HP
              <input
                type="number"
                min={0}
                max={100000}
                value={draft.tempHp}
                onChange={(e) => patch({ tempHp: Number(e.target.value) })}
              />
            </label>
          )}
        </div>
        {draft.maxHp !== null && (
          <button className="text-button" onClick={() => patch({ hp: draft.maxHp })}>
            <Heart size={14} />
            将当前 HP 填为上限
          </button>
        )}
        <div className="dnd-fields">
          <label className="field">
            敏捷 DEX
            <input
              type="number"
              min={0}
              max={room.rule === 'dnd' ? 30 : 100000}
              disabled={c.kind === 'player'}
              placeholder="未知"
              value={draft.dex ?? ''}
              onChange={(e) => patch({ dex: nullable(e.target.value) })}
            />
          </label>
          <label className="field">
            手填行动值
            <input
              type="number"
              min={-100}
              max={100100}
              placeholder="留空按规则生成"
              value={draft.initiativeOverride ?? ''}
              onChange={(e) => patch({ initiativeOverride: nullable(e.target.value) })}
            />
          </label>
        </div>
        <p className="subtle-note">行动值与枪械准备情况在下次“生成顺序／重新排定”时使用。</p>
        {room.rule === 'coc' && (
          <label className="combatant-checkbox">
            <input
              type="checkbox"
              checked={draft.firearmReady}
              onChange={(e) => patch({ firearmReady: e.target.checked })}
            />
            枪械已准备好（行动排序 DEX＋50）
          </label>
        )}
        <h4>本场状态</h4>
        <div className="encounter-condition-choices">
          {conditions.map((value) => (
            <button
              key={value}
              aria-pressed={draft.conditions.includes(value)}
              className={draft.conditions.includes(value) ? 'selected' : ''}
              onClick={() => toggle(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="combatant-custom-condition">
          <input
            aria-label="自定义状态"
            maxLength={60}
            placeholder="其他状态，如力竭 2 级"
            value={customCondition}
            onChange={(e) => setCustomCondition(e.target.value)}
          />
          <button
            className="text-button"
            disabled={!customCondition.trim()}
            onClick={() => {
              const s = customCondition.trim();
              if (!draft.conditions.includes(s)) patch({ conditions: [...draft.conditions, s] });
              setCustomCondition('');
            }}
          >
            添加
          </button>
        </div>
        <div className="encounter-tags">
          {draft.conditions
            .filter((v) => !conditions.includes(v))
            .map((v) => (
              <button key={v} title="移除此状态" onClick={() => toggle(v)}>
                {v} ×
              </button>
            ))}
        </div>
        {room.rule === 'dnd' ? (
          <>
            <label className="field">
              正在专注的法术
              <input
                maxLength={200}
                placeholder="无专注时留空"
                value={draft.concentration}
                onChange={(e) => patch({ concentration: e.target.value })}
              />
            </label>
            <div className="combatant-vitals">
              <label className="field">
                死亡豁免成功
                <input
                  type="number"
                  min={0}
                  max={3}
                  value={draft.deathSuccesses}
                  onChange={(e) => patch({ deathSuccesses: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                死亡豁免失败
                <input
                  type="number"
                  min={0}
                  max={3}
                  value={draft.deathFailures}
                  onChange={(e) => patch({ deathFailures: Number(e.target.value) })}
                />
              </label>
            </div>
            <label className="combatant-checkbox">
              <input
                type="checkbox"
                checked={draft.stable}
                onChange={(e) => patch({ stable: e.target.checked })}
              />
              已稳定（保存后清除死亡豁免计数）
            </label>
          </>
        ) : (
          <>
            <div className="combatant-injuries">
              <label className="combatant-checkbox">
                <input
                  type="checkbox"
                  checked={draft.majorWound}
                  onChange={(e) => patch({ majorWound: e.target.checked })}
                />
                重伤
              </label>
              <label className="combatant-checkbox">
                <input
                  type="checkbox"
                  checked={draft.dying}
                  onChange={(e) => patch({ dying: e.target.checked })}
                />
                濒死
              </label>
            </div>
            <p className="subtle-note">
              单次伤害达到 HP 上限一半构成重伤，需体质检定；有重伤且 HP 为 0 时濒死。单次伤害达到 HP
              上限可直接致死。特殊生物按条目裁定。
            </p>
          </>
        )}
        <div className="combatant-counters">
          <h4>能力与资源次数</h4>
          {draft.abilities.map((a) => (
            <div className="combatant-counter" key={a.id}>
              <div>
                <b>{a.name}</b>
                <small>{a.recharge || '由主持人记录恢复时机'}</small>
              </div>
              <label className="field">
                <span className="sr-only">{a.name}剩余次数</span>
                <input
                  type="number"
                  min={0}
                  max={a.maxUses}
                  value={a.remaining}
                  onChange={(e) =>
                    patch({
                      abilities: draft.abilities.map((r) =>
                        r.id === a.id ? { ...r, remaining: Number(e.target.value) } : r,
                      ),
                    })
                  }
                />
              </label>
              <span>/ {a.maxUses}</span>
              <button
                className="text-button"
                onClick={() =>
                  patch({
                    abilities: draft.abilities.map((r) =>
                      r.id === a.id ? { ...r, remaining: r.maxUses } : r,
                    ),
                  })
                }
              >
                恢复
              </button>
            </div>
          ))}
          <div className="combatant-custom-condition">
            <input
              aria-label="新增资源名称"
              placeholder="如 1 环法术位、战技骰"
              maxLength={120}
              value={counterName}
              onChange={(e) => setCounterName(e.target.value)}
            />
            <button
              className="text-button"
              disabled={!counterName.trim()}
              onClick={() => {
                patch({
                  abilities: [
                    ...draft.abilities,
                    {
                      id: crypto.randomUUID(),
                      name: counterName.trim(),
                      remaining: 1,
                      maxUses: 1,
                      recharge: '',
                    },
                  ],
                });
                setCounterName('');
              }}
            >
              添加
            </button>
          </div>
          {draft.abilities.length > 0 && (
            <details className="combatant-counter-settings">
              <summary>调整资源上限与恢复说明</summary>
              {draft.abilities.map((a) => (
                <div className="dnd-fields" key={a.id}>
                  <label className="field">
                    {a.name}上限
                    <input
                      type="number"
                      min={1}
                      max={100000}
                      value={a.maxUses}
                      onChange={(e) =>
                        patch({
                          abilities: draft.abilities.map((r) =>
                            r.id === a.id ? { ...r, maxUses: Number(e.target.value) } : r,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    {a.name}恢复条件
                    <input
                      maxLength={200}
                      value={a.recharge}
                      onChange={(e) =>
                        patch({
                          abilities: draft.abilities.map((r) =>
                            r.id === a.id ? { ...r, recharge: e.target.value } : r,
                          ),
                        })
                      }
                    />
                  </label>
                  <button
                    className="text-button danger"
                    onClick={() =>
                      patch({ abilities: draft.abilities.filter((r) => r.id !== a.id) })
                    }
                  >
                    移除 {a.name}
                  </button>
                </div>
              ))}
            </details>
          )}
        </div>
        <label className="field">
          本场私密笔记
          <textarea
            rows={2}
            maxLength={4000}
            value={draft.notes}
            onChange={(e) => patch({ notes: e.target.value })}
          />
        </label>
        {stale && (
          <div className="inline-error" role="alert">
            本场记录已在其他操作中更新。
            <button
              className="text-button"
              onClick={() => {
                setTouched(false);
                setError('');
              }}
            >
              重新载入最新记录
            </button>
          </div>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="combatant-save">
          <span>
            {saved ? '本场记录已保存' : touched ? '有未保存的修改' : '修改仅影响本场个体'}
          </span>
          <button
            className="button primary compact"
            disabled={busy || stale || !touched}
            onClick={() => void commit()}
          >
            {busy ? <Spinner /> : <Check size={16} />}保存本场记录
          </button>
        </div>
      </div>
      <CombatantRolls
        c={c}
        room={room}
        run={run}
        onApply={async (values) => {
          const success = await onSave(values, room.encounter.revision);
          if (success) setTouched(false);
          return success;
        }}
        disabled={touched || busy}
      />
      {c.source && (
        <details className="encounter-source">
          <summary>查看本场资料快照</summary>
          {c.source.rule === 'dnd' ? (
            <DndBlockPreview card={c.source} />
          ) : (
            <div className="coc-source">
              <h4>{c.source.name}</h4>
              <p>{c.source.description}</p>
              <p>
                护甲 {c.source.armor ?? '—'} · 伤害加值 {c.source.damageBonus || '—'} · 体格{' '}
                {c.source.build ?? '—'}
              </p>
              <p>
                移动 {c.source.movement || '—'} · 每轮攻击 {c.source.attacksPerRound ?? '—'}
              </p>
              <div className="dnd-statblock-attributes">
                {Object.entries(c.source.attributes).map(([key, value]) => (
                  <div key={key}>
                    <span>{key.toUpperCase()}</span>
                    <b>{value ?? '—'}</b>
                  </div>
                ))}
              </div>
              {c.source.attacks.map((a) => (
                <p key={a.id}>
                  <b>
                    {a.name} {a.skill ?? '—'}%
                  </b>{' '}
                  · {a.damage}
                  <br />
                  {a.notes}
                </p>
              ))}
              {c.source.skills.map((s) => (
                <p key={s.id}>
                  {s.name} {s.value}%
                </p>
              ))}
              <p>{c.source.specialAbilities}</p>
              <p>理智损失 {c.source.sanityLoss || '—'}</p>
              <p>{c.source.armorNotes}</p>
              <p>{c.source.source}</p>
              <p>{c.source.notes}</p>
            </div>
          )}
        </details>
      )}
    </div>
  );
}

function CombatantRolls({
  c,
  room,
  run,
  onApply,
  disabled,
}: {
  c: Combatant;
  room: Room;
  run: Run;
  onApply: (patch: CombatantPatch) => Promise<boolean>;
  disabled: boolean;
}) {
  const memberCard = room.members.find((m) => m.id === c.memberId)?.character;
  const sourceCon = c.source?.attributes.con;
  const defaultCon =
    c.source?.rule === 'dnd'
      ? (c.source.saves.con ??
        (sourceCon === null || sourceCon === undefined ? null : abilityModifier(sourceCon)))
      : memberCard?.rule === 'dnd'
        ? abilityModifier(memberCard.attributes.con) +
          (memberCard.proficiencies.includes('save:con') ? proficiencyBonus(memberCard.level) : 0)
        : null;
  const [visibility, setVisibility] = useState<Visibility>('host');
  const [edge, setEdge] = useState<Edge>('normal');
  const [target, setTarget] = useState(15);
  const [modifier, setModifier] = useState<number | null>(
    c.source?.rule === 'dnd'
      ? (c.source.actions.find((a) => a.attackBonus !== null)?.attackBonus ?? null)
      : null,
  );
  const [conModifier, setConModifier] = useState<number | null>(defaultCon);
  const [damage, setDamage] = useState(10);
  const [expression, setExpression] = useState('1d6');
  const [pending, setPending] = useState<{ id: string; kind: string } | null>(null);
  const [result, setResult] = useState<{ event: RoomEvent; kind: string } | null>(null);
  const [applied, setApplied] = useState(false);
  const [timeout, setTimedOut] = useState(false);
  const [applying, setApplying] = useState(false);
  useEffect(() => {
    if (!pending) return;
    const event = room.log.find((e) => e.requestId === pending.id);
    if (event) {
      setResult({ event, kind: pending.kind });
      setPending(null);
    }
  }, [room.log, pending]);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => {
      setPending(null);
      setTimedOut(true);
    }, 12000);
    return () => window.clearTimeout(timer);
  }, [pending]);
  const roll = async (kind: string, dice?: string, check?: CheckRequest) => {
    const requestId = crypto.randomUUID();
    setPending({ id: requestId, kind });
    setResult(null);
    setApplied(false);
    setTimedOut(false);
    if (
      !(await run(
        check
          ? { type: 'check', check, visibility, requestId }
          : { type: 'roll', expression: dice!, visibility, requestId },
      ))
    )
      setPending(null);
  };
  const apply = async (patch: CombatantPatch) => {
    setApplying(true);
    try {
      if (await onApply(patch)) setApplied(true);
    } finally {
      setApplying(false);
    }
  };
  const death =
    result?.kind === 'death' && result.event.roll
      ? deathSaveSuggestion(result.event.roll.total)
      : null;
  const dc =
    Number.isInteger(damage) && damage >= 0 && damage <= 100000 ? concentrationDC(damage) : null;
  const locked = !!pending || applying;
  return (
    <section className="combatant-rolls">
      <div className="inventory-heading">
        <h4>检定与骰式</h4>
        <select
          aria-label="战斗掷骰可见范围"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as Visibility)}
        >
          <option value="host">主持人暗骰</option>
          <option value="public">公开掷骰</option>
        </select>
      </div>
      {room.rule === 'dnd' && (
        <>
          <div className="dnd-fields">
            <label className="field">
              攻击总加值
              <input
                type="number"
                min={-100}
                max={100}
                placeholder="请填写"
                value={modifier ?? ''}
                onChange={(e) => setModifier(nullable(e.target.value))}
              />
            </label>
            <label className="field">
              目标 AC
              <input
                type="number"
                min={0}
                max={1000}
                value={target}
                onChange={(e) => setTarget(Number(e.target.value))}
              />
            </label>
          </div>
          {c.source?.rule === 'dnd' && (
            <div className="encounter-attack-shortcuts">
              {c.source.actions
                .filter((a) => a.attackBonus !== null)
                .map((a) => (
                  <button
                    className="text-button"
                    key={a.id}
                    onClick={() => setModifier(a.attackBonus)}
                  >
                    {a.name} {a.attackBonus! >= 0 ? '+' : ''}
                    {a.attackBonus}
                  </button>
                ))}
            </div>
          )}
          <div className="combatant-inline">
            <select
              aria-label="攻击骰优势"
              value={edge}
              onChange={(e) => setEdge(e.target.value as Edge)}
            >
              <option value="normal">普通骰</option>
              <option value="advantage">优势</option>
              <option value="disadvantage">劣势</option>
            </select>
            <button
              className="button secondary compact"
              disabled={locked || modifier === null}
              onClick={() =>
                void roll('attack', undefined, {
                  kind: 'attack',
                  key: '',
                  dc: target,
                  modifier: modifier!,
                  edge,
                })
              }
            >
              <Dices size={15} />
              攻击检定
            </button>
          </div>
          <div className="concentration-check">
            <h4>维持专注</h4>
            <div className="dnd-fields">
              <label className="field">
                此次受到的伤害
                <input
                  type="number"
                  min={0}
                  max={100000}
                  value={damage}
                  onChange={(e) => setDamage(Number(e.target.value))}
                />
              </label>
              <label className="field">
                体质豁免总加值
                <input
                  type="number"
                  min={-100}
                  max={100}
                  placeholder="请填写"
                  value={conModifier ?? ''}
                  onChange={(e) => setConModifier(nullable(e.target.value))}
                />
              </label>
            </div>
            <div className="combatant-inline">
              <span>DC {dc ?? '—'} · 10 与伤害一半取高</span>
              <button
                className="text-button"
                disabled={
                  locked || !c.concentration || conModifier === null || dc === null || dc > 1000
                }
                onClick={() =>
                  void roll('concentration', undefined, {
                    kind: 'save',
                    key: 'con',
                    dc: dc!,
                    modifier: conModifier!,
                    edge: 'normal',
                  })
                }
              >
                检定专注
              </button>
            </div>
          </div>
          <div className="combatant-inline">
            <button
              className="button secondary compact"
              disabled={locked || c.hp !== 0 || c.stable}
              onClick={() => void roll('death', '1d20')}
            >
              <Dices size={15} />
              掷死亡豁免
            </button>
            <button
              className="text-button"
              disabled={locked}
              onClick={() => void roll('recharge', '1d6')}
            >
              掷充能 D6
            </button>
          </div>
          <p className="subtle-note">
            死亡豁免按基础 D20
            规则提示；额外加值与特殊能力请手动校正。充能结果对照条目后，在资源次数中确认恢复。
          </p>
        </>
      )}
      {room.rule === 'coc' && (
        <div className="combatant-inline">
          <button
            className="button secondary compact"
            disabled={locked || ((sourceCon === null || sourceCon === undefined) && !memberCard)}
            onClick={() =>
              void roll('constitution', undefined, {
                kind: 'ability',
                key: 'con',
                target: sourceCon ?? memberCard?.attributes.con ?? 0,
                dc: 0,
                modifier: 0,
                edge: 'normal',
              })
            }
          >
            <Dices size={15} />
            体质检定
          </button>
          <span className="subtle-note">用于重伤或濒死等场景，由 KP 判断后果。</span>
        </div>
      )}
      <div className="combatant-inline">
        <label className="field">
          伤害或其他骰式
          <input
            value={expression}
            maxLength={120}
            onChange={(e) => setExpression(e.target.value)}
            placeholder="例如 2d6+3"
          />
        </label>
        <button
          className="button secondary compact"
          disabled={locked || !expression.trim()}
          onClick={() => void roll('damage', expression)}
        >
          <Dices size={15} />
          掷骰
        </button>
      </div>
      {pending && (
        <p role="status">
          <Spinner />
          等待服务器骰点…
        </p>
      )}
      {timeout && (
        <p className="inline-error" role="alert">
          暂未收到结果，请查看房间日志后再决定是否重掷。
        </p>
      )}
      {result && (
        <div className="combatant-roll-result" aria-live="polite">
          <span className="mini-label">
            {result.event.visibility === 'host' ? 'PRIVATE ROLL' : 'PUBLIC ROLL'}
          </span>
          <b>{result.event.roll?.total ?? result.event.check?.total}</b>
          <p>{result.event.content}</p>
          {death && (
            <>
              <p>{death.text}</p>
              <button
                className="button primary compact"
                disabled={disabled || applied || applying || c.hp !== 0}
                onClick={() =>
                  void apply(
                    death.heal
                      ? { hp: 1, deathSuccesses: 0, deathFailures: 0, stable: false }
                      : c.deathSuccesses + death.successes >= 3
                        ? { stable: true }
                        : {
                            deathSuccesses: Math.min(3, c.deathSuccesses + death.successes),
                            deathFailures: Math.min(3, c.deathFailures + death.failures),
                          },
                  )
                }
              >
                {applied ? '结果已记录' : '确认记录此结果'}
              </button>
            </>
          )}
          {result.kind === 'concentration' && result.event.check?.success === false && (
            <button
              className="button secondary compact"
              disabled={disabled || applied || applying}
              onClick={() => void apply({ concentration: '' })}
            >
              {applied ? '已结束专注' : '确认结束专注'}
            </button>
          )}
          {disabled && (death || result.kind === 'concentration') && (
            <p className="subtle-note">先保存或重新载入上方本场记录，再应用检定结果。</p>
          )}
        </div>
      )}
    </section>
  );
}

function CocMelee({ room, run }: { room: Room; run: Run }) {
  const participants = room.encounter.participants;
  const [attackId, setAttackId] = useState('');
  const [defenseId, setDefenseId] = useState('');
  const [attackSkill, setAttackSkill] = useState<number | null>(null);
  const [defenseSkill, setDefenseSkill] = useState<number | null>(null);
  const [defense, setDefense] = useState<'dodge' | 'fight-back'>('dodge');
  const [attackEdge, setAttackEdge] = useState<Edge>('normal');
  const [defenseEdge, setDefenseEdge] = useState<Edge>('normal');
  const [visibility, setVisibility] = useState<Visibility>('host');
  const [busy, setBusy] = useState(false);
  const attack = participants.find((c) => c.id === attackId),
    defend = participants.find((c) => c.id === defenseId);
  const latest = [...room.log]
    .reverse()
    .find((e) => e.type === 'system' && e.content.includes('（不自动扣除 HP）'));
  const usePerson = (id: string, side: 'attack' | 'defense', response = defense) => {
    const c = participants.find((p) => p.id === id);
    const pc = room.members.find((m) => m.id === c?.memberId)?.character;
    const target =
      side === 'defense' && response === 'dodge'
        ? (pc?.skills.dodge ??
          (c?.source?.rule === 'coc'
            ? (c.source.skills.find((s) => /^(闪避|dodge)$/i.test(s.name.trim()))?.value ?? null)
            : null))
        : c?.source?.rule === 'coc'
          ? (c.source.attacks[0]?.skill ?? null)
          : (pc?.skills.fightingBrawl ?? null);
    if (side === 'attack') {
      setAttackId(id);
      setAttackSkill(target);
    } else {
      setDefenseId(id);
      setDefenseSkill(target);
    }
  };
  const edgeSelect = (label: string, value: Edge, set: (value: Edge) => void) => (
    <label className="field">
      {label}
      <select value={value} onChange={(e) => set(e.target.value as Edge)}>
        <option value="normal">普通骰</option>
        <option value="advantage">一颗奖励骰</option>
        <option value="disadvantage">一颗惩罚骰</option>
      </select>
    </label>
  );
  return (
    <section className="coc-melee">
      <div>
        <span className="mini-label">CALL OF CTHULHU · CLOSE COMBAT</span>
        <h3>近战对抗</h3>
        <p>闪避同档有利于防守方，反击同档有利于进攻方；双方失败均不造成伤害。</p>
      </div>
      <div className="coc-melee-sides">
        <div>
          <label className="field">
            进攻者
            <select value={attackId} onChange={(e) => usePerson(e.target.value, 'attack')}>
              <option value="">手填进攻技能</option>
              {participants.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            进攻技能百分比
            <input
              type="number"
              min={0}
              max={100000}
              placeholder="请填写"
              value={attackSkill ?? ''}
              onChange={(e) => setAttackSkill(nullable(e.target.value))}
            />
          </label>
          {edgeSelect('进攻骰', attackEdge, setAttackEdge)}
        </div>
        <div>
          <label className="field">
            防守者
            <select value={defenseId} onChange={(e) => usePerson(e.target.value, 'defense')}>
              <option value="">手填防守技能</option>
              {participants.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            防守方式
            <select
              value={defense}
              onChange={(e) => {
                const next = e.target.value as 'dodge' | 'fight-back';
                setDefense(next);
                if (defenseId) usePerson(defenseId, 'defense', next);
              }}
            >
              <option value="dodge">闪避</option>
              <option value="fight-back">反击</option>
            </select>
          </label>
          <label className="field">
            防守技能百分比
            <input
              type="number"
              min={0}
              max={100000}
              placeholder="请填写"
              value={defenseSkill ?? ''}
              onChange={(e) => setDefenseSkill(nullable(e.target.value))}
            />
          </label>
          {edgeSelect('防守骰', defenseEdge, setDefenseEdge)}
        </div>
      </div>
      <p className="subtle-note">
        技能栏可按武器专长修正；奖励／惩罚骰由 KP
        根据以多打少等情境指定。本工具用于近战，枪械攻击请用火器检定。
      </p>
      <div className="combatant-inline">
        <select
          aria-label="近战对抗可见范围"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as Visibility)}
        >
          <option value="host">主持人暗骰</option>
          <option value="public">公开对抗</option>
        </select>
        <button
          className="button primary compact"
          disabled={busy || attackSkill === null || defenseSkill === null}
          onClick={async () => {
            if (attackSkill === null || defenseSkill === null) return;
            setBusy(true);
            try {
              await run({
                type: 'coc-melee',
                attacker: attack?.publicName ?? '进攻方',
                defender: defend?.publicName ?? '防守方',
                attackSkill,
                defenseSkill,
                defense,
                attackEdge,
                defenseEdge,
                visibility,
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Spinner /> : <Dices size={16} />}掷骰并比较
        </button>
      </div>
      {latest && (
        <div className="coc-melee-result" aria-live="polite">
          {latest.visibility === 'host' && <EyeOff size={15} />}
          {latest.content}
        </div>
      )}
    </section>
  );
}
