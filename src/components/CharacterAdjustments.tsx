import { useEffect, useState } from 'react';
import {
  Check,
  ChevronRight,
  Clock3,
  Minus,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Users,
} from 'lucide-react';
import {
  adjustedValue,
  adjustmentBounds,
  adjustmentFields,
  adjustmentLabel,
  applyCharacterAdjustment,
  effectiveCharacter,
  type AdjustmentTarget,
  type CharacterAdjustmentEdit,
} from '../../shared/adjustments';
import type { Character, Member, Room, RoomAction } from '../../shared/types';
import { Modal, Spinner } from './ui';

type Run = (action: RoomAction) => Promise<boolean>;
type Field = { target: AdjustmentTarget; key: string };
const signed = (value: number) => `${value > 0 ? '+' : ''}${value}`;

export default function CharacterAdjustments({
  room,
  isHost,
  initialMemberId,
  run,
  onClose,
}: {
  room: Room;
  isHost: boolean;
  initialMemberId?: string;
  run: Run;
  onClose: () => void;
}) {
  const players = room.members.filter((member) => member.role === 'player' && member.character);
  const [selected, setSelected] = useState(initialMemberId ?? players[0]?.id ?? '');
  const member = players.find((candidate) => candidate.id === selected) ?? players[0];
  return (
    <Modal
      title={`${isHost ? '角色调整' : '角色数值'}${member ? ` · ${member.character!.name}` : ''}`}
      subtitle="属性、技能与临时效果 · 全房间同步"
      className="character-adjustments"
      onClose={onClose}
    >
      {!member ? (
        <div className="empty-state">
          <Users size={30} />
          <p>玩家载入角色卡后，就可以在这里选择角色。</p>
        </div>
      ) : (
        <>
          <div className="adjustment-toolbar">
            <label className="field">
              选择角色
              <select
                aria-label="选择角色"
                value={member.id}
                onChange={(event) => setSelected(event.target.value)}
              >
                {players.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.character!.name} · {player.name}
                    {player.online ? '' : '（离线）'}
                  </option>
                ))}
              </select>
            </label>
            <p>
              <ShieldCheck size={17} />
              <span>
                {isHost && room.phase === 'active'
                  ? '主持人即时裁定，数值变更记入房间日志。'
                  : isHost
                    ? '准备阶段请编辑角色卡并审核。开始故事后可在这里调整。'
                    : '由主持人调整，你可以在这里查看当前生效值。'}
              </span>
            </p>
          </div>
          <CharacterWorkspace
            key={`${member.id}:${member.character!.id}`}
            member={member}
            canEdit={isHost && room.phase === 'active'}
            run={run}
          />
        </>
      )}
    </Modal>
  );
}

