import { parseDocument } from "htmlparser2";
import { Element, Text, isTag, type AnyNode } from "domhandler";
import { append, appendChild } from "domutils";
import serialize from "dom-serializer";
import { preserveWhitespace } from "./batching";

export interface TranslationUnit {
  text: string;
  apply: (translation: string) => void;
}

export interface CompiledHtml {
  units: TranslationUnit[];
  render: () => string;
}

const blocks = new Set([
  "p",
  "div",
  "li",
  "dt",
  "dd",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "td",
  "th",
  "figcaption",
  "section",
  "article",
  "address",
  "summary",
  "header",
  "footer",
  "main",
  "aside",
  "nav",
  "ul",
  "ol",
  "dl",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "figure",
  "details",
  "form",
  "fieldset",
  "hr",
]);
const skippedTags = new Set([
  "head",
  "title",
  "script",
  "style",
  "noscript",
  "template",
  "pre",
  "code",
  "kbd",
  "samp",
  "svg",
  "math",
  "textarea",
  "button",
  "input",
  "select",
  "option",
  "iframe",
  "video",
  "audio",
  "canvas",
]);

function translated(node: AnyNode | null): boolean {
  return (
    !!node &&
    isTag(node) &&
    /(?:^|\s)translated(?:\s|$)/u.test(node.attribs.class ?? "")
  );
}

function skipped(node: AnyNode): boolean {
  if (!isTag(node)) return false;
  const attrs = node.attribs;
  return (
    skippedTags.has(node.name) ||
    translated(node) ||
    attrs.translate?.toLowerCase() === "no" ||
    "hidden" in attrs ||
    attrs["aria-hidden"]?.toLowerCase() === "true" ||
    /(?:^|\s)notranslate(?:\s|$)/u.test(attrs.class ?? "") ||
    /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))\s*(?:!important\s*)?(?:;|$)/iu.test(
      attrs.style ?? "",
    )
  );
}

function prepared(text: string): string {
  return text
    .replace(/[\u200B\uFEFF]/gu, "")
    .replace(/\r\n?/gu, "\n")
    .trim();
}

function comparable(text: string): string {
  return prepared(text).normalize("NFKC").replace(/\s+/gu, " ").toLowerCase();
}

function needsTranslation(text: string): boolean {
  return (
    /\p{L}/u.test(text) &&
    !/^(?:https?:\/\/\S+|\S+@\S+\.\S+|@\S+)$/iu.test(text)
  );
}

function nextContent(node: AnyNode): AnyNode | null {
  let next = node.next;
  while (next?.type === "text" && !next.data.trim()) next = next.next;
  return next;
}

function hasTranslationAfter(node: AnyNode): boolean {
  const next = nextContent(node);
  return (
    translated(next) ||
    (!!next &&
      isTag(next) &&
      next.name === "br" &&
      translated(nextContent(next)))
  );
}

function boundary(node: AnyNode): boolean {
  if (skipped(node)) return true;
  if (isTag(node) && (node.name === "br" || blocks.has(node.name))) return true;
  return "children" in node && node.children.some(boundary);
}

function visibleText(node: AnyNode): string {
  if (skipped(node)) return "";
  if (node.type === "text") return node.data;
  return "children" in node ? node.children.map(visibleText).join("") : "";
}

export function compileHtml(html: string, bilingual: boolean): CompiledHtml {
  const root = parseDocument(html);
  const units: TranslationUnit[] = [];
  let changed = false;

  function add(source: string, write: (value: string) => void): void {
    const text = prepared(source);
    if (!needsTranslation(text)) return;
    units.push({
      text,
      apply(value) {
        if (comparable(value) === comparable(text)) return;
        write(value);
        changed = true;
      },
    });
  }

  function bilingualRun(nodes: AnyNode[]): void {
    if (!nodes.length) return;
    const last = nodes[nodes.length - 1];
    if (hasTranslationAfter(last)) return;
    add(nodes.map(visibleText).join(""), (value) => {
      const br = new Element("br", {}, []);
      const span = new Element("span", { class: "translated" }, []);
      appendChild(span, new Text(value));
      append(last, br);
      append(br, span);
    });
  }

  function walk(node: AnyNode): void {
    if (skipped(node) || hasTranslationAfter(node)) return;
    if (!bilingual && node.type === "text") {
      const source = node.data;
      add(source, (value) => {
        node.data = preserveWhitespace(source, value);
      });
      return;
    }
    if (!("children" in node)) return;
    if (!bilingual) {
      for (const child of node.children) walk(child);
      return;
    }
    let inline: AnyNode[] = [];
    const flush = () => {
      bilingualRun(inline);
      inline = [];
    };
    for (const child of node.children) {
      if (boundary(child)) {
        flush();
        walk(child);
      } else inline.push(child);
    }
    flush();
  }

  walk(root);
  return {
    units,
    render: () =>
      changed ? serialize(root, { encodeEntities: "utf8" }) : html,
  };
}
