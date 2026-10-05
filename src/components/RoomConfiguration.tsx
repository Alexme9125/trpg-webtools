import { useRef, useState } from 'react';
import { Download, Upload, Check, Settings2 } from 'lucide-react';
import type { Room, RoomAction } from '../../shared/types';
import {
  exportRoomConfig,
  parseRoomConfig,
  roomConfiguration,
  MAX_ROOM_CONFIG_BYTES,
  type RoomConfig,
} from '../../shared/room-config';
import { policyFields } from '../../shared/creation';
import { downloadFile } from '../storage';
import { Modal, Spinner, ruleEdition } from './ui';

export function ConfigurationSummary({ value }: { value: RoomConfig }) {
  const p = value.creationPolicy;
  const fields = policyFields(value.rule);
  return (
    <div className="configuration-summary">
      <dl>
        <dt>房间名称</dt>
        <dd>{value.name}</dd>
        <dt>规则</dt>
        <dd>{ruleEdition(value.rule)}</dd>
        <dt>演绎方式</dt>
        <dd>{value.mode === 'in-room' ? '房内演绎' : '外部演绎'}</dd>
        {value.rule === 'coc' ? (
          <>
            <dt>技能上限</dt>
            <dd>{p.cocSkillCap}</dd>
            <dt>点数使用</dt>
            <dd>
              {p.allowInterestOnOccupation ? '兴趣点可投入职业技能' : '专点专用（含信用评级）'}；
              {p.requireAllPoints ? '须分完全部点数' : '允许保留余点'}；
              {p.allowMythos ? '允许初始神话' : '初始神话为 0'}
            </dd>
          </>
        ) : (
          <>
            <dt>额外熟练</dt>
            <dd>
              技能 {p.dndExtraSkills} 项 · 豁免 {p.dndExtraSaves} 项
            </dd>
          </>
        )}
        <dt>职业范围</dt>
        <dd>{p.allowedOccupations.join('、') || '不限'}</dd>
        <dt>种族范围</dt>
        <dd>{p.allowedAncestries.join('、') || '不限'}</dd>
        <dt>单项限制</dt>
        <dd>
          {p.ranges.length ? (
            <ul>
              {p.ranges.map((r) => (
                <li key={r.field}>
                  {fields.find((f) => f.key === r.field)?.label ?? r.field}：{r.min}–{r.max}
                </li>
              ))}
            </ul>
          ) : (
            '无额外范围'
          )}
        </dd>
        <dt>制卡备注</dt>
        <dd>{p.notes || '无'}</dd>
        <dt>当前场景</dt>
        <dd>
          {value.scene.title || '未设置'}
          {value.scene.description && <p>{value.scene.description}</p>}
        </dd>
      </dl>
    </div>
  );
}
export function RoomConfiguration({
  room,
  onAction,
  onClose,
}: {
  room: Room;
  onAction: (a: RoomAction) => Promise<void>;
  onClose: () => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [incoming, setIncoming] = useState<RoomConfig | null>(null);
  const [revision, setRevision] = useState(room.configRevision);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const importFile = async (picked?: File) => {
    if (!picked) return;
    try {
      if (picked.size > MAX_ROOM_CONFIG_BYTES) throw new Error('房间配置不能超过 128 KiB。');
      const parsed = parseRoomConfig(await picked.text());
      if (parsed.rule !== room.rule)
        throw new Error('配置规则与当前房间不匹配，请在相同规则的房间中导入。');
      setIncoming(parsed);
      setRevision(room.configRevision);
      setError('');
      setDone(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (file.current) file.current.value = '';
    }
  };
  const apply = async () => {
    if (!incoming || busy) return;
    setBusy(true);
    setError('');
    try {
      await onAction({ type: 'room-config', configuration: incoming, expectedRevision: revision });
      setIncoming(null);
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="房间配置"
      subtitle="导出本桌约定，下次开团时直接复用。"
      onClose={() => {
        if (!busy) onClose();
      }}
      className="room-configuration-modal"
    >
      <div className="configuration-actions">
        {(['json', 'md'] as const).map((format) => (
          <button
            key={format}
            className="button secondary compact"
            onClick={() =>
              downloadFile(
                exportRoomConfig(roomConfiguration(room), format),
                `${room.name}-房间配置.${format}`,
                format === 'json' ? 'application/json' : 'text/markdown',
              )
            }
          >
            <Download size={16} />
            导出配置 {format === 'md' ? 'Markdown' : 'JSON'}
          </button>
        ))}
        <button
          className="button primary compact"
          disabled={busy || room.phase !== 'lobby'}
          onClick={() => file.current?.click()}
        >
          <Upload size={16} />
          导入房间配置
        </button>
        <input
          ref={file}
          type="file"
          accept=".json,.md,.markdown"
          className="visually-hidden"
          aria-label="房间配置文件"
          disabled={room.phase !== 'lobby'}
          onChange={(e) => void importFile(e.target.files?.[0])}
        />
      </div>
      <p className="subtle-note">
        配置包含房名、规则、演绎方式、制卡要求与当前公开场景。角色、房间码、会话凭证、聊天和备团库各自保留。
      </p>
      {room.phase !== 'lobby' && (
        <p className="allocation-policy-note">故事进行中可以导出；返回准备阶段后才能导入配置。</p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="atlas-success" role="status">
          <Check size={16} />
          房间配置已应用，请重新准备并审核角色卡。
        </p>
      )}
      {incoming && (
        <section className="configuration-incoming">
          <h3>
            <Upload size={18} />
            待导入配置
          </h3>
          <ConfigurationSummary value={incoming} />
          <p>应用后，所有成员需要重新准备，玩家角色卡需要重新审核。</p>
          {revision !== room.configRevision && (
            <p className="inline-error">
              当前配置已被修改，请先核对下方最新配置。
              <button className="text-button" onClick={() => setRevision(room.configRevision)}>
                已核对，使用最新版本
              </button>
            </p>
          )}
          <div className="button-row">
            <button
              className="button primary"
              disabled={busy || room.phase !== 'lobby' || revision !== room.configRevision}
              onClick={() => void apply()}
            >
              {busy ? <Spinner /> : <Check size={16} />}应用配置并重新审核
            </button>
            <button className="text-button" disabled={busy} onClick={() => setIncoming(null)}>
              取消导入
            </button>
          </div>
        </section>
      )}
      <h3 className="configuration-title">
        <Settings2 size={18} />
        当前配置
      </h3>
      <ConfigurationSummary value={roomConfiguration(room)} />
    </Modal>
  );
}
