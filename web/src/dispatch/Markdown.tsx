// Chat message text as markdown (#915), drawn as React elements from lib/markdown.ts. Quiet: the panel's 13px text,
// bold stays at the body weight step, lists are tight. No HTML is ever built from the message.
import { parseMarkdown, type Inline } from './lib/markdown.ts';

function Run({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) => {
        switch (p.t) {
          case 'bold': return <strong key={i} className="font-semibold">{p.text}</strong>;
          case 'italic': return <em key={i}>{p.text}</em>;
          case 'code': return <code key={i} className="rounded bg-muted px-1 py-px font-mono text-[0.92em]">{p.text}</code>;
          case 'link': return <a key={i} href={p.href} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">{p.text}</a>;
          default: return p.text;
        }
      })}
    </>
  );
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="chat-md flex min-w-0 flex-col gap-2 [overflow-wrap:anywhere]">
      {parseMarkdown(text).map((b, i) => {
        switch (b.t) {
          case 'h': return <p key={i} className="font-semibold"><Run parts={b.inline} /></p>;
          case 'ul':
          case 'ol': {
            const List = b.t;
            return (
              <List key={i} className={`flex flex-col gap-1 pl-5 ${b.t === 'ul' ? 'list-disc' : 'list-decimal'}`}>
                {b.items.map((it, j) => <li key={j}><Run parts={it} /></li>)}
              </List>
            );
          }
          case 'code': return <pre key={i} className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-2xs leading-5 whitespace-pre">{b.text}</pre>;
          default: return <p key={i} className="whitespace-pre-wrap"><Run parts={b.inline} /></p>;
        }
      })}
    </div>
  );
}
