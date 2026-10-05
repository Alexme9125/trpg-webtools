/** Parse one complete JSON document, optionally fenced in Markdown. Never evaluate code. */
export function parsePortable(text: string, maxBytes: number): unknown {
  if (new TextEncoder().encode(text).byteLength > maxBytes)
    throw new Error('文件过大，请分批导入。');
  const input = text.replace(/^\uFEFF/, '').trim();
  const blocks = [...input.matchAll(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm)];
  if (blocks.length > 1) throw new Error('请保留一个完整的 JSON 数据块后再导入。');
  try {
    return JSON.parse(blocks.length === 1 ? blocks[0][1] : input, (key, value: unknown) => {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('不允许的键名');
      return value;
    });
  } catch {
    throw new Error('文件不是有效的 JSON 或 Markdown 数据块，请检查格式和键名。');
  }
}
export function portableMarkdown(title: string, data: unknown, note = '', indent = 2) {
  // JSON escapes embedded newlines, so code fences in string values cannot close this block.
  const json = JSON.stringify(data, null, indent);
  return `# ${title.replace(/[\r\n`#]/g, ' ')}\n\n${note}\n\n\`\`\`json\n${json}\n\`\`\`\n`;
}