function CharacterWorkspace({
  member,
  canEdit,
  run,
}: {
  member: Member;
  canEdit: boolean;
  run: Run;
}) {
  const card = member.character!;
  const current = effectiveCharacter(card);
  const original = effectiveCharacter({ ...card, adjustments: undefined });
  const [field, setField] = useState<Field>({ target: 'attribute', key: 'str' });
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedFromRevision, setSavedFromRevision] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const effects = card.adjustments?.temporary ?? [];
  const commit = async (
    edit: CharacterAdjustmentEdit,
    expectedRevision = member.characterRevision,
  ) => {
    if (busy || !canEdit) return false;
    setBusy(true);
    const success = await run({
      type: 'character-adjust',
      memberId: member.id,
      characterId: card.id,
      expectedRevision,
      edit,
    });
    if (success) {
      setSavedFromRevision(expectedRevision);
      setStatus('已保存，检定将使用最新数值。');
      setConfirmClear(false);
    }
    setBusy(false);
    return success;
  };
  const fields = adjustmentFields(card, field.target).filter((entry) =>
    `${entry.label} ${entry.key}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <>
      <div className="adjustment-layout">
        <section className="adjustment-picker" aria-label="选择要调整的项目">
          <div className="adjustment-tabs">
            {(['attribute', 'skill'] as const).map((target) => (
              <button
                key={target}
                aria-pressed={field.target === target}
                disabled={busy}
                onClick={() => {
                  setField({
                    target,
                    key:
                      target === 'attribute'
                        ? 'str'
                        : card.rule === 'dnd'
                          ? 'perception'
                          : 'spotHidden',
                  });
                  setSearch('');
                  setStatus('');
                }}
              >
                {target === 'attribute' ? '属性' : '技能'}
                <span>{adjustmentFields(card, target).length}</span>
              </button>
            ))}
          </div>
          {field.target === 'skill' && (
            <label className="adjustment-search">
              <Search size={16} />
              <input
                aria-label="搜索要调整的技能"
                placeholder="搜索技能…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          )}
          <div className={`adjustment-fields ${field.target}`}>
            {fields.map((entry) => {
              const value = adjustedValue(current, field.target, entry.key);
              const base = adjustedValue(original, field.target, entry.key);
              return (
                <button
                  key={entry.key}
                  disabled={busy}
                  aria-label={`${entry.label}，生效值 ${value}`}
                  aria-pressed={field.key === entry.key}
                  onClick={() => {
                    setField({ ...field, key: entry.key });
                    setStatus('');
                  }}
                >
                  <span>
                    {entry.label}
                    <small>
                      {field.target === 'attribute' ? entry.key.toUpperCase() : `原始 ${base}`}
                    </small>
                  </span>
                  <b>{card.rule === 'dnd' && field.target === 'skill' ? signed(value) : value}</b>
                  {value !== base && (
                    <i title={`相较原始值 ${signed(value - base)}`} aria-label="含局内修正" />
                  )}
                </button>
              );
            })}
            {!fields.length && <p className="subtle-note">没有匹配的技能。</p>}
          </div>
          <p className="subtle-note adjustment-rule-note">
            {card.rule === 'dnd'
              ? '技能随关联属性、熟练及专精计算，再叠加技能修正。攻击加值仍由掷骰者填写。'
              : '技能调整的是目标百分比。属性变化不重新分配职业点或兴趣点。'}{' '}
            HP、MP、SAN 与 AC 不随这里的修正自动变化。
          </p>
        </section>
        <FieldEditor
          key={`${field.target}:${field.key}`}
          member={member}
          field={field}
          canEdit={canEdit}
          busy={busy}
          savedFromRevision={savedFromRevision}
          commit={commit}
        />
      </div>
      <div className="adjustment-save-status" role="status">
        {busy ? (
          <>
            <Spinner />
            正在同步…
          </>
        ) : status ? (
          <>
            <Check size={15} />
            {status}
          </>
        ) : null}
      </div>
      <section className="temporary-effects">
        <div className="temporary-heading">
          <div>
            <Clock3 size={19} />
            <h3>临时效果</h3>
            <span>{effects.filter((effect) => effect.enabled).length} 个生效</span>
          </div>
          {canEdit && effects.length > 0 && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => setConfirmClear(!confirmClear)}
            >
              清除全部
            </button>
          )}
        </div>
        {confirmClear && (
          <div className="adjustment-clear-confirm">
            <span>移除全部 {effects.length} 个临时效果？长期调整会保留。</span>
            <button className="button secondary compact" onClick={() => setConfirmClear(false)}>
              取消
            </button>
            <button
              className="button danger compact"
              disabled={busy}
              onClick={() => void commit({ kind: 'clear-effects' })}
            >
              确认清除
            </button>
          </div>
        )}
        {!effects.length && (
          <p className="temporary-empty">
            还没有临时效果。选中属性或技能，即可添加修正并注明结束条件。
          </p>
        )}
        {effects.map((effect) => (
          <article
            className={`temporary-effect ${effect.enabled ? '' : 'disabled'}`}
            key={effect.id}
          >
            <span className="effect-indicator" aria-hidden="true" />
            <div className="effect-copy">
              <h4>
                {effect.name}
                <span>{effect.enabled ? '生效中' : '已停用'}</span>
              </h4>
              <p>
                {effect.changes
                  .map(
                    (entry) =>
                      `${adjustmentLabel(card, entry.target, entry.key)} ${signed(entry.amount)}`,
                  )
                  .join(' · ')}
              </p>
              <small>结束条件：{effect.endCondition || '由主持人手动结束'}</small>
            </div>
            {canEdit && (
              <div className="effect-actions">
                <button
                  className="button secondary compact"
                  disabled={busy}
                  aria-label={`${effect.enabled ? '停用' : '启用'}${effect.name}`}
                  onClick={() =>
                    void commit({
                      kind: 'toggle-effect',
                      effectId: effect.id,
                      enabled: !effect.enabled,
                    })
                  }
                >
                  {effect.enabled ? '停用' : '启用'}
                </button>
                <button
                  className="icon-button"
                  disabled={busy}
                  aria-label={`移除${effect.name}`}
                  onClick={() => void commit({ kind: 'remove-effect', effectId: effect.id })}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            )}
          </article>
        ))}
        <p className="subtle-note">
          结束条件仅作提醒。效果会随房间和导出的角色卡保存，请在到期时停用或移除。
        </p>
      </section>
    </>
  );
}

function FieldEditor({
  member,
  field,
  canEdit,
  busy,
  savedFromRevision,
  commit,
}: {
  member: Member;
  field: Field;
  canEdit: boolean;
  busy: boolean;
  savedFromRevision: number | null;
  commit: (edit: CharacterAdjustmentEdit, expectedRevision?: number) => Promise<boolean>;
}) {
  const [basis, setBasis] = useState({
    card: member.character!,
    revision: member.characterRevision,
  });
  const [mode, setMode] = useState<'lasting' | 'temporary'>('temporary');
  const [draftEffectId] = useState(() => crypto.randomUUID());
  const [value, setValue] = useState('0');
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [endCondition, setEndCondition] = useState('');
  const stale = basis.revision !== member.characterRevision;
  const card = member.character!;
  const current = effectiveCharacter(card);
  const original = effectiveCharacter({ ...card, adjustments: undefined });
  const lasting = effectiveCharacter(card, false);
  const label = adjustmentLabel(card, field.target, field.key);
  const currentValue = adjustedValue(current, field.target, field.key);
  const lastingValue = adjustedValue(lasting, field.target, field.key);
  const baseValue = adjustedValue(original, field.target, field.key);
  const permanent = card.adjustments?.permanent.find(
    (entry) => entry.target === field.target && entry.key === field.key,
  );
  useEffect(() => {
    if (stale && savedFromRevision === basis.revision) {
      setBasis({ card: member.character!, revision: member.characterRevision });
      setValue(mode === 'lasting' ? String(lastingValue) : '0');
      setName('');
      setReason(mode === 'lasting' ? (permanent?.reason ?? '') : '');
      setEndCondition('');
    }
  }, [
    member.character,
    member.characterRevision,
    savedFromRevision,
    stale,
    basis.revision,
    mode,
    lastingValue,
    permanent?.reason,
  ]);

  const edit: CharacterAdjustmentEdit =
    mode === 'lasting'
      ? { kind: 'set-value', ...field, value: Number(value), reason }
      : {
          kind: 'add-effect',
          effect: {
            id: draftEffectId,
            name: name.trim() || '临时修正',
            endCondition,
            enabled: true,
            changes: [{ ...field, amount: Number(value) }],
          },
        };
  let error = '';
  let preview: Character | null = null;
  if (value.trim() === '' || !Number.isInteger(Number(value))) error = '请输入整数';
  else {
    try {
      preview = applyCharacterAdjustment(basis.card, edit);
    } catch (cause) {
      error = (cause as Error).message;
    }
  }
  const bounds =
    mode === 'lasting' ? adjustmentBounds(card, field.target, field.key) : { min: -100, max: 100 };
  const locked = busy || stale;
  const unchanged =
    mode === 'lasting' &&
    Number(value) === lastingValue &&
    reason.trim() === (permanent?.reason ?? '');
  return (
    <section className="adjustment-editor" aria-label={`${label}调整面板`}>
      <div className="adjustment-editor-heading">
        <span className="mini-label">{field.target === 'attribute' ? 'ATTRIBUTE' : 'SKILL'}</span>
        <h3>{label}</h3>
        <SlidersHorizontal size={21} />
      </div>
      <div className="adjustment-values">
        <div>
          <span>原始</span>
          <b>{baseValue}</b>
        </div>
        <div>
          <span>长期</span>
          <b>{lastingValue}</b>
        </div>
        <div className="current">
          <span>生效</span>
          <b data-testid="effective-value">{currentValue}</b>
        </div>
      </div>
      {permanent && (
        <p className="adjustment-existing">
          长期修正 {signed(permanent.amount)} · {permanent.reason || '主持人调整'}
          {canEdit && (
            <button
              disabled={locked}
              onClick={() => void commit({ kind: 'reset-value', ...field }, basis.revision)}
            >
              <RotateCcw size={13} />
              重置长期修正
            </button>
          )}
        </p>
      )}
      {canEdit ? (
        <>
          {stale && (
            <div className="adjustment-stale" role="alert">
              <p>角色状态已更新。草稿仍保留，请载入最新数值后再调整。</p>
              <button
                className="button secondary compact"
                disabled={busy}
                onClick={() => {
                  setBasis({ card, revision: member.characterRevision });
                  setValue(mode === 'lasting' ? String(lastingValue) : '0');
                  setReason(permanent?.reason ?? '');
                }}
              >
                载入最新数值
              </button>
            </div>
          )}
          <div className="adjustment-mode">
            <button
              disabled={locked}
              aria-pressed={mode === 'temporary'}
              onClick={() => {
                setMode('temporary');
                setValue('0');
              }}
            >
              临时修正
            </button>
            <button
              disabled={locked}
              aria-pressed={mode === 'lasting'}
              onClick={() => {
                setMode('lasting');
                setValue(String(lastingValue));
                setReason(permanent?.reason ?? '');
              }}
            >
              长期数值
            </button>
          </div>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (error || locked || unchanged || (mode === 'temporary' && !name.trim())) return;
              const request =
                edit.kind === 'add-effect'
                  ? {
                      ...edit,
                      effect: { ...edit.effect, id: crypto.randomUUID(), name: name.trim() },
                    }
                  : edit;
              await commit(request, basis.revision);
            }}
          >
            <label className="field">
              {mode === 'lasting' ? '长期数值（不含临时效果）' : '修正数值（正数增加，负数减少）'}
              <div className="adjustment-stepper">
                <button
                  type="button"
                  aria-label="数值减一"
                  disabled={locked}
                  onClick={() => setValue(String(Number(value || 0) - 1))}
                >
                  <Minus size={18} />
                </button>
                <input
                  aria-label={mode === 'lasting' ? '长期数值' : '临时修正值'}
                  type="number"
                  required
                  min={bounds.min}
                  max={bounds.max}
                  step={1}
                  value={value}
                  disabled={locked}
                  onChange={(event) => setValue(event.target.value)}
                />
                <button
                  type="button"
                  aria-label="数值加一"
                  disabled={locked}
                  onClick={() => setValue(String(Number(value || 0) + 1))}
                >
                  <Plus size={18} />
                </button>
              </div>
            </label>
            {mode === 'temporary' && (
              <div className="adjustment-presets">
                {(card.rule === 'coc' ? [-10, -5, 5, 10] : [-2, -1, 1, 2]).map((amount) => (
                  <button
                    type="button"
                    key={amount}
                    disabled={locked}
                    onClick={() => setValue(String(amount))}
                  >
                    {signed(amount)}
                  </button>
                ))}
              </div>
            )}
            {mode === 'temporary' ? (
              <>
                <label className="field">
                  效果名称
                  <input
                    aria-label="效果名称"
                    required
                    maxLength={60}
                    placeholder="例如：伤势影响、环境优势"
                    value={name}
                    disabled={locked}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>
                    结束条件 <span className="subtle-note">选填 · 手动结束</span>
                  </span>
                  <input
                    aria-label="效果结束条件"
                    maxLength={200}
                    placeholder="例如：下一次休息后"
                    value={endCondition}
                    disabled={locked}
                    onChange={(event) => setEndCondition(event.target.value)}
                  />
                </label>
              </>
            ) : (
              <label className="field">
                <span>
                  调整原因 <span className="subtle-note">选填</span>
                </span>
                <input
                  aria-label="长期调整原因"
                  maxLength={200}
                  placeholder="例如：技能成长、剧情奖励"
                  value={reason}
                  disabled={locked}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
            )}
            <div className="adjustment-preview" aria-live="polite">
              {mode === 'temporary' && value.trim() !== '' && Number(value) === 0 ? (
                <span>选择一个正数或负数，预览修正后的数值。</span>
              ) : error ? (
                <span className="inline-error">{error}</span>
              ) : (
                <>
                  <span>应用后生效</span>
                  <b>
                    {currentValue}
                    <ChevronRight size={16} />
                    {preview && adjustedValue(effectiveCharacter(preview), field.target, field.key)}
                  </b>
                </>
              )}
            </div>
            <button
              className="button primary adjustment-submit"
              type="submit"
              disabled={
                locked || Boolean(error) || unchanged || (mode === 'temporary' && !name.trim())
              }
            >
              {busy ? <Spinner /> : mode === 'temporary' ? <Plus size={17} /> : <Check size={17} />}
              {mode === 'temporary' ? '添加临时效果' : '保存长期数值'}
            </button>
          </form>
        </>
      ) : (
        <p className="subtle-note">
          原始值来自角色卡；长期值包含成长等调整；生效值还包含已启用的临时效果。
        </p>
      )}
    </section>
  );
}
