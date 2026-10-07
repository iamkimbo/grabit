// =============================================================
// exporters/markdown.js
// Converts a scraped conversation to a Markdown (.md) document
// and triggers a browser file download.
//
// Output format: YAML frontmatter block, then each message as a
// labelled section separated by horizontal rules. AI content is
// already Markdown (produced by the scraper's elementToMarkdown).
// User content is treated as plain text wrapped in paragraphs.
//
// Depends on: utils/export-utils.js (loaded before this file)
// =============================================================

'use strict';

// Converts a conversation data object to a Markdown file and downloads it.
// data: { messages, title, platform, exportedAt, messageCount } OR { isMerge, conversations, exportedAt }
// options: { isPremium, filename?, meta? }
// Returns void
function exportToMarkdown(data, options) {
  const content = buildMarkdownDoc(data, options);
  const filename = (options && options.filename)
    ? options.filename + '.md'
    : data.isMerge
      ? 'merged-conversations-' + new Date().toISOString().slice(0, 10) + '.md'
      : buildFilename(data, 'md');
  triggerDownload(content, filename, 'text/markdown');
}

// Builds the complete Markdown document string from conversation data.
// Returns a string
function buildMarkdownDoc(data, options) {
  if (data.isMerge) return _buildMergedMarkdownDoc(data, options);
  const { messages, title, platform, exportedAt } = data;
  const meta         = options && options.meta;
  const dateDisplay  = formatDateDisplay(exportedAt);
  const platformLabel  = getPlatformLabel(platform);
  const assistantLabel = getAssistantLabel(platform);

  const lines = [];

  // --- YAML frontmatter (with optional user-supplied metadata fields) ---
  lines.push('---');
  lines.push(`title: ${title || 'Conversation'}`);
  lines.push(`platform: ${platformLabel}`);
  if (meta && meta.author) lines.push(`author: ${meta.author}`);
  if (meta && meta.tags)   lines.push(`tags: ${meta.tags}`);
  if (meta && meta.notes)  lines.push(`notes: ${meta.notes}`);
  lines.push(`exported: ${exportedAt || new Date().toISOString()}`);
  lines.push(`messages: ${messages.length}`);
  lines.push('---');
  lines.push('');

  // --- Document header ---
  lines.push(`# ${title || 'Conversation'}`);
  lines.push('');
  lines.push(`*Exported from ${platformLabel} on ${dateDisplay}*`);
  lines.push('');

  // --- Messages ---
  messages.forEach((msg, i) => {
    lines.push('---');
    lines.push('');

    const label = msg.role === 'user' ? 'You' : assistantLabel;
    lines.push(`### ${label}`);
    lines.push('');

    // AI content is already markdown; user content is plain text.
    // Both are stored in msg.content by the scraper.
    lines.push(msg.content || '');
    lines.push('');
  });

  // Close with a final rule
  lines.push('---');
  lines.push('');

  return lines.join('\n');
}

// Builds a merged Markdown document from multiple conversations.
// data: { isMerge: true, conversations: Array<{ title, platform, messages }>, exportedAt }
// Returns a string
function _buildMergedMarkdownDoc(data, options) {
  const { conversations, exportedAt } = data;
  const meta        = options && options.meta;
  const dateDisplay = formatDateDisplay(exportedAt);
  const lines = [];

  lines.push('---');
  lines.push('title: Merged Conversations');
  lines.push(`conversations: ${conversations.length}`);
  if (meta && meta.author) lines.push(`author: ${meta.author}`);
  if (meta && meta.tags)   lines.push(`tags: ${meta.tags}`);
  if (meta && meta.notes)  lines.push(`notes: ${meta.notes}`);
  lines.push(`exported: ${exportedAt || new Date().toISOString()}`);
  lines.push('---');
  lines.push('');
  lines.push('# Merged Conversations');
  lines.push('');
  lines.push(`*${conversations.length} conversations merged on ${dateDisplay}*`);
  lines.push('');

  conversations.forEach((conv, i) => {
    if (i > 0) lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(`## ${conv.title || 'Conversation'}`);
    lines.push('');
    lines.push(`*${getPlatformLabel(conv.platform)}*`);
    lines.push('');

    const assistantLabel = getAssistantLabel(conv.platform);
    conv.messages.forEach(msg => {
      lines.push('---');
      lines.push('');
      const label = msg.role === 'user' ? 'You' : assistantLabel;
      lines.push(`### ${label}`);
      lines.push('');
      lines.push(msg.content || '');
      lines.push('');
    });
  });

  lines.push('---');
  lines.push('');

  return lines.join('\n');
}
