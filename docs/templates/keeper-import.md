# CoC 7 · 剧本资料导入示例

下方两张卡均为原创演示，页码也明确标为虚构示例。可直接保存为 UTF-8 Markdown 并导入 KP 资料库。换成自己的剧本资料时，请删除示例角色，只填写原文能够支持的内容。

未知属性及当前资源保持空白；有骰式也不会在导入时掷骰。钟室回声兽的 HP 上限保留剧本给定的 27，不用属性公式覆盖。

```json
{
  "schemaVersion": 1,
  "documentType": "keeper-source",
  "rule": "coc",
  "cards": [
    {
      "name": "林栖 · 档案室值班员",
      "kind": "npc",
      "category": "human",
      "description": "原创示例人物。负责夜间档案借阅，注意到借阅簿中出现同一个陌生签名。",
      "attributes": {
        "con": 50,
        "siz": 60,
        "dex": 50,
        "int": 70,
        "edu": 75
      },
      "maxHp": 11,
      "attacksPerRound": null,
      "skills": [
        {
          "name": "图书馆使用",
          "value": 65
        },
        {
          "name": "聆听",
          "value": 40
        }
      ],
      "notes": "证据：示例第 2 页列出这些属性、HP 上限和技能。缺失：STR、APP、POW、MP、攻击次数及当前 HP 均未注明，保持空白。冲突：无。",
      "source": "原创演示《潮声档案》· 第 2 页（虚构示例页码，不对应真实出版物）",
      "tags": [
        "原创示例",
        "线索人物"
      ]
    },
    {
      "name": "钟室回声兽",
      "kind": "monster",
      "category": "custom",
      "description": "原创示例生物。身形只在钟声停下的一瞬间显现，分类未定。",
      "attributes": {
        "str": 100,
        "con": 60,
        "siz": 130,
        "dex": 65,
        "app": null,
        "int": 40,
        "pow": null,
        "edu": null
      },
      "attributeRolls": {
        "str": "(2d6+13)*5"
      },
      "maxHp": 27,
      "armor": 2,
      "armorNotes": "示例第 5 页注明普通护甲 2；未说明对其他伤害的抵抗。",
      "movement": "陆地 8",
      "attacks": [
        {
          "name": "回声侵袭",
          "skill": 55,
          "damage": "1d4",
          "notes": "使用示例直接给出的伤害；不自行追加 DB。"
        }
      ],
      "specialAbilities": "钟声持续时隐去轮廓。示例没有给出数值加成，不补写奖励骰。",
      "sanityLoss": "0/1d4",
      "notes": "证据：示例第 5 页给出固定 STR、STR 骰式、攻击及祭坛加护后的 HP 上限 27。HP 不按 CON+SIZ 重算。缺失：POW、MP、DB、体格、每轮攻击次数和当前 HP 未给出。冲突：无。",
      "source": "原创演示《潮声档案》· 第 5 页（虚构示例页码，不对应真实出版物）",
      "tags": [
        "原创示例",
        "钟室"
      ]
    }
  ]
}
```
