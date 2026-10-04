import { useState } from 'react';
import { BookOpen, Check, Copy, Download, ChevronDown } from 'lucide-react';
import { DND_EXTRACTION_PROMPT, DND_IMPORT_TEMPLATE } from '../../shared/dnd-guide';
import tutorial from '../../docs/DND-STATBLOCKS.md?raw';
import { downloadFile } from '../storage';

export function DndImportGuide() {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(DND_EXTRACTION_PROMPT);
      setCopied(true);
      setError('');
    } catch {
      setExpanded(true);
      setError('请在下方全选复制提示词，或下载提示词文件。');
    }
  };
  return (
    <section className="keeper-import-guide" aria-label="D&D 数据块提取教程">
      <div className="import-guide-heading">
        <BookOpen size={24} />
        <div>
          <span className="mini-label">D&D 5E · 2014 / SRD 5.1</span>
          <h2>从剧本到数据块</h2>
          <p>把人物、能力与骰式整理成能随时查阅的资料。</p>
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
            downloadFile(DND_IMPORT_TEMPLATE, '幕间-DND数据块模板.md', 'text/markdown')
          }
        >
          <Download size={16} />
          下载 Markdown 模板
        </button>
        <button
          className="text-button"
          onClick={() => downloadFile(tutorial, '幕间-DND数据块教程.md', 'text/markdown')}
        >
          下载文字教程
        </button>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <ol className="guide-walkthrough">
        {[
          [
            '提供原文与版本',
            '复制提示词，连同剧本、PDF 或页图交给外部 AI Agent。指定 D&D 5e（2014），并说明章节、页码和要提取的角色。',
          ],
          [
            '保留数据块原值',
            'AC、HP、生命骰、攻击加值与伤害骰分别记录。法术、传奇动作和特殊条件保留原文含义。未知项留空，冲突与页码写入来源笔记，不按玩家制卡规则重算。',
          ],
          [
            '保存 Markdown 并导入',
            '让 Agent 输出只包含一个 JSON 数据块的 Markdown。保存为 .md 或 .json，在“个人数据块库”中点击“导入资料集”。每批最多 200 张、8 MiB。',
          ],
          [
            '核对后带入房间',
            '核对版本、数字、豁免 DC、次数与充能条件。进入 D&D 房间并担任 DM 后，将资料作为独立副本带入房间。',
          ],
          [
            '为本场生成个体',
            '在“场景与回合”中从房间库加入 NPC／怪物。同一份模板可生成多个个体，各自记录 HP、状态与能力次数。',
          ],
        ].map(([title, body], i) => (
          <li key={title}>
            <span>{String(i + 1).padStart(2, '0')}</span>
            <div>
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="guide-format-note">
        <b>文件格式</b>
        <p>
          <code>documentType: "dnd-source"</code>、<code>schemaVersion: 1</code>、
          <code>rule: "dnd"</code> 与 <code>cards</code>{' '}
          数组。网站补齐编号和空白字段；导入时不掷骰，不修改原文 HP，也不混用 2024 版规则。
        </p>
      </div>
      <div className="prompt-disclosure">
        <button
          className="text-button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronDown size={15} />
          {expanded ? '收起完整提示词' : '查看与手动复制提示词'}
        </button>
        <button
          className="text-button"
          onClick={() =>
            downloadFile(DND_EXTRACTION_PROMPT, '幕间-DND提取提示词.md', 'text/markdown')
          }
        >
          <Download size={14} />
          下载提示词
        </button>
      </div>
      {expanded && (
        <textarea
          className="keeper-prompt-text"
          aria-label="D&D LLM 提取提示词"
          readOnly
          value={DND_EXTRACTION_PROMPT}
          rows={16}
          onFocus={(e) => e.target.select()}
        />
      )}
    </section>
  );
}
