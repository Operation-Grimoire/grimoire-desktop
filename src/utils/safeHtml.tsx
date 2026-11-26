import React from "react";

/**
 * Safely renders Grimoire's constrained inline HTML subset (<i>, <em>, <b>, <strong>, <u>,
 * <s>, <del>, <sub>, <sup>, <br>, <code>, <a href="https://...">) into React elements without
 * using dangerouslySetInnerHTML.
 */
const KNOWN_TAG =
  /<\/?(?:br|p|div|span|i|em|b|strong|u|s|del|strike|sub|sup|code|blockquote|a)(?:\s[^<>]*)?\/?>/i;

/** True when the text carries markup we render; plain text with stray "<" or "&" is left alone. */
export function looksLikeHtml(text: string): boolean {
  return KNOWN_TAG.test(text);
}

/** Renders markup when present, otherwise returns the text verbatim. */
export function renderRichText(text: string): React.ReactNode {
  return looksLikeHtml(text) ? renderSafeHtml(text) : text;
}

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
