import { useState } from 'react';
import {
  Check,
  ClipboardCheck,
  FileText,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import type { Character, Member, Room, RoomAction } from '../../shared/types';
import { COC_ATTRIBUTES, COC_SKILLS, DND_ATTRIBUTES, DND_SKILLS } from '../../shared/rules';
import {
  CreationPolicySchema,
  cocBudget,
  defaultCreationPolicy,
  dndSkillModifier,
  policyFields,
  validateCreation,
  type CreationPolicy,
} from '../../shared/creation';
import { Modal, Spinner } from './ui';
import { ValidationSummary } from './AllocationEditor';
import { AdjustmentSummary } from './AdjustmentSummary';

export function ReviewDesk({
  room,
  isHost,
  run,
  onClose,
}: {
  room: Room;
  isHost: boolean;
  run: (a: RoomAction) => Promise<boolean>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'review' | 'policy'>(isHost ? 'review' : 'policy');
  const [selected, setSelected] = useState(room.members.find((m) => m.role === 'player')?.id ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const players = room.members.filter((m) => m.role === 'player');
  const member = players.find((m) => m.id === selected) ?? players[0];
  const errors = member?.character
    ? validateCreation(member.character, room.creationPolicy)
    : ['尚未提交角色卡'];
  const review = async (decision: 'approved' | 'changes') => {
    if (!member) return;
    setBusy(true);
    await run({
      type: 'review-character',
      memberId: member.id,
      decision,
      note,
      characterRevision: member.characterRevision,
      policyRevision: room.policyRevision,
    });
    setBusy(false);
  };
  return (
    <Modal
      title={isHost ? '开场前，把角色读一遍。' : '本桌制卡要求'}
      subtitle={`剧本限制 · 第 ${room.policyRevision + 1} 版 · ${room.phase === 'lobby' ? '准备阶段' : '故事进行中'}`}
      className="review-desk"
      onClose={onClose}
    >
      {isHost && (
        <div className="desk-tabs">
          <button className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>
            <ClipboardCheck size={16} />
            角色卡审核
            <span>
              {players.filter((m) => isApproved(m, room)).length}/{players.length}
            </span>
          </button>
          <button className={tab === 'policy' ? 'active' : ''} onClick={() => setTab('policy')}>
            <SlidersHorizontal size={16} />
            剧本限制
          </button>
        </div>
      )}
      {tab === 'policy' ? (
        <PolicyEditor room={room} isHost={isHost} run={run} />
      ) : (
        <div className="review-layout">
          <aside className="review-queue">
            {players.map((m) => (
              <button
                key={m.id}
                className={member?.id === m.id ? 'selected' : ''}
                onClick={() => {
                  setSelected(m.id);
                  setNote('');
                }}
              >
                <span className="review-avatar">{(m.character?.name ?? m.name).slice(0, 1)}</span>
                <span>
                  <b>{m.character?.name ?? '未提交角色'}</b>
                  <small>
                    {m.name} · {reviewLabel(m, room)}
                  </small>
                </span>
                {isApproved(m, room) && <ShieldCheck size={16} />}
              </button>
            ))}
            {!players.length && (
              <p className="subtle-note">邀请玩家入席后，提交的卡片会出现在这里。</p>
            )}
          </aside>
          <section className="review-content">
            {member ? (
              <>
                <div className="review-card-heading">
                  <div>
                    <span className="mini-label">
                      CHARACTER REVIEW · V{member.characterRevision}
                    </span>
                    <h3>{member.character?.name ?? member.name}</h3>
                    <p>
                      {member.character?.occupation ?? '等待角色卡'} · {reviewLabel(member, room)}
                    </p>
                  </div>
                  <FileText size={28} strokeWidth={1} />
                </div>
                {member.character && <AuditCard card={member.character} />}
                {member.character && <AdjustmentSummary card={member.character} />}
                <ValidationSummary errors={errors} />
                {member.review.note && (
                  <div className="review-note">
                    <b>上次审核意见</b>
                    <p>{member.review.note}</p>
                  </div>
                )}
                <label className="field">
                  审核意见
                  <textarea
                    aria-label="审核意见"
                    rows={3}
                    maxLength={1000}
                    value={note}
                    placeholder="例如：剧本需要普通人背景，请调整武器来源。"
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <div className="review-actions">
                  <button
                    className="button secondary"
                    disabled={busy || !member.character || room.phase !== 'lobby' || !note.trim()}
                    onClick={() => void review('changes')}
                  >
                    要求修改
                  </button>
                  <button
                    className="button primary"
                    disabled={
                      busy ||
                      errors.length > 0 ||
                      room.phase !== 'lobby' ||
                      isApproved(member, room)
                    }
                    onClick={() => void review('approved')}
                  >
                    {busy ? <Spinner /> : <ShieldCheck size={17} />}
                    {isApproved(member, room) ? '已通过审核' : '通过此卡'}
                  </button>
                </div>
                <p className="subtle-note">
                  通过只针对当前卡片与当前限制版本。改卡、改限制或移交主持人后需要重审；主持人不能跳过数值检查。
                </p>
              </>
            ) : (
              <div className="empty-state">
                <ClipboardCheck size={32} />
                <p>还没有等待审核的玩家。</p>
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
export function isApproved(member: Member, room: Room) {
  return (
    member.review.status === 'approved' &&
    (room.phase === 'active' || member.review.characterRevision === member.characterRevision) &&
    member.review.policyRevision === room.policyRevision
  );
}
export function reviewLabel(member: Member, room: Room) {
  return !member.character
    ? '未提交'
    : isApproved(member, room)
      ? '审核通过'
      : member.review.status === 'changes'
        ? '需要修改'
        : '等待审核';
}
function AuditCard({ card }: { card: Character }) {
  const attrs = card.rule === 'coc' ? COC_ATTRIBUTES : DND_ATTRIBUTES;
  const b = card.rule === 'coc' ? cocBudget(card) : null;
  return (
    <div className="audit-card">
      <p>
        {card.ancestry || '未填写种族／国籍'} · {card.age} 岁
        {card.rule === 'dnd' && ` · Lv.${card.level}`}
      </p>
      <p>{card.background || '未填写背景'}</p>
      <div className="audit-attributes">
        {attrs.map((a) => (
          <span key={a.key}>
            {a.label}
            <b>{card.attributes[a.key]}</b>
          </span>
        ))}
      </div>
      <p className="audit-resources">
        HP {card.hp}/{card.maxHp} ·{' '}
        {card.rule === 'coc'
          ? `MP ${card.mp}/${card.maxMp} · SAN ${card.san}/${card.maxSan}`
          : `AC ${card.ac}`}
      </p>
      {b && (
        <p className="subtle-note">
          职业点 {b.spentOccupation}/{b.occupational} · 兴趣点 {b.spentPersonal}/{b.personal}
        </p>
      )}
      <details>
        <summary>技能与分配来源</summary>
        <div className="audit-skills">
          {(card.rule === 'coc' ? COC_SKILLS : DND_SKILLS).map((s) => (
            <span key={s.key}>
              <span>
                {s.label}
                {card.creation?.rule === 'coc' && (
                  <small>
                    基础 + {card.creation.occupational[s.key] ?? 0} 职业 +{' '}
                    {card.creation.personal[s.key] ?? 0} 兴趣
                  </small>
                )}
              </span>
              <b>
                {card.rule === 'coc'
                  ? (card.skills[s.key] ?? ('base' in s ? s.base : 0))
                  : dndSkillModifier(card, s.key)}
              </b>
            </span>
          ))}
        </div>
        {card.creation?.rule === 'dnd' && (
          <p className="subtle-note">
            {(
              [
                'classSkills',
                'backgroundSkills',
                'ancestrySkills',
                'replacementSkills',
                'extraSkills',
                'expertise',
              ] as const
            ).map((key, i) => (
              <span className="audit-source" key={key}>
                {['职业', '背景', '种族', '重复替代', '额外', '专精'][i]}：
                {card.creation?.rule === 'dnd'
                  ? card.creation[key]
                      .map((s) => DND_SKILLS.find((k) => k.key === s)?.label)
                      .join('、') || '无'
                  : ''}
              </span>
            ))}
          </p>
        )}
      </details>
      <details>
        <summary>故事、词条与行囊</summary>
        <div className="audit-prose">
          <b>故事词条</b>
          <p>{card.traits.join('\n') || '未填写'}</p>
          <b>人物经历</b>
          <p>{card.backstory || '未填写'}</p>
          <b>笔记</b>
          <p>{card.notes || '未填写'}</p>
          <b>行囊</b>
          {card.items.length ? (
            card.items.map((item) => (
              <p key={item.id}>
                {item.name} × {item.quantity}
                {item.notes && ` · ${item.notes}`}
              </p>
            ))
          ) : (
            <p>无物品</p>
          )}
        </div>
      </details>
    </div>
  );
}
function PolicyEditor({
  room,
  isHost,
  run,
}: {
  room: Room;
  isHost: boolean;
  run: (a: RoomAction) => Promise<boolean>;
}) {
  const [policy, setPolicy] = useState<CreationPolicy>(() => structuredClone(room.creationPolicy));
  const [revision, setRevision] = useState(room.policyRevision);
  const [occupationText, setOccupationText] = useState(
    room.creationPolicy.allowedOccupations.join('、'),
  );
  const [ancestryText, setAncestryText] = useState(
    room.creationPolicy.allowedAncestries.join('、'),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const editable = isHost && room.phase === 'lobby';
  const p = isHost ? policy : room.creationPolicy;
  const fields = policyFields(room.rule);
  const patch = (values: Partial<CreationPolicy>) => setPolicy((old) => ({ ...old, ...values }));
  const save = async () => {
    const parsed = CreationPolicySchema.safeParse(policy);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('；'));
      return;
    }
    setBusy(true);
    setError('');
    if (await run({ type: 'creation-policy', policy: parsed.data, expectedRevision: revision }))
      setRevision(revision + 1);
    setBusy(false);
  };
  return (
    <div className="policy-editor">
      <div className="helper-callout">
        <ShieldCheck size={21} />
        <p>
          这里的限制叠加在基础分配规则之上。保存新限制会撤销所有玩家的旧审核与准备状态；单项范围优先于通用技能上限。
        </p>
      </div>
      {isHost && revision !== room.policyRevision && (
        <div className="inline-error" role="alert">
          限制已在另一处更新，请先读取最新版本。
          <button
            className="text-button"
            onClick={() => {
              setPolicy(structuredClone(room.creationPolicy));
              setOccupationText(room.creationPolicy.allowedOccupations.join('、'));
              setAncestryText(room.creationPolicy.allowedAncestries.join('、'));
              setRevision(room.policyRevision);
            }}
          >
            读取最新限制
          </button>
        </div>
      )}
      <fieldset disabled={!editable}>
        {room.rule === 'coc' ? (
          <div className="policy-basics">
            <label className="field">
              通用技能上限
              <input
                aria-label="通用技能上限"
                type="number"
                min={1}
                max={99}
                value={p.cocSkillCap}
                onChange={(e) => patch({ cocSkillCap: Number(e.target.value) })}
              />
              <small>99 为默认值，75 等限制属于本桌约定。</small>
            </label>
            <div className="policy-checkboxes">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={p.allowInterestOnOccupation !== false}
                  onChange={(e) => patch({ allowInterestOnOccupation: e.target.checked })}
                />
                允许兴趣点投入职业技能（含信用评级）
              </label>
              <p className="subtle-note">
                关闭后专点专用：职业点用于职业技能，兴趣点只用于其他技能。已有投入需由玩家退回后重分配。
              </p>

              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={p.requireAllPoints}
                  onChange={(e) => patch({ requireAllPoints: e.target.checked })}
                />
                必须用完职业点与兴趣点
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={p.allowMythos}
                  onChange={(e) => patch({ allowMythos: e.target.checked })}
                />
                允许初始克苏鲁神话（仍消耗兴趣点）
              </label>
            </div>
          </div>
        ) : (
          <div className="form-grid">
            <label className="field">
              额外技能熟练名额
              <input
                type="number"
                min={0}
                max={18}
                value={p.dndExtraSkills}
                onChange={(e) => patch({ dndExtraSkills: Number(e.target.value) })}
              />
              <small>用于审核通过的专长、兼职与职业特性。</small>
            </label>
            <label className="field">
              额外豁免熟练名额
              <input
                type="number"
                min={0}
                max={6}
                value={p.dndExtraSaves}
                onChange={(e) => patch({ dndExtraSaves: Number(e.target.value) })}
              />
            </label>
          </div>
        )}
        <div className="policy-section-heading">
          <div>
            <h3>单项数值范围</h3>
            <p>可以限定属性、总和、技能、资源，以及年龄或等级。</p>
          </div>
          {editable && (
            <button
              className="button secondary compact"
              onClick={() => {
                const key = fields.find((f) => !p.ranges.some((r) => r.field === f.key))?.key;
                if (key)
                  patch({
                    ranges: [
                      ...p.ranges,
                      { field: key, min: 1, max: room.rule === 'dnd' ? 20 : 99 },
                    ],
                  });
              }}
            >
              <Plus size={14} />
              新增范围
            </button>
          )}
        </div>
        <div className="policy-ranges">
          {p.ranges.map((range, i) => (
            <div className="policy-range" key={i}>
              <label className="field">
                限制项目
                <select
                  aria-label={`限制项目 ${i + 1}`}
                  value={range.field}
                  onChange={(e) =>
                    patch({
                      ranges: p.ranges.map((r, n) =>
                        n === i ? { ...r, field: e.target.value } : r,
                      ),
                    })
                  }
                >
                  {fields
                    .filter(
                      (f) => f.key === range.field || !p.ranges.some((r) => r.field === f.key),
                    )
                    .map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                下限
                <input
                  aria-label={`下限 ${i + 1}`}
                  type="number"
                  value={range.min}
                  onChange={(e) =>
                    patch({
                      ranges: p.ranges.map((r, n) =>
                        n === i ? { ...r, min: Number(e.target.value) } : r,
                      ),
                    })
                  }
                />
              </label>
              <span>—</span>
              <label className="field">
                上限
                <input
                  aria-label={`上限 ${i + 1}`}
                  type="number"
                  value={range.max}
                  onChange={(e) =>
                    patch({
                      ranges: p.ranges.map((r, n) =>
                        n === i ? { ...r, max: Number(e.target.value) } : r,
                      ),
                    })
                  }
                />
              </label>
              {editable && (
                <button
                  className="icon-button"
                  aria-label={`移除范围 ${i + 1}`}
                  onClick={() => patch({ ranges: p.ranges.filter((_, n) => n !== i) })}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
          {!p.ranges.length && (
            <p className="subtle-note">
              尚无额外范围。仍遵守基础分配、职业信用区间及默认属性范围（D&D 1–20，CoC 1–99）。
            </p>
          )}
        </div>
        <div className="form-grid">
          <label className="field">
            允许的职业
            <textarea
              rows={2}
              aria-label="允许的职业"
              value={isHost ? occupationText : p.allowedOccupations.join('、')}
              placeholder="留空表示不额外限制，用顿号分隔"
              onChange={(e) => {
                setOccupationText(e.target.value);
                patch({
                  allowedOccupations: e.target.value
                    .split(/[、,，\n]/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                });
              }}
            />
          </label>
          <label className="field">
            {room.rule === 'dnd' ? '允许的种族' : '允许的国籍／出生地'}
            <textarea
              rows={2}
              aria-label={room.rule === 'dnd' ? '允许的种族' : '允许的国籍／出生地'}
              value={isHost ? ancestryText : p.allowedAncestries.join('、')}
              placeholder="留空表示不额外限制，用顿号分隔"
              onChange={(e) => {
                setAncestryText(e.target.value);
                patch({
                  allowedAncestries: e.target.value
                    .split(/[、,，\n]/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                });
              }}
            />
          </label>
        </div>
        <label className="field">
          剧本制卡说明
          <textarea
            rows={3}
            maxLength={2000}
            aria-label="剧本制卡说明"
            value={p.notes}
            placeholder="说明时代、人物关系、装备来源等需要人工审核的内容。"
            onChange={(e) => patch({ notes: e.target.value })}
          />
        </label>
      </fieldset>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {isHost && (
        <div className="review-actions">
          <button
            className="button secondary"
            disabled={!editable || busy}
            onClick={() => {
              setPolicy(defaultCreationPolicy(room.rule));
              setOccupationText('');
              setAncestryText('');
            }}
          >
            恢复默认设置
          </button>
          <button
            className="button primary"
            disabled={!editable || busy || revision !== room.policyRevision}
            onClick={() => void save()}
          >
            {busy ? <Spinner /> : <Check size={17} />}保存限制并重新审核
          </button>
        </div>
      )}
      {!editable && isHost && <p className="subtle-note">请先返回准备阶段，再修改限制。</p>}
    </div>
  );
}
