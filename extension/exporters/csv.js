// =============================================================
// exporters/csv.js
// Converts a scraped conversation to a CSV (.csv) file and
// triggers a browser download.
//
// Follows RFC 4180: fields containing commas, quotes, or newlines
// are wrapped in double-quotes; literal double-quotes are doubled.
// Multi-line message content is preserved inside quoted fields.
//
// Columns: index, role, platform, timestamp, content
//
// Depends on: utils/export-utils.js (loaded before this file)
// =============================================================

'use strict';

// Converts a conversation data object to a CSV file and downloads it.
// data: { messages, title, platform, exportedAt, messageCount } OR { isMerge, conversations, exportedAt }
// options: { isPremium, filename?, meta? }
// Returns void
function exportToCSV(data, options) {
  const content  = buildCSV(data, options);
  const filename = (options && options.filename)
    ? options.filename + '.csv'
    : data.isMerge
      ? 'merged-conversations-' + new Date().toISOString().slice(0, 10) + '.csv'
      : buildFilename(data, 'csv');
  // UTF-8 BOM (0xEF 0xBB 0xBF) makes Excel open the file correctly
  const bom = '﻿';
  triggerDownload(bom + content, filename, 'text/csv');
}

// Builds the full CSV string from conversation data.
// Prepends comment rows for author and tags when provided in options.meta.
// Returns a string
function buildCSV(data, options) {
  if (data.isMerge) return _buildMergedCSV(data, options);
  const { messages, platform } = data;
  const meta = options && options.meta;
  const platformLabel = getPlatformLabel(platform);

  // Comment rows for metadata (only non-empty fields)
  const commentRows = [];
  if (meta && meta.author) commentRows.push(`# Author: ${meta.author}`);
  if (meta && meta.tags)   commentRows.push(`# Tags: ${meta.tags}`);

  const headers = ['index', 'role', 'role_label', 'platform', 'timestamp', 'content'];
  const rows = [headers.map(csvField)];

  messages.forEach(msg => {
    const roleLabel = msg.role === 'user' ? 'You' : platformLabel;
    rows.push([
      csvField(String(msg.index)),
      csvField(msg.role),
      csvField(roleLabel),
      csvField(platformLabel),
      csvField(msg.timestamp || ''),
      csvField(msg.content || '')
    ]);
  });

  const dataSection = rows.map(row => row.join(',')).join('\r\n');
  return commentRows.length > 0
    ? commentRows.join('\r\n') + '\r\n' + dataSection
    : dataSection;
}

// Builds a merged CSV: conversations separated by a blank row + title row.
// Returns a string
function _buildMergedCSV(data, options) {
  const meta = options && options.meta;

  // Comment rows for metadata
  const commentRows = [];
  if (meta && meta.author) commentRows.push(`# Author: ${meta.author}`);
  if (meta && meta.tags)   commentRows.push(`# Tags: ${meta.tags}`);
  const headers = ['conversation', 'index', 'role', 'role_label', 'platform', 'timestamp', 'content'];
  const rows = [headers.map(csvField)];

  data.conversations.forEach((conv, ci) => {
    if (ci > 0) {
      // Blank separator row
      rows.push(headers.map(() => csvField('')));
    }
    // Conversation title row
    rows.push([csvField(conv.title || 'Conversation'), ...Array(headers.length - 1).fill(csvField(''))]);

    const platformLabel = getPlatformLabel(conv.platform);
    conv.messages.forEach(msg => {
      const roleLabel = msg.role === 'user' ? 'You' : platformLabel;
      rows.push([
        csvField(conv.title || 'Conversation'),
        csvField(String(msg.index)),
        csvField(msg.role),
        csvField(roleLabel),
        csvField(platformLabel),
        csvField(msg.timestamp || ''),
        csvField(msg.content || '')
      ]);
    });
  });

  const dataSection = rows.map(row => row.join(',')).join('\r\n');
  return commentRows.length > 0
    ? commentRows.join('\r\n') + '\r\n' + dataSection
    : dataSection;
}

// Wraps a field value in double-quotes and escapes internal double-quotes.
// Per RFC 4180, any field that contains commas, double-quotes, or newlines
// must be wrapped in double-quotes.
// Returns a properly escaped CSV field string
function csvField(value) {
  const str = String(value == null ? '' : value);
  // Always quote — safest approach, universally compatible
  return '"' + str.replace(/"/g, '""') + '"';
}
