import {
  NodeApiError,
  NodeConnectionTypes,
  NodeOperationError,
} from "n8n-workflow";
import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  JsonObject,
} from "n8n-workflow";
import { batches, preserveWhitespace, splitText } from "./batching";
import { compileHtml, type CompiledHtml } from "./html";
import { translateTexts } from "./google";
import { languages } from "./languages";

interface DocumentTask {
  index: number;
  compiled: CompiledHtml;
  parts: Map<string, string[]>;
  error?: NodeApiError | NodeOperationError;
}

interface LanguageGroup {
  source: string;
  target: string;
  tasks: DocumentTask[];
}

export class TransHtml implements INodeType {
  description: INodeTypeDescription = {
    displayName: "TransHTML",
    name: "transHtml",
    icon: { light: "file:html.svg", dark: "file:html.dark.svg" },
    group: ["transform"],
    version: 1,
    subtitle: "={{$parameter.targetLanguage}}",
    usableAsTool: true,
    description: "Translate visible HTML text with Google Translate",
    defaults: { name: "TransHTML" },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    properties: [
      {
        displayName: "HTML",
        name: "html",
        type: "string",
        typeOptions: { rows: 6 },
        default: "",
        required: true,
        placeholder: "<p>Hello world.</p>",
      },
      {
        displayName: "Target Language",
        name: "targetLanguage",
        type: "options",
        options: [{ name: "Select a Language", value: "" }, ...languages],
        default: "",
        required: true,
      },
      {
        displayName: "Source Language",
        name: "sourceLanguage",
        type: "options",
        options: [{ name: "Auto-Detect", value: "auto" }, ...languages],
        default: "auto",
      },
      {
        displayName: "Bilingual",
        name: "bilingual",
        type: "boolean",
        default: false,
        description:
          "Whether to keep the original text and append a translation",
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const output: INodeExecutionData[] = new Array(items.length);
    const groups = new Map<string, LanguageGroup>();
    const node = this.getNode();

    const fail = (index: number, error: NodeApiError | NodeOperationError) => {
      if (!this.continueOnFail()) throw error;
      output[index] = {
        json: { error: error.message },
        error,
        pairedItem: { item: index },
      };
    };

    for (let index = 0; index < items.length; index++) {
      try {
        const html = this.getNodeParameter("html", index);
        const target = this.getNodeParameter("targetLanguage", index) as string;
        const source = this.getNodeParameter("sourceLanguage", index) as string;
        const bilingual = this.getNodeParameter("bilingual", index) as boolean;
        if (typeof html !== "string") {
          throw new NodeOperationError(node, "HTML must be a string", {
            itemIndex: index,
          });
        }
        if (!target.trim()) {
          throw new NodeOperationError(node, "Select a target language", {
            itemIndex: index,
          });
        }
        const compiled = compileHtml(html, bilingual);
        if (!compiled.units.length) {
          output[index] = { json: { html }, pairedItem: { item: index } };
          continue;
        }
        const task: DocumentTask = {
          index,
          compiled,
          parts: new Map(
            compiled.units.map((unit) => [unit.text, splitText(unit.text)]),
          ),
        };
        const key = JSON.stringify([source, target]);
        let group = groups.get(key);
        if (!group) {
          group = { source, target, tasks: [] };
          groups.set(key, group);
        }
        group.tasks.push(task);
      } catch (error) {
        fail(
          index,
          error instanceof NodeOperationError
            ? error
            : new NodeOperationError(node, error as Error, {
                itemIndex: index,
              }),
        );
      }
    }

    for (const group of groups.values()) {
      const texts = [
        ...new Set(
          group.tasks.flatMap((task) =>
            [...task.parts.values()]
              .flat()
              .map((part) => part.trim())
              .filter(Boolean),
          ),
        ),
      ];
      const values = new Map<string, string>();
      for (const batch of batches(texts)) {
        const requested = new Set(batch);
        const affected = group.tasks.filter((task) =>
          [...task.parts.values()].some((parts) =>
            parts.some((part) => requested.has(part.trim())),
          ),
        );
        try {
          const translations = await translateTexts(
            (options) => this.helpers.httpRequest(options),
            node,
            batch,
            group.source,
            group.target,
          );
          batch.forEach((text, index) => values.set(text, translations[index]));
        } catch (error) {
          for (const task of affected) {
            const failure =
              error instanceof NodeOperationError
                ? new NodeOperationError(node, error.message, {
                    itemIndex: task.index,
                  })
                : new NodeApiError(node, error as JsonObject, {
                    itemIndex: task.index,
                  });
            task.error ??= failure;
            fail(task.index, task.error);
          }
        }
      }
      for (const task of group.tasks) {
        if (task.error) continue;
        try {
          for (const unit of task.compiled.units) {
            const translation = task.parts
              .get(unit.text)!
              .map((part) =>
                part.trim()
                  ? preserveWhitespace(part, values.get(part.trim())!)
                  : part,
              )
              .join("");
            unit.apply(translation);
          }
          output[task.index] = {
            json: { html: task.compiled.render() },
            pairedItem: { item: task.index },
          };
        } catch (error) {
          fail(
            task.index,
            new NodeOperationError(node, error as Error, {
              itemIndex: task.index,
            }),
          );
        }
      }
    }
    return [output];
  }
}
