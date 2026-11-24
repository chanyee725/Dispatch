// Tiny markdown reader for chat messages (#915): headings, paragraphs, bullet and numbered lists, fenced code, and
// inline bold, italic, code and http(s) links. It returns data, never HTML, so nothing in a message can inject markup.
export type Inline = { t: 'text' | 'bold' | 'italic' | 'code'; text: string } | { t: 'link'; text: string; href: string };
export type Block =
  | { t: 'p'; inline: Inline[] }
  | { t: 'h'; inline: Inline[] }
  | { t: 'ul' | 'ol'; items: Inline[][] }
  | { t: 'code'; text: string };

const INLINE = /`([^`\n]+)`|\*\*([^*\n]+?)\*\*|(?<![*\w])\*([^*\n]+?)\*(?!\*)|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  for (const m of src.matchAll(INLINE)) {
    if (m.index > at) out.push({ t: 'text', text: src.slice(at, m.index) });
    if (m[1] != null) out.push({ t: 'code', text: m[1] });
    else if (m[2] != null) out.push({ t: 'bold', text: m[2] });
    else if (m[3] != null) out.push({ t: 'italic', text: m[3] });
    else out.push({ t: 'link', text: m[4]!, href: m[5]! });
    at = m.index + m[0].length;
  }
  if (at < src.length) out.push({ t: 'text', text: src.slice(at) });
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ t: 'p', inline: parseInline(para.join('\n')) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^\s*```/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]!); i++) body.push(lines[i]!);
      out.push({ t: 'code', text: body.join('\n') });
      continue;
    }
    const heading = /^#{1,6}\s+(.*\S)\s*$/.exec(line);
    if (heading) { flush(); out.push({ t: 'h', inline: parseInline(heading[1]!) }); continue; }
    const item = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      flush();
      const kind = item[1] ? 'ul' : 'ol';
      const last = out[out.length - 1];
      const list = last && last.t === kind ? last : null;
      const inline = parseInline(item[3]!);
      if (list && 'items' in list) list.items.push(inline);
      else out.push({ t: kind, items: [inline] });
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    para.push(line);
  }
  flush();
  return out;
}
