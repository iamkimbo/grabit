// =============================================================
// exporters/plaintext.js
// Converts a scraped conversation to a plain text (.txt) document
// and triggers a browser file download.
//
// Strips all Markdown syntax from AI responses while preserving
// code block contents and paragraph structure. The output reads
// like a clean chat transcript — no symbols, no markup.
//
// Depends on: utils/export-utils.js (loaded before this file)
// =============================================================

'use strict';

// Converts a conversation data object to a plain text file and downloads it.
// data: { messages, title, platform, exportedAt, messageCount } OR { isMerge, conversations, exportedAt }
// options: { isPremium, filename?, meta? }
// Returns void
function exportToPlainText(data, options) {
  const content = buildPlainTextDoc(data, options);
  const filename = (options && options.filename)
    ? options.filename + '.txt'
    : data.isMerge
      ? 'merged-conversations-' + new Date().toISOString().slice(0, 10) + '.txt'
      : buildFilename(data, 'txt');
  triggerDownload(content, filename, 'text/plain');
}

// Builds the complete plain text document string from conversation data.
// Returns a string
function buildPlainTextDoc(data, options) {
  if (data.isMerge) return _buildMergedPlainTextDoc(data, options);
  const { messages, title, platform, exportedAt } = data;
  const meta         = options && options.meta;
  const dateDisplay  = formatDateDisplay(exportedAt);
  const platformLabel  = getPlatformLabel(platform);
  const assistantLabel = getAssistantLabel(platform);

  const separator = '─'.repeat(60);
  const metaSep   = '─'.repeat(26);
  const lines = [];

  // --- Metadata block (only when at least one user field is set) ---
  if (meta && (meta.author || meta.tags || meta.notes)) {
    if (meta.author) lines.push(`Author:   ${meta.author}`);
    if (meta.tags)   lines.push(`Tags:     ${meta.tags}`);
    if (meta.notes)  lines.push(`Notes:    ${meta.notes}`);
    lines.push(`Exported: ${meta.exported}`);
    lines.push(metaSep);
    lines.push('');
  }

  // --- Header ---
  lines.push(title || 'Conversation');
  lines.push(separator);
  lines.push(`Exported from ${platformLabel}  ·  ${dateDisplay}`);
  lines.push(`${messages.length} messages`);
  lines.push('');

  // --- Messages ---
  messages.forEach((msg) => {
    lines.push(separator);
    lines.push('');

    const label = msg.role === 'user' ? 'You' : assistantLabel;
    lines.push(label.toUpperCase());
    lines.push('');

    const plainContent = msg.role === 'user'
      ? (msg.content || '').trim()
      : stripMarkdown(msg.content || '');

    lines.push(plainContent);
    lines.push('');
  });

  lines.push(separator);

  return lines.join('\n');
}

// Builds a merged plain text document from multiple conversations.
// data: { isMerge: true, conversations: Array<{ title, platform, messages }>, exportedAt }
// Returns a string
function _buildMergedPlainTextDoc(data, options) {
  const { conversations, exportedAt } = data;
  const meta       = options && options.meta;
  const separator  = '─'.repeat(60);
  const dblSep     = '═'.repeat(60);
  const metaSep    = '─'.repeat(26);
  const lines      = [];

  // --- Metadata block ---
  if (meta && (meta.author || meta.tags || meta.notes)) {
    if (meta.author) lines.push(`Author:   ${meta.author}`);
    if (meta.tags)   lines.push(`Tags:     ${meta.tags}`);
    if (meta.notes)  lines.push(`Notes:    ${meta.notes}`);
    lines.push(`Exported: ${meta.exported}`);
    lines.push(metaSep);
    lines.push('');
  }

  lines.push('Merged Conversations');
  lines.push(dblSep);
  lines.push(`${conversations.length} conversations  ·  ${formatDateDisplay(exportedAt)}`);
  lines.push('');

  conversations.forEach((conv, i) => {
    if (i > 0) lines.push('');
    lines.push(dblSep);
    lines.push(conv.title || 'Conversation');
    lines.push(getPlatformLabel(conv.platform));
    lines.push(dblSep);
    lines.push('');

    const assistantLabel = getAssistantLabel(conv.platform);
    conv.messages.forEach(msg => {
      lines.push(separator);
      lines.push('');
      const label = msg.role === 'user' ? 'You' : assistantLabel;
      lines.push(label.toUpperCase());
      lines.push('');
      const plainContent = msg.role === 'user'
        ? (msg.content || '').trim()
        : stripMarkdown(msg.content || '');
      lines.push(plainContent);
      lines.push('');
    });
  });

  lines.push(dblSep);
  return lines.join('\n');
}

// Removes Markdown syntax from a string, preserving the readable text content.
// Handles code fences, inline code, bold, italic, headings, links, and lists.
// Returns a clean plain text string
function stripMarkdown(md) {
  if (!md) return '';

  return md
    // Fenced code blocks — preserve the content, drop the fences
    .replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code) => {
      return code.trimEnd();
    })
    // Inline code — keep the text, drop the backticks
    .replace(/`([^`]+)`/g, '$1')
    // Bold + italic combined (***text***)
    .replace(/\*{3}(.+?)\*{3}/g, '$1')
    // Bold (**text** or __text__)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    // Italic (*text* or _text_)
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    // Strikethrough
    .replace(/~~(.+?)~~/g, '$1')
    // Headings — keep the text, drop the # prefix
    .replace(/^#{1,6}\s+(.*)$/gm, '$1')
    // Markdown links — keep the label, drop the URL
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Markdown images — keep alt text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // Blockquote markers
    .replace(/^>\s*/gm, '')
    // Horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '──────────────────────────────')
    // List markers (preserve indentation structure as dashes)
    .replace(/^(\s*)[*+-]\s+/gm, '$1- ')
    .replace(/^(\s*)\d+\.\s+/gm, '$1')
    // Collapse 3+ blank lines to 2
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
