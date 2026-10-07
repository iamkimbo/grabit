// =============================================================
// exporters/json.js
// Converts a scraped conversation to a pretty-printed JSON (.json)
// file and triggers a browser download.
//
// The output includes full metadata and the complete message array.
// contentHtml is excluded from the JSON export (it's platform-
// specific and large); only the normalized content string is kept.
//
// Depends on: utils/export-utils.js (loaded before this file)
// =============================================================

'use strict';

// Converts a conversation data object to a JSON file and downloads it.
// data: { messages, title, platform, exportedAt, messageCount } OR { isMerge, conversations, exportedAt }
// options: { isPremium, filename?, meta? }
// Returns void
function exportToJSON(data, options) {
  const doc     = buildJSONDoc(data, options);
  const content = JSON.stringify(doc, null, 2);
  const filename = (options && options.filename)
    ? options.filename + '.json'
    : data.isMerge
      ? 'merged-conversations-' + new Date().toISOString().slice(0, 10) + '.json'
      : buildFilename(data, 'json');
  triggerDownload(content, filename, 'application/json');
}

// Builds the JSON-serializable document object from conversation data.
// When options.meta is provided and has user-set fields, a top-level "metadata"
// object is inserted before the messages array.
// Strips contentHtml (DOM-specific, not useful for consumers of this format).
// Returns a plain object
function buildJSONDoc(data, options) {
  if (data.isMerge) return _buildMergedJSONDoc(data, options);
  const { messages, title, platform, exportedAt } = data;
  const meta = options && options.meta;

  // Build metadata sub-object — only include fields with values
  const metaEntry = _buildJSONMeta(meta, getPlatformLabel(platform), exportedAt);

  return {
    ...(metaEntry ? { metadata: metaEntry } : {}),
    title:        title || 'Conversation',
    platform:     getPlatformLabel(platform),
    platformKey:  platform,
    exportedAt:   exportedAt || new Date().toISOString(),
    exportedBy:   'Grabit',
    messageCount: messages.length,
    messages:     messages.map(msg => ({
      index:     msg.index,
      role:      msg.role,
      content:   msg.content,
      timestamp: msg.timestamp || null
    }))
  };
}

// Builds a merged JSON document — top-level object with a conversations array.
// Returns a plain object
function _buildMergedJSONDoc(data, options) {
  const meta      = options && options.meta;
  const metaEntry = _buildJSONMeta(meta, 'Merged', data.exportedAt);

  return {
    ...(metaEntry ? { metadata: metaEntry } : {}),
    exportedAt:        data.exportedAt || new Date().toISOString(),
    exportedBy:        'Grabit',
    conversationCount: data.conversations.length,
    conversations:     data.conversations.map(conv => ({
      title:        conv.title || 'Conversation',
      platform:     getPlatformLabel(conv.platform),
      platformKey:  conv.platform,
      messageCount: conv.messages.length,
      messages:     conv.messages.map(msg => ({
        index:     msg.index,
        role:      msg.role,
        content:   msg.content,
        timestamp: msg.timestamp || null
      }))
    }))
  };
}

// Builds the metadata sub-object for JSON output.
// Only includes user-set fields (author/tags/notes) plus exported + platform.
// Returns an object if any user field is set, null otherwise.
function _buildJSONMeta(meta, platformLabel, exportedAt) {
  if (!meta || (!meta.author && !meta.tags && !meta.notes)) return null;

  const entry = {};
  if (meta.author) entry.author = meta.author;
  if (meta.tags)   entry.tags   = meta.tags;
  if (meta.notes)  entry.notes  = meta.notes;
  entry.exported = meta.exported || exportedAt || '';
  entry.platform = platformLabel  || '';
  return entry;
}
