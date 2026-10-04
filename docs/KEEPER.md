# CoC 7 · KP 的 NPC 与怪物资料库

KP 卡是独立的场景资料，采用 `KeeperCard`，与玩家调查员的 `Character` 分开保存。它不占玩家席位，不参加准备流程，不计算调查员职业点或兴趣点。卡片的全部内容（包括名字、数值、能力与笔记）应只进入当前主持人的房间快照；访问控制由服务端实施，不能只在页面隐藏。

## 规则核对：分类不是固定战力档位

本次核对了用户指定的 [AgnesSummer/TRPG 仓库](https://github.com/AgnesSummer/TRPG)，目录树版本为 `78b8a456470d52cfe4f46092803771995043eb55`。其中《COC7th核心规则书 v1.2.1》第十四章（书页 240，PDF 第 248 页）将资料分为神话生物、神话神祇、经典怪物和野兽。与 [Chaosium 官方 Bestiary 导言](https://cthulhuwiki.chaosium.com/bestiary/)的四类划分一致。这些是内容分类，**不是“小怪／精英／首领”的统一数值模板**。

官方导言说明：条目通常提供典型个体的数值，并允许 KP 按相应骰式生成个体或调整样本；许多非人类实体没有适用的 APP、EDU。官方示例也存在远高于 100 的 STR、SIZ 等数值。因此本工具允许属性为空、超过 100，允许分别记录固定值和属性骰式；不会把调查员的属性范围套到怪物身上。[来源：官方条目说明与数值示例](https://cthulhuwiki.chaosium.com/bestiary/mythos-monsters.html)。

NPC 的处理也不要求填满调查员卡。仓库核心书第 10.4 节（书页 157，PDF 第 165 页）建议根据与玩家互动的需要补充相关属性／技能，战斗值也可按角色用途临场确定。[Chaosium 官方第七版转换说明](https://www.chaosium.com/content/FreePDFs/CoC%207/CHA23135-Conv%20-%20Call%20of%20Cthulhu%207th%20Edition%20Conversion%20Guidelines.pdf#page=5)同样指出，NPC 通常比调查员简略，只记录需要的技能。因此本工具把 NPC 做成自由录入的 KP 资料，不实施玩家职业预算。

这些来源支持“分类、典型值、按骰式生成、KP 自行调整”的工作方式；它们没有授权本项目宣称一套自行设定的战力平衡体系。HP 归零也不自动表示神祇死亡，后续状态仍由 KP 判断。

## 内置目录

| 模板 ID               | 用途                                      | 数据性质           |
| --------------------- | ----------------------------------------- | ------------------ |
| `npc-blank`           | 简略 NPC，属性可以全空                    | 空白记录结构       |
| `npc-bystander`       | 普通路人，带少量实用技能                  | 本项目原创便捷示例 |
| `npc-contact`         | 档案馆联络人，便于制作线索人物            | 本项目原创便捷示例 |
| `monster-mist-hound`  | 雾岸猎影，演示超过 100 的属性、攻击与能力 | 本项目原创怪物     |
| `monster-mythos`      | 神话生物                                  | 分类空白卡         |
| `monster-deity`       | 神话神祇                                  | 分类空白卡         |
| `monster-traditional` | 传统恐怖生物                              | 分类空白卡         |
| `monster-beast`       | 野兽                                      | 分类空白卡         |
| `monster-blank`       | 自定义怪物                                | 分类空白卡         |

内置 NPC 的固定属性取常用人类属性骰式的期望值后向下取整；其技能值是原创示例。雾岸猎影的全部设定与数值也是原创。它们不是官方完整怪物卡、官方战力等级或经过验证的遭遇平衡方案。UI 应显示模板的 `source`／“原创示例”标签。需要某个正式模组怪物时，由 KP 从有权使用的材料中填写自己的卡片。

`average` 模式复制模板保存的**固定参考值**，不是临时再计算一遍数学均值。`roll` 模式逐项使用模板骰式；没有骰式的属性保持其固定值或空值。空白卡没有骰式，选择重掷也不会凭空生成属性。

## 数值与资源

属性字段为 `str/con/siz/dex/app/int/pow/edu`。`null` 表示未知或不适用；`0` 是明确的零值，不等于空白。

当 KP 主动更新属性时，`deriveKeeperCard` 可计算 `floor((CON+SIZ)/10)` 的 HP 上限、`floor(POW/5)` 的 MP 上限及 STR+SIZ 对应的 DB／体格。基础公式参见 [Chaosium 副属性说明](https://cthulhuwiki.chaosium.com/investigators/step-two-secondary-attributes.html)；超过 204 的 DB／体格延伸区间已核对仓库核心书创建调查员速查表（书页 30，PDF 第 38 页）。

更新派生值不会恢复已经消耗的 HP／MP，只会在超过新上限时向下截断。缺少计算所需属性时，保留现有手填上限及 DB／体格。HP、MP、DB、体格在资料卡中仍可手动录入，以适应模组例外；导入时不会强制用基础公式覆盖模组数值。

移动以文本记录，以便填写“陆地 8／游泳 10／飞行 16”等多种方式。护甲数值与护甲说明分开。伤害式、特殊能力及理智损失按文字记录，不能把 `DB`、护甲例外或能力文字当成可执行代码。理智损失建议写成“成功损失／失败损失”，例如 `0/1d4`；本工具不自动对玩家扣除资源。

每项攻击记录名称、成功率（可空）、伤害和说明。每项技能直接记录最终数值。怪物超过 100 的技能／属性须由相应检定工具完整处理；不能简单截断到 100，否则困难与极难成功阈值会改变。

## 生成与复制

- `createKeeperCard('npc' | 'monster')`：创建对应空白卡。
- `createKeeperCard(templateId, { mode: 'average' | 'roll', name?, rng? })`：从模板生成一张，初始化 HP／MP 为计算出的上限。
- `createKeeperBatch(templateId, count, { mode?, name?, startIndex?, rng? })`：一次生成 1–200 张，并加连续编号。`name` 是编号前缀。
- `rerollKeeperCard(card, rng?)`：根据卡片自己保存的骰式重投；保留身份、文本、攻击、技能和当前资源损耗。
- `duplicateKeeperCard(card, name?)`：复制全部资料，生成新的卡片、攻击和技能 ID；副本与原卡互不影响。复制会保留当前资源状态。

属性骰式只支持有界格式：`3d6*5`、`(2d6+6)*5`、`2d6+6` 或固定整数。乘号也可写 `×`。`2d6+6*5` 含歧义，必须加括号。不会执行 JavaScript，也不支持任意算式、函数、嵌套括号或多段乘法。每项最多 100 颗骰子、每颗 2–1000 面、修正不超过 ±10000、乘数 1–1000，而且整个结果范围都必须在 0–100000 内。空骰式表示不随机。

## JSON／Markdown 格式与校验

单张卡使用 `schemaVersion: 1`、`documentType: 'keeper-card'`、`rule: 'coc'`。资料集使用 `documentType: 'keeper-collection'`，`cards` 为 1–200 张卡。与调查员文件的格式标识不同，误导入玩家卡会被拒绝。

导出可以是 JSON 或带单个 `json` 代码块的 Markdown。Markdown 上方是阅读摘要，下方 JSON 包含所有字段；重新导入以 JSON 为准。`parseKeeperCards` 支持单卡、资料集和原始卡片数组；`parseKeeperCard` 只接受恰好一张卡。

数据边界：属性、HP／MP、护甲最多 100000；攻击／技能数值最多 1000；体格范围 −10 至 3000；每轮攻击次数 0–100，未知时可留空。每卡最多 30 项攻击、100 项技能、30 个标签；私密笔记最多 24000 字符，特殊能力最多 12000 字符。批量文件最多 8000000 字符且 UTF-8 编码不得超过 8 MiB，超过限制须拆批。导出也执行相同文件大小限制，保证导出的文件可由本工具重新读取。

`KeeperCardSchema` 可直接用于服务端输入验证。它拒绝版本／规则错误、未知字段、伪数字、非法对象键、过深结构、循环引用、重复攻击／技能 ID，以及高于资源上限的当前值。批量文件还拒绝重复卡片 ID。合法数值不表示遭遇公平或符合某个具体模组；KP 仍负责取舍。

导出文件包含私密笔记。房间内的私密性由主持人权限控制；下载的 JSON／Markdown 本身不加密。

## 查阅的具体资料

- [官方 Bestiary：条目结构、四类内容、均值与个体骰式](https://cthulhuwiki.chaosium.com/bestiary/)。
- [官方 Mythos Monsters：包含超过 100 的属性和属性骰式实例](https://cthulhuwiki.chaosium.com/bestiary/mythos-monsters.html)。
- [官方 Conversion Guidelines：NPC／神祇／野兽／怪物的精简数据与转换](https://www.chaosium.com/content/FreePDFs/CoC%207/CHA23135-Conv%20-%20Call%20of%20Cthulhu%207th%20Edition%20Conversion%20Guidelines.pdf)。
- [指定仓库核心规则书](https://github.com/AgnesSummer/TRPG/blob/78b8a456470d52cfe4f46092803771995043eb55/COC/规则资料/COC7th核心规则书v1.2.1.pdf)：第 10.4 节、第十四章、创建调查员速查表。
- [指定仓库调查员手册 1.16](https://github.com/AgnesSummer/TRPG/blob/78b8a456470d52cfe4f46092803771995043eb55/COC/规则资料/克苏鲁的呼唤第七版调查员手册1.16.pdf)：用于核对玩家职业机制；其职业点预算不施加到本模块。

本项目未打包这些规则书，未复制完整官方怪物库，也不代表 Chaosium 官方产品。
