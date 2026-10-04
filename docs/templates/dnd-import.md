# D&D 5e（2014 / SRD 5.1）· 数据块导入示例

这两张卡和所列页码均为原创格式演示，不是官方 NPC／怪物卡。可直接保存为 UTF-8 Markdown 并导入 D&D 个人卡库。整理自己的来源时，请删除示例角色，只记录有依据的内容。

固定 HP、生命骰和伤害文字分别保存，导入不掷骰、不计算均值、不补满当前 HP。铜灯构装体的 HP 上限保留为场景指定的 27。

```json
{
  "schemaVersion": 1,
  "documentType": "dnd-source",
  "rule": "dnd",
  "cards": [
    {
      "name": "祈灯桥的值夜人",
      "kind": "npc",
      "size": "中型",
      "creatureType": "类人生物（人类）",
      "alignment": "守序中立",
      "description": "原创示例人物，负责登记夜间过桥的旅人。",
      "ac": 14,
      "acNotes": "示例指定的护甲等级，装备细节未提供。",
      "maxHp": 13,
      "hitDice": "2d8 + 4",
      "speed": "步行 30 尺",
      "attributes": {
        "str": 12,
        "dex": 12,
        "con": 14,
        "int": 10,
        "wis": 14,
        "cha": 10
      },
      "saves": {
        "con": 4
      },
      "skills": [
        {
          "name": "察觉",
          "value": 4
        }
      ],
      "senses": "被动察觉 14",
      "languages": "通用语",
      "actions": [
        {
          "name": "木棍",
          "description": "近战武器攻击，触及 5 尺，单一目标。",
          "attackBonus": 3,
          "damage": "1d4 + 1 钝击伤害"
        }
      ],
      "source": "原创格式演示《祈灯桥》· 第 2 页（虚构示例页码，不对应真实出版物）；按 2014 规则用语编写",
      "notes": "证据：示例第 2 页列出身份、AC、HP 总量及生命骰、移动、六项属性、CON 豁免、察觉、感官、语言与木棍攻击。缺失：当前 HP、CR、XP、抗性、免疫、传奇行动与次数均未注明，保持空白。冲突：无。",
      "tags": [
        "原创示例",
        "NPC"
      ]
    },
    {
      "name": "铜灯构装体",
      "kind": "monster",
      "size": "小型",
      "creatureType": "构装生物",
      "alignment": "无阵营",
      "description": "原创示例怪物，守护桥下旧灯房。",
      "ac": 17,
      "maxHp": 27,
      "hitDice": "4d6 + 4",
      "speed": "步行 20 尺",
      "attributes": {
        "str": 14,
        "dex": 10,
        "con": 12,
        "int": 3,
        "wis": 12,
        "cha": 5
      },
      "immunities": "毒素伤害",
      "conditionImmunities": "中毒",
      "traits": [
        {
          "name": "灯房加护",
          "description": "示例规定灯房中的个体 HP 上限为 27，已包含场景加护。保留此固定值，不按生命骰重算。"
        }
      ],
      "actions": [
        {
          "name": "灯壳撞击",
          "description": "近战武器攻击，触及 5 尺，单一目标。",
          "attackBonus": 4,
          "damage": "5 (1d6 + 2) 钝击伤害"
        },
        {
          "name": "眩光",
          "description": "示例指定：前方 10 尺锥形区域内的生物作一次敏捷豁免，失败者目盲，持续至构装体下个回合结束。",
          "saveDc": 12,
          "saveAbility": "dex",
          "recharge": "5–6 充能"
        }
      ],
      "source": "原创格式演示《祈灯桥》· 第 5 页（虚构示例页码，不对应真实出版物）；按 2014 规则用语编写",
      "notes": "证据：示例第 5 页列出形态、固定 AC、加护后的 HP 上限 27、原生命骰、移动、属性、免疫、攻击与眩光。缺失：当前 HP、CR、XP、未列出的豁免、技能、感官、语言与传奇行动数均未知。冲突：HP 与常规生命骰均值不同，原文明确为场景加护，分别原样记录。眩光没有伤害数值，damage 留空，不写成 0。",
      "tags": [
        "原创示例",
        "构装生物"
      ]
    }
  ]
}
```
