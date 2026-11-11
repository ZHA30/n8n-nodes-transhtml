export function splitText(text: string, limit = 1800): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const natural = [/[.!?。！？](?:\s|$)/gu, /\n/gu, /\s/gu]
      .map((pattern) =>
        [...window.matchAll(pattern)]
          .filter((match) => match.index >= limit / 2)
          .at(-1),
      )
      .find((match) => match !== undefined);
    let end = natural ? natural.index + natural[0].length : limit;
    if (
      /[\uD800-\uDBFF]/.test(rest[end - 1]) &&
      /[\uDC00-\uDFFF]/.test(rest[end])
    ) {
      end--;
    }
    parts.push(rest.slice(0, end));
    rest = rest.slice(end);
  }
  if (rest) parts.push(rest);
  return parts;
}

export function batches(
  texts: string[],
  maxItems = 20,
  maxCharacters = 8000,
): string[][] {
  const groups: string[][] = [];
  let group: string[] = [];
  let size = 0;
  for (const text of texts) {
    if (
      group.length &&
      (group.length >= maxItems || size + text.length > maxCharacters)
    ) {
      groups.push(group);
      group = [];
      size = 0;
    }
    group.push(text);
    size += text.length;
  }
  if (group.length) groups.push(group);
  return groups;
}

export function preserveWhitespace(source: string, translated: string): string {
  return (
    /^\s*/u.exec(source)![0] + translated.trim() + /\s*$/u.exec(source)![0]
  );
}
