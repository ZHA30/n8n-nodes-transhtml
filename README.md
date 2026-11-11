# n8n-nodes-transhtml

Translate visible HTML text with Google Translate in a single n8n node.

> [!NOTE]
> No credentials are required; the consumer translation endpoint has no guaranteed availability.

## Features

- **HTML**: Translate text content while retaining attributes and skipping code, hidden elements, and existing translations.
- **Bilingual**: Append translations as `<br><span class="translated">…</span>` while retaining the original text.
- **Batch processing**: Group input items by language, deduplicate text, and translate in bounded batches.

## References

- [n8n community nodes](https://docs.n8n.io/integrations/community-nodes/installation/)
- [Lucide](https://lucide.dev/icons/languages)
