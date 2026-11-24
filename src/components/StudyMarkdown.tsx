import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { CodeBlock } from "@/components/MarkdownMessage";

/**
 * Reading-typography markdown for Notes Reader topic pages — larger,
 * calmer styling than the chat bubbles' MarkdownMessage, sharing the
 * same fenced-code rendering (syntax colours + copy button).
 */
const StudyMarkdown = ({ content }: { content: string }) => {
  if (!content) return null;
  return (
    <div className="text-[15px] leading-[1.85] text-foreground/90">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code({ className, children, ...props }: any) {
            return (
              <code className="bg-muted px-1.5 py-0.5 rounded text-[13px] font-mono text-accent-foreground" {...props}>
                {children}
              </code>
            );
          },
          pre({ children }: any) {
            const child = Array.isArray(children) ? children[0] : children;
            const raw = child?.props?.children;
            if (raw === undefined) return <pre>{children}</pre>;
            const className = child?.props?.className;
            const code = String(Array.isArray(raw) ? raw.join("") : raw ?? "").replace(/\n$/, "");
            return <CodeBlock language={className} code={code} />;
          },
          p({ children }) { return <p className="mb-4 last:mb-0">{children}</p>; },
          ul({ children }) { return <ul className="list-disc pl-5 mb-4 space-y-1.5">{children}</ul>; },
          ol({ children }) { return <ol className="list-decimal pl-5 mb-4 space-y-1.5">{children}</ol>; },
          h1({ children }) { return <h1 className="font-display text-2xl font-bold text-foreground mt-8 mb-3 first:mt-0">{children}</h1>; },
          h2({ children }) { return <h2 className="font-display text-xl font-bold text-foreground mt-8 mb-3 first:mt-0">{children}</h2>; },
          h3({ children }) { return <h3 className="font-display text-base font-semibold text-foreground mt-6 mb-2">{children}</h3>; },
          strong({ children }) { return <strong className="font-semibold text-foreground">{children}</strong>; },
          em({ children }) { return <em className="text-muted-foreground">{children}</em>; },
          a({ children, href }) {
            return (
              <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 hover:text-primary/80">
                {children}
              </a>
            );
          },
          blockquote({ children }) {
            return <blockquote className="border-l-2 border-primary/40 pl-4 my-4 text-muted-foreground">{children}</blockquote>;
          },
          table({ children }) {
            return (
              <div className="overflow-x-auto my-4">
                <table className="min-w-full text-sm border border-border rounded-lg overflow-hidden">{children}</table>
              </div>
            );
          },
          th({ children }) { return <th className="border border-border px-3 py-2 bg-muted font-semibold text-left">{children}</th>; },
          td({ children }) { return <td className="border border-border px-3 py-2">{children}</td>; },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default StudyMarkdown;
