import {
  adjustedValue,
  adjustmentLabel,
  effectiveCharacter,
  hasAdjustments,
} from '../../shared/adjustments';
import type { Character } from '../../shared/types';

export function AdjustmentSummary({ card }: { card: Character }) {
  if (!hasAdjustments(card)) return null;
  const current = effectiveCharacter(card);
  const lasting = effectiveCharacter(card, false);
  return (
    <section className="adjustment-summary">
      <h4>局内修正记录</h4>
      <p className="subtle-note">
        制卡分配保留原始记录，检定使用修正后的生效值。重新审核时也请核对这些修正。
      </p>
      {card.adjustments!.permanent.map((entry) => (
        <div className="adjustment-summary-row" key={`${entry.target}:${entry.key}`}>
          <span>
            {adjustmentLabel(card, entry.target, entry.key)}
            <small>{entry.reason || '长期调整'}</small>
          </span>
          <span>
            长期 {adjustedValue(lasting, entry.target, entry.key)}
            <small>生效 {adjustedValue(current, entry.target, entry.key)}</small>
          </span>
        </div>
      ))}
      {card.adjustments!.temporary.map((effect) => (
        <div className="adjustment-summary-row" key={effect.id}>
          <span>
            {effect.name}
            <small>
              {effect.changes
                .map(
                  (entry) =>
                    `${adjustmentLabel(card, entry.target, entry.key)} ${entry.amount >= 0 ? '+' : ''}${entry.amount}`,
                )
                .join(' · ')}
              <br />
              {effect.endCondition || '手动结束'}
            </small>
          </span>
          <span className="subtle-note">{effect.enabled ? '生效中' : '已停用'}</span>
        </div>
      ))}
    </section>
  );
}
