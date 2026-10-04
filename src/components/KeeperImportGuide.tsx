import { useState } from 'react';
import { BookOpen, Check, Copy, Download, FileText, ChevronDown } from 'lucide-react';
import { KEEPER_EXTRACTION_PROMPT, KEEPER_IMPORT_TEMPLATE } from '../../shared/keeper-guide';
import keeperTutorial from '../../docs/KEEPER-IMPORT.md?raw';
import { downloadFile } from '../storage';

export function KeeperImportGuide() {
  const [copied, setCopied] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [error, setError] = useState('');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(KEEPER_EXTRACTION_PROMPT);
      setCopied(true);
      setError('');
    } catch {
      setShowPrompt(true);
      setError('此浏览器未允许复制。请在下方提示词中全选复制，或下载提示词文件。');
    }
  };
  return (
    <section className="keeper-import-guide" aria-label="AI 剧本提取与导入教程">
      <div className="import-guide-heading">
        <BookOpen size={23} strokeWidth={1.5} />
        <div>
          <span className="mini-label">A SCRIPT, READY FOR THE TABLE</span>
          <h2>从剧本到卡库</h2>
          <p>复制完整提示词，交给能读取你剧本的 AI Agent；再把结果带回来。</p>
        </div>
      </div>
      <div className="import-guide-actions">
        <button className="button primary" onClick={() => void copy()}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? '提示词已复制' : '复制 LLM 提取提示词'}
        </button>
        <button
          className="button secondary"
          onClick={() =>
            downloadFile(KEEPER_IMPORT_TEMPLATE, '幕间-CoC-剧本资料模板.md', 'text/markdown')
          }
        >
          <Download size={16} />
          下载 Markdown 模板
        </button>
        <button
          className="text-button"
          onClick={() => downloadFile(keeperTutorial, '幕间-剧本资料导入教程.md', 'text/markdown')}
        >
          <FileText size={15} />
          下载文字教程
        </button>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {copied && (
        <p className="keeper-guide-success" role="status">
          完整提示词已复制，包含字段规范和可导入示例。请在外部 Agent 中补充剧本与提取范围。
        </p>
      )}
      <ol className="guide-walkthrough">
        <li>
          <span>01</span>
          <div>
            <h3>提供剧本与提取范围</h3>
            <p>
              在你选择的 AI Agent 中粘贴提示词，再附上 CoC 第 7
              版剧本、PDF、截图或已有文字。明确要提取的章节、页码或怪物名称。扫描版需由能读图或 OCR
              的 Agent 处理。
            </p>
          </div>
        </li>
        <li>
          <span>02</span>
          <div>
            <h3>保留原文，分开记录数值与骰式</h3>
            <p>
              例如力量固定值写入 STR，<code>3d6*5</code> 写入力量骰式。原文没有给出的值留空；不要让
              AI 把未知填成 0，或从平均值反推骰式。来源、页码、冲突和无法确认的字段写在资料说明中。
            </p>
          </div>
        </li>
        <li>
          <span>03</span>
          <div>
            <h3>保存 AI 输出的 Markdown 文件</h3>
            <p>
              要求输出一个完整的 <code>json</code> 代码块，每批最多 200 张。可直接保存为{' '}
              <code>.md</code>，或将该代码块里的数据保存为 <code>.json</code>
              。下载的模板含两张原创示例卡，可先试导入了解格式。
            </p>
          </div>
        </li>
        <li>
          <span>04</span>
          <div>
            <h3>导入个人卡库，核对后使用</h3>
            <p>
              打开“个人卡库 → 导入资料集”。若格式不符，按提示将卡片名、字段与错误交给 AI
              修正。对照原文核对属性、HP、攻击成功率、伤害、护甲和理智损失；尤其留意 OCR
              的数字、乘号和括号。
            </p>
          </div>
        </li>
        <li>
          <span>05</span>
          <div>
            <h3>将资料带入当前房间</h3>
            <p>
              以 KP 身份进入 CoC
              房间后，个人卡库会出现“带入当前房间”和“全部带入房间”。带入的是独立副本；局内修改不会覆盖个人原稿。也可将房间卡存回个人库，留待下次使用。
            </p>
          </div>
        </li>
      </ol>
      <div className="guide-format-note">
        <b>文件中哪些内容必须保留？</b>
        <p>
          <code>documentType: "keeper-source"</code>、<code>schemaVersion: 1</code>、
          <code>rule: "coc"</code> 和 <code>cards</code>{' '}
          数组。每张卡填写名称、类型与分类；系统会补齐编号和时间，其余未知数值保持空值。属性骰式只在你点击“按骰式重掷”时使用。
        </p>
      </div>
      <div className="guide-format-note">
        <b>适用范围</b>
        <p>
          这套模板用于 CoC 7 的
          NPC／怪物资料，不是玩家调查员卡。原文里的特殊规则以文字保留，不会自动执行战斗或扣除理智。已有的幕间完整
          JSON／Markdown 卡仍可导入。
        </p>
      </div>
      <div className="prompt-disclosure">
        <button
          className="text-button"
          aria-expanded={showPrompt}
          onClick={() => setShowPrompt(!showPrompt)}
        >
          <ChevronDown size={15} />
          {showPrompt ? '收起完整提示词' : '查看与手动复制提示词'}
        </button>
        <button
          className="text-button"
          onClick={() =>
            downloadFile(KEEPER_EXTRACTION_PROMPT, '幕间-外部Agent提取提示词.md', 'text/markdown')
          }
        >
          <Download size={14} />
          下载提示词
        </button>
      </div>
      {showPrompt && (
        <textarea
          className="keeper-prompt-text"
          aria-label="LLM 提取提示词"
          value={KEEPER_EXTRACTION_PROMPT}
          readOnly
          rows={16}
          onFocus={(e) => e.target.select()}
        />
      )}
    </section>
  );
}
