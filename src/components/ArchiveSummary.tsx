import type { ArchiveSummary } from '../../shared/archive';
import { ruleEdition } from './ui';
export function ArchiveSummaryView({ value }: { value: ArchiveSummary }) {
  return (
    <div className="archive-summary">
      <div>
        <span>规则与阶段</span>
        <b>
          {ruleEdition(value.rule)} · {value.phase === 'active' ? '进行中' : '准备中'}
        </b>
      </div>
      <div>
        <span>过程记录</span>
        <b>{value.eventCount.toLocaleString()} 条</b>
      </div>
      <div>
        <span>备团资料</span>
        <b>
          {value.atlasCount} 本地图册 · {value.cardCount} 张卡片
        </b>
      </div>
      <div>
        <span>停留场景</span>
        <b>{value.scene || '尚未设置'}</b>
      </div>
      <div className="archive-summary-players">
        <span>玩家席位</span>
        <b>{value.players.map((p) => `${p.name} / ${p.character}`).join('、') || '尚无玩家'}</b>
      </div>
      {value.imageCount > 0 && (
        <p className="archive-notice">
          含 {value.imageCount} 张图片引用。原图保存在服务器，过期或不可用时显示占位符。
        </p>
      )}
      {!value.historyComplete && (
        <p className="archive-notice">
          此房间曾由旧版本截断历史。存档包含升级时仍保留的记录，以及此后的完整记录。
        </p>
      )}
    </div>
  );
}
