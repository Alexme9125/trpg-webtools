# 幕间 · 地图与场景提取模板

替换原创示例内容后导入。地图是地点布局描述，可包含多个场景；没有地图的场景使用 mapKey: null。

```json
{
  "documentType": "atlas-source",
  "schemaVersion": 1,
  "atlases": [
    {
      "name": "雾港来信 · 地图册",
      "rule": "any",
      "summary": "原创示例：港口与灯塔的调查场景。",
      "source": "原创示例，无外部剧本数值",
      "maps": [
        {
          "key": "harbour",
          "name": "雾港码头",
          "description": "码头沿海湾弯曲，北端的石阶通往灯塔。仓库位于东侧。",
          "keeperNotes": "夜间潮水上涨会封住仓库后门；由主持人决定时机。"
        },
        {
          "key": "lighthouse",
          "name": "北岸灯塔",
          "description": "一条山路连接码头与塔门，内部旋梯通往钟室。",
          "keeperNotes": ""
        }
      ],
      "scenes": [
        {
          "mapKey": "harbour",
          "title": "码头上的来信",
          "description": "雾气吞没了远处的船影。木箱上压着一封潮湿的信。",
          "keeperNotes": "线索：信封背面留有灯塔的图案。",
          "source": "原创示例 · 第一幕",
          "tags": [
            "开场",
            "调查"
          ]
        },
        {
          "mapKey": "harbour",
          "title": "紧闭的仓库",
          "description": "铁门轻轻晃动，地面残留着通向海边的水迹。",
          "keeperNotes": "秘密：守夜人正在里面藏身。公布描述时不要透露这一点。",
          "source": "原创示例 · 第二幕",
          "tags": [
            "探索"
          ]
        },
        {
          "mapKey": "lighthouse",
          "title": "灯塔钟室",
          "description": "钟摆已经停下，玻璃窗外依然传来低沉的回声。",
          "keeperNotes": "待确认：回声的来源由主持人决定。",
          "source": "原创示例 · 第三幕",
          "tags": [
            "转折"
          ]
        }
      ]
    }
  ]
}
```
