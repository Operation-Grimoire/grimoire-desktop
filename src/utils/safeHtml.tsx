import React from "react";

/**
 * Tags with a rendering below; anything else is unwrapped to its text. Attributes must be
 * name=value pairs, so a bracketed title such as "<A Will Eternal>" is not taken for a tag.
 */
const TAG_PATTERN =
  /\/?(?:br|p|div|span|i|em|b|strong|u|s|del|strike|sub|sup|code|blockquote|a)(?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>=`]+))*\s*\/?>/
    .source;
const KNOWN_TAG = new RegExp(`<${TAG_PATTERN}`, "i");
const STRAY_OPEN = new RegExp(`<(?!${TAG_PATTERN})`, "gi");

/** True when the text carries markup we render; plain text with stray "<" or "&" is left alone. */
export function looksLikeHtml(text: string): boolean {
  return KNOWN_TAG.test(text);
}

/**
 * Renders markup when present, otherwise returns the text verbatim. In marked-up text a "<"
 * that does not open a known tag, such as "Book 1 <The Beginning>", is kept as text.
 */
export function renderRichText(text: string): React.ReactNode {
  if (!looksLikeHtml(text)) return text;
  return renderSafeHtml(text.replace(STRAY_OPEN, "&lt;"));
}

/**
 * Safely renders Grimoire's constrained HTML subset (<i>, <em>, <b>, <strong>, <u>, <s>,
 * <del>, <strike>, <sub>, <sup>, <br>, <code>, <blockquote>, <p>, <div>, <span>,
 * <a href="https://...">) into React elements without using dangerouslySetInnerHTML.
 * Other tags are unwrapped to their children.
 */
export function renderSafeHtml(html: string): React.ReactNode {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return html;
  return Array.from(root.childNodes).map((node, idx) => convertNode(node, `r-${idx}`));
}

function convertNode(node: ChildNode, key: string): React.ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const children = Array.from(el.childNodes).map((child, idx) =>
    convertNode(child, `${key}-${idx}`),
  );

  switch (tag) {
    case "br":
      return <br key={key} />;
    case "i":
    case "em":
      return <em key={key}>{children}</em>;
    case "b":
    case "strong":
      return <strong key={key} className="font-semibold">{children}</strong>;
    case "u":
      return <u key={key}>{children}</u>;
    case "s":
    case "del":
    case "strike":
      return <s key={key}>{children}</s>;
    case "sub":
      return <sub key={key}>{children}</sub>;
    case "sup":
      return <sup key={key}>{children}</sup>;
    case "code":
      return (
        <code key={key} className="rounded bg-black/15 px-1 py-0.5 font-mono text-[0.9em]">
          {children}
        </code>
      );
    // Block spans, not <p>/<div>: the reader already wraps each page in a <p>.
    case "p":
    case "div":
      return (
        <span key={key} className="mb-2 block last:mb-0">
          {children}
        </span>
      );
    case "span":
      return <React.Fragment key={key}>{children}</React.Fragment>;
    case "blockquote":
      return (
        <blockquote
          key={key}
          className="my-2 border-l-2 border-[var(--accent)]/60 pl-3.5 italic opacity-90"
        >
          {children}
        </blockquote>
      );
    case "a": {
      const href = el.getAttribute("href")?.trim() ?? "";
      if (href.startsWith("https://") || href.startsWith("http://")) {
        return (
          <a key={key} href={href} target="_blank" rel="noreferrer noopener">
            {children}
          </a>
        );
      }
      return <React.Fragment key={key}>{children}</React.Fragment>;
    }
    default:
      return <React.Fragment key={key}>{children}</React.Fragment>;
  }
}
