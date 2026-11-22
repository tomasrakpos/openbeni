// chat feature: Markdown; change its UI/flow here and keep related state/API calls in sync.
import * as React from "react";
import "katex/dist/katex.min.css";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { CodeBlock } from "@/features/chat/CodeBlock";
import { cn } from "@/lib/utils";

const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), "className"],
    span: [...(defaultSchema.attributes?.span ?? []), "className", "style"],
    div: [...(defaultSchema.attributes?.div ?? []), "className", "style"],
    a: [...(defaultSchema.attributes?.a ?? []), "target", "rel"],
    input: ["type", "checked", "disabled"],
  },
  tagNames: [...(defaultSchema.tagNames ?? []), "details", "summary", "kbd", "mark", "sub", "sup"],
};

function extractText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return extractText(node.props.children);
  return "";
}

export const Markdown = React.memo(function Markdown({
  content,
  className,
  streaming,
}: {
  content: string;
  className?: string;
  streaming?: boolean;
}) {
  return (
    <div className={cn("prose-chat", className)} dir="auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeSanitize, schema], rehypeKatex]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className: codeClassName, children }) => {
            const text = extractText(children).replace(/\n$/, "");
            const language = /language-([\w+-]+)/.exec(codeClassName ?? "")?.[1];
            const isBlock = Boolean(language) || (typeof children === "string" && children.includes("\n"));
            if (!isBlock) {
              return (
                <code className="rounded-[5px] border border-[var(--border)] bg-[var(--surface-2)] px-1 py-0.5 font-mono text-[0.85em] text-foreground">
                  {children}
                </code>
              );
            }
            const firstLine = text.split("\n")[0] ?? "";
            const filenameMatch =
              /^\s*(?:\/\/|#|<!--)\s*(?:file(?:name)?\s*[:=]\s*)?([\w./@-]+\.[a-z0-9]{1,8})\s*(?:-->)?\s*$/i.exec(firstLine);
            return (
              <CodeBlock
                code={text}
                language={language ?? "text"}
                filename={filenameMatch?.[1]}
              />
            );
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener nofollow">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto rounded-[12px] border border-[var(--border)]">
              <table className="!my-0 !border-0">{children}</table>
            </div>
          ),
          img: ({ src, alt }) => (
            <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} loading="lazy" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
      {streaming && <span className="stream-caret" aria-hidden />}
    </div>
  );
});
