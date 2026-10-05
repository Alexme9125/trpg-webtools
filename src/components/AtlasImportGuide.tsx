import { useState } from 'react';
import { BookOpen, Copy, Download, Check } from 'lucide-react';
import { ATLAS_EXTRACTION_PROMPT, ATLAS_IMPORT_TEMPLATE } from '../../shared/atlas-guide';
import tutorial from '../../docs/ATLAS.md?raw';
import { downloadFile } from '../storage';

export function AtlasImportGuide() {
  const [copied, setCopied] = useState(false);
  const [show, setShow] = useState(false);
  return (
    <section className="keeper-import-guide" aria-label="地图与场景提取教程">
      <div className="import-guide-heading">
        <BookOpen size={24} />
        <div>
          <span className="mini-label">SCRIPT TO SCENES</span>
          <h2>利用 AI 从剧本中提取地图与场景</h2>
          <p>将地点布局、公开描述和主持人笔记分开整理。</p>
        </div>
      </div>
      <div className="import-guide-actions">
        <button
          className="button primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(ATLAS_EXTRACTION_PROMPT);
              setCopied(true);
            } catch {
              setShow(true);
            }
          }}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? '提示词已复制' : '复制地图提取提示词'}
        </button>
        <button
          className="button secondary"
          onClick={() =>
            downloadFile(ATLAS_IMPORT_TEMPLATE, '幕间-地图场景模板.md', 'text/markdown')
          }
        >
          <Download size={16} />
          下载地图 Markdown 模板
        </button>
        <button
          className="text-button"
          onClick={() => downloadFile(tutorial, '幕间-地图场景教程.md', 'text/markdown')}
        >
          下载地图文字教程
        </button>
      </div>
      <ol className="guide-walkthrough">
        {[
          [
            '提供剧本与范围',
            '将提示词、剧本和章节范围交给外部 AI Agent。每本可包含多张地图和多个场景，独立场景也可单独整理。',
          ],
          [
            '导入并核对',
            '保存 AI 输出的 Markdown 或 JSON，点击“导入地图集”。核对公开描述，将线索、秘密与检定条件留在主持人笔记。',
          ],
          [
            '带入房间，逐幕公布',
            '保存后将地图册作为独立副本带入房间。在桌边“地图与场景”中搜索和选择场景，点击“公布此场景”只发布公开描述。',
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
      <p className="subtle-note">
        地图记录布局与路线描述。每册最多 50 张地图、300 个场景；个人库与房间库各最多 50 本、8 MiB。
      </p>
      <div className="prompt-disclosure">
        <button className="text-button" onClick={() => setShow(!show)} aria-expanded={show}>
          查看与手动复制地图提示词
        </button>
        <button
          className="text-button"
          onClick={() =>
            downloadFile(ATLAS_EXTRACTION_PROMPT, '幕间-地图提取提示词.md', 'text/markdown')
          }
        >
          下载地图提示词
        </button>
      </div>
      {show && (
        <textarea
          aria-label="地图 LLM 提取提示词"
          readOnly
          value={ATLAS_EXTRACTION_PROMPT}
          rows={14}
          onFocus={(e) => e.target.select()}
        />
      )}
    </section>
  );
}
