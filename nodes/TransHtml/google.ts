import { NodeOperationError } from "n8n-workflow";
import type { IHttpRequestOptions, INode } from "n8n-workflow";

export type HttpRequest = (options: IHttpRequestOptions) => Promise<unknown>;

export async function translateTexts(
  request: HttpRequest,
  node: INode,
  texts: string[],
  source: string,
  target: string,
): Promise<string[]> {
  const body = new URLSearchParams();
  for (const text of texts) body.append("q", text);
  const response = await request({
    method: "POST",
    url: "https://translate.googleapis.com/translate_a/t",
    qs: { client: "dict-chrome-ex", sl: source, tl: target },
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    encoding: "text",
    timeout: 20000,
  });
  let data: unknown;
  try {
    data = typeof response === "string" ? JSON.parse(response) : response;
  } catch {
    throw new NodeOperationError(node, "Google returned invalid JSON");
  }
  if (!Array.isArray(data) || data.length !== texts.length) {
    throw new NodeOperationError(
      node,
      "Google returned an unexpected translation count",
    );
  }
  const results: unknown[] = data.map((entry: unknown) =>
    source === "auto" && Array.isArray(entry) ? entry[0] : entry,
  );
  if (results.some((result) => typeof result !== "string" || !result.trim())) {
    throw new NodeOperationError(
      node,
      "Google returned an invalid translation",
    );
  }
  return results as string[];
}
