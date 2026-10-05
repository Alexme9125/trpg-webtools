import { defaultCreationPolicy, suggestAllocation } from '../../shared/creation';
import { createCharacter } from '../../shared/rules';
import type { RuleId } from '../../shared/types';

export function preparedCharacter(rule: RuleId = 'dnd') {
  return suggestAllocation(
    {
      ...createCharacter(rule, () => 4),
      name: rule === 'dnd' ? '希尔' : '林雾',
      occupation: rule === 'dnd' ? '战士' : '记者',
      ancestry: rule === 'dnd' ? '人类' : '',
    },
    defaultCreationPolicy(rule),
  );
}
