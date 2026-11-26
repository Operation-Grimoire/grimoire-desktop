import React from "react";

/**
 * Inline and one-letter tags only count as markup with no attributes or with name=value
 * attributes. Their names are also English words, so "<I am a cat>" or "<a song of ice and
 * fire>" stays text.
 */
const STRICT_TAGS =
  "br|p|i|em|b|strong|u|s|del|strike|sub|sup|code|a|q|small|big|mark|cite|abbr|ins|font|img";
/** Structural tags may also carry bare lowercase attributes, such as <div hidden>. */
const LOOSE_TAGS =
  "div|span|blockquote|hr|h[1-6]|ul|ol|li|center|table|thead|tbody|tr|td|th|pre|section|" +
  "article|header|footer|figure|figcaption|dl|dt|dd";

/**
 * Case-insensitive tag names, keeping the rest of the pattern case-sensitive. One-letter names
 * stay lowercase: "Rank <S>", "Class <B>" or "<A>-grade" in a synopsis are grades, not markup.
 */
const anyCase = (names: string) =>
  names
    .split("|")
    .map((name) => (name.length === 1 ? name : name.replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`)))
    .join("|");

const VALUE_ATTRIBUTE = String.raw`[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>=` + "`" + String.raw`]+)`;
const BARE_ATTRIBUTE = "[a-z][a-z0-9:-]*";
const tagPattern = (names: string, attribute: string) =>
  String.raw`\/?(?:${anyCase(names)})(?:\s+(?:${attribute}))*\s*\/?>`;

const ANY_TAG =
  `(?:${tagPattern(STRICT_TAGS, VALUE_ATTRIBUTE)}|` +
  `${tagPattern(LOOSE_TAGS, `${VALUE_ATTRIBUTE}|${BARE_ATTRIBUTE}`)})`;
const KNOWN_TAG = new RegExp(`<${ANY_TAG}`);
const STRAY_OPEN = new RegExp(`<(?!${ANY_TAG}|!--)`, "g");

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
 * Block-like tags (lists, headings, <hr>, table rows) become line-separated blocks; any other
 * tag is unwrapped to its children.
 */
export function renderSafeHtml(html: string): React.ReactNode {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return html;
  return convertChildren(root, "r");
}

/** Elements rendered as their own block below; see convertNode. */
const BLOCK_TAGS = new Set([
  "p", "div", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "center", "pre",
  "section", "article", "tr", "hr", "blockquote", "table", "tbody", "thead", "dl", "dt", "dd",
]);

const isBlock = (node: ChildNode | null) =>
  node?.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((node as Element).tagName.toLowerCase());

/**
 * Source formatting between blocks ("</p>
<p>", list indentation) is dropped: under
 * white-space: pre-line it would add a blank line on top of the block spacing.
 */
function convertChildren(parent: Element, key: string): React.ReactNode[] {
  return Array.from(parent.childNodes).map((child, idx) => {
    if (child.nodeType === Node.TEXT_NODE) {
      let text = child.textContent ?? "";
      if (isBlock(child.previousSibling)) text = text.replace(/^\s+/, "");
      if (isBlock(child.nextSibling)) text = text.replace(/\s+$/, "");
      return text || null;
    }
    return convertNode(child, `${key}-${idx}`);
  });
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
  const children = convertChildren(el, key);

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
    case "li":
    case "ul":
    case "ol":
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
    case "center":
    case "pre":
    case "section":
    case "article":
    case "tr":
    case "dl":
    case "dt":
    case "dd":
      return (
        <span key={key} className="mb-2 block last:mb-0">
          {children}
        </span>
      );
    case "span":
      return <React.Fragment key={key}>{children}</React.Fragment>;
    // Cells keep their row on one line, separated like "Author · Tianyun".
    case "td":
    case "th": {
      const next = el.nextElementSibling?.tagName.toLowerCase();
      return (
        <React.Fragment key={key}>
          {children}
          {next === "td" || next === "th" ? " · " : null}
        </React.Fragment>
      );
    }
    case "hr":
      return <span key={key} className="my-2 block border-t border-current opacity-20" />;
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
