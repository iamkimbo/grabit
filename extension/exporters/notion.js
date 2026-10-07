// =============================================================
// exporters/notion.js
// Notion integration: OAuth connect/disconnect, target-page
// management, and conversation export via the Notion API.
// Premium-only. Called from popup.js (export) and settings.js
// (connect/disconnect/page setup).
//
// Depends on (loaded before this file in popup context):
//   utils/storage.js      — storageGet / storageSet
//   utils/export-utils.js — getPlatformLabel / getAssistantLabel /
//                           formatDateDisplay
// In the settings context only auth/page functions are called;
// export-utils.js is not required there.
// =============================================================

'use strict';

// ---------------------------------------------------------------------------
// Notion credentials (replace before publishing)
// ---------------------------------------------------------------------------

// ===== NOTION CONFIG =====
// Replace this value before publishing:
// Your Notion OAuth integration's client ID
const NOTION_CLIENT_ID = 'YOUR_NOTION_CLIENT_ID';
// ================================

// ===== NOTION CONFIG =====
// Replace this value before publishing:
// Your Notion OAuth integration's client secret
const NOTION_CLIENT_SECRET = 'YOUR_NOTION_CLIENT_SECRET';
// ================================

// ---------------------------------------------------------------------------
// API constants
// ---------------------------------------------------------------------------

const _N_API     = 'https://api.notion.com/v1';
const _N_VERSION = '2022-06-28';
const _N_BATCH   = 100;   // max blocks per API request

// ---------------------------------------------------------------------------
// Public — Export
// ---------------------------------------------------------------------------

// Main export entry point called from popup.js after premium + pre-flight checks.
// options.meta is passed to the block builders to prepend an author/tags/notes block.
// Returns Promise<{ pageUrl: string }>.
// Throws on Notion API errors.
async function notionExportConversation(data, options = {}) {
  const s      = await storageGet(['notionAccessToken', 'notionPageId']);
  const meta   = options.meta || null;
  const blocks = data.isMerge ? _buildMergedBlocks(data, meta) : _buildBlocks(data, meta);
  const title  = data.isMerge ? 'Merged Conversations' : (data.title || 'Conversation');
  return _createPage(s.notionAccessToken, s.notionPageId, title, blocks);
}

// ---------------------------------------------------------------------------
// Public — Auth
// ---------------------------------------------------------------------------

// Opens the Notion OAuth consent screen via chrome.identity.launchWebAuthFlow.
// Exchanges the auth code for an access token and stores it.
// Returns { workspaceName: string }.
// Throws if the user cancels or the exchange fails.
async function notionConnect() {
  const redirectUrl = chrome.identity.getRedirectURL();

  const authUrl =
    'https://api.notion.com/v1/oauth/authorize' +
    '?client_id='    + encodeURIComponent(NOTION_CLIENT_ID) +
    '&response_type=code' +
    '&owner=user' +
    '&redirect_uri=' + encodeURIComponent(redirectUrl);

  const redirected = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, url => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(url);
      }
    });
  });

  const code = new URL(redirected).searchParams.get('code');
  if (!code) throw new Error('Authorization cancelled — no code received.');

  return _exchangeToken(code, redirectUrl);
}

// Clears all stored Notion credentials and page configuration.
async function notionDisconnect() {
  await storageSet({
    notionAccessToken:   null,
    notionWorkspaceName: null,
    notionPageId:        null,
    notionPageTitle:     null,
  });
}

// ---------------------------------------------------------------------------
// Public — Page management
// ---------------------------------------------------------------------------

// Parses a Notion page URL or raw ID, verifies access via the API,
// caches the page title, and stores the page ID.
// Returns { success: bool, title?: string, error?: string }.
async function notionSavePage(input) {
  const s = await storageGet(['notionAccessToken']);
  if (!s.notionAccessToken) {
    return { success: false, error: 'Not connected to Notion.' };
  }

  const pageId = _parsePageId(input.trim());
  if (!pageId) {
    return { success: false, error: 'Could not read a page ID from that input.' };
  }

  try {
    const page  = await _fetchPage(s.notionAccessToken, pageId);
    const title = _extractTitle(page);
    await storageSet({ notionPageId: pageId, notionPageTitle: title });
    return { success: true, title };
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
      return {
        success: false,
        error:   'Page not found. Share it with your integration first: in Notion open the page → ··· menu → Connections → your integration.',
      };
    }
    return { success: false, error: msg || 'Could not verify that page.' };
  }
}

// Returns current Notion connection state from storage (no API calls).
// Returns { connected, workspaceName, pageId, pageTitle }
async function getNotionStatus() {
  const s = await storageGet([
    'notionAccessToken', 'notionWorkspaceName', 'notionPageId', 'notionPageTitle'
  ]);
  return {
    connected:     Boolean(s.notionAccessToken),
    workspaceName: s.notionWorkspaceName || null,
    pageId:        s.notionPageId        || null,
    pageTitle:     s.notionPageTitle     || null,
  };
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function _exchangeToken(code, redirectUrl) {
  const creds = btoa(NOTION_CLIENT_ID + ':' + NOTION_CLIENT_SECRET);
  const res   = await fetch(_N_API + '/oauth/token', {
    method: 'POST',
    headers: {
      'Authorization':  'Basic ' + creds,
      'Content-Type':   'application/json',
      'Notion-Version': _N_VERSION,
    },
    body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: redirectUrl }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.message || 'Token exchange failed.');

  await storageSet({
    notionAccessToken:   json.access_token,
    notionWorkspaceName: json.workspace_name || null,
  });

  return { workspaceName: json.workspace_name || null };
}

async function _fetchPage(token, pageId) {
  const res  = await fetch(_N_API + '/pages/' + pageId, {
    headers: { 'Authorization': 'Bearer ' + token, 'Notion-Version': _N_VERSION },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || 'Page not found (HTTP ' + res.status + ').');
  return json;
}

// Creates a Notion page as a child of parentId, then appends any remaining
// blocks beyond the first batch. Returns { pageUrl }.
async function _createPage(token, parentId, title, blocks) {
  const headers = {
    'Authorization':  'Bearer ' + token,
    'Content-Type':   'application/json',
    'Notion-Version': _N_VERSION,
  };

  const res  = await fetch(_N_API + '/pages', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      parent:     { page_id: parentId },
      properties: { title: { title: [{ text: { content: title.slice(0, 2000) } }] } },
      children:   blocks.slice(0, _N_BATCH),
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || 'Failed to create Notion page.');

  const createdId  = json.id;
  const pageUrl    = json.url;

  // Append remaining blocks in batches of _N_BATCH
  for (let i = _N_BATCH; i < blocks.length; i += _N_BATCH) {
    const appendRes = await fetch(_N_API + '/blocks/' + createdId + '/children', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ children: blocks.slice(i, i + _N_BATCH) }),
    });
    if (!appendRes.ok) {
      const e = await appendRes.json();
      throw new Error(e.message || 'Failed to append blocks to Notion page.');
    }
  }

  return { pageUrl };
}

// ---------------------------------------------------------------------------
// Block builder — conversation → Notion block array
// ---------------------------------------------------------------------------

// Builds a Notion block array for a single conversation.
// meta: optional metadata object with author, tags, notes fields.
function _buildBlocks(data, meta) {
  const { platform, messages } = data;
  const platformLabel  = getPlatformLabel(platform);
  const exportDate     = formatDateDisplay(new Date().toISOString());
  const assistantLabel = getAssistantLabel(platform);
  const blocks         = [];

  // User-supplied metadata properties (only non-empty fields)
  if (meta && (meta.author || meta.tags || meta.notes)) {
    _appendNotionMetaBlocks(blocks, meta);
    blocks.push(_divider());
  }

  // Metadata paragraph
  blocks.push(_paragraph([
    _text('Exported from ' + platformLabel + ' · ' + exportDate, { italic: true, color: 'gray' })
  ]));

  blocks.push(_divider());

  for (const msg of messages) {
    const isUser    = msg.role === 'user';
    const roleLabel = isUser ? 'You' : assistantLabel;

    // Role label as heading_3 with colour-coded annotation
    blocks.push({
      object: 'block', type: 'heading_3',
      heading_3: {
        rich_text:     [_text(roleLabel, { bold: true, color: isUser ? 'gray' : 'green' })],
        color:         'default',
        is_toggleable: false,
      }
    });

    const msgBlocks = _mdToBlocks(msg.content || '');
    for (const b of msgBlocks) blocks.push(b);
  }

  return blocks;
}

// Builds a Notion block array for a merged export — one page, dividers between conversations.
// data: { isMerge: true, conversations: Array<{ title, platform, messages }>, exportedAt }
// meta: optional metadata object with author, tags, notes fields.
function _buildMergedBlocks(data, meta) {
  const blocks     = [];
  const exportDate = formatDateDisplay(new Date().toISOString());

  // User-supplied metadata properties at the top of the page
  if (meta && (meta.author || meta.tags || meta.notes)) {
    _appendNotionMetaBlocks(blocks, meta);
    blocks.push(_divider());
  }

  blocks.push(_paragraph([
    _text(`${data.conversations.length} conversations merged · ${exportDate}`, { italic: true, color: 'gray' })
  ]));

  data.conversations.forEach(conv => {
    blocks.push(_divider());

    const platformLabel  = getPlatformLabel(conv.platform);
    const assistantLabel = getAssistantLabel(conv.platform);

    blocks.push({
      object: 'block', type: 'heading_1',
      heading_1: {
        rich_text:     [_text(`${conv.title || 'Conversation'} — ${platformLabel}`, { bold: true })],
        color:         'default',
        is_toggleable: false,
      }
    });

    for (const msg of conv.messages) {
      const isUser    = msg.role === 'user';
      const roleLabel = isUser ? 'You' : assistantLabel;

      blocks.push({
        object: 'block', type: 'heading_3',
        heading_3: {
          rich_text:     [_text(roleLabel, { bold: true, color: isUser ? 'gray' : 'green' })],
          color:         'default',
          is_toggleable: false,
        }
      });

      const msgBlocks = _mdToBlocks(msg.content || '');
      for (const b of msgBlocks) blocks.push(b);
    }
  });

  return blocks;
}

// ---------------------------------------------------------------------------
// Markdown → Notion block array
// ---------------------------------------------------------------------------

function _mdToBlocks(md) {
  const blocks = [];
  const lines  = md.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // Fenced code block
    if (/^```/.test(line)) {
      const lang      = (line.match(/^```(\S+)/) || [])[1] || '';
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { codeLines.push(lines[i]); i++; }
      i++; // closing ```
      const code = codeLines.join('\n');
      blocks.push({
        object: 'block', type: 'code',
        code: {
          rich_text: _chunkText(code, 2000).map(c => _text(c)),
          language:  _codeLang(lang),
          caption:   [],
        }
      });
      continue;
    }

    // ATX heading (cap at heading_3 for visual hierarchy)
    const hm = line.match(/^(#{1,6})\s+(.*)/);
    if (hm) {
      const lvl  = Math.min(hm[1].length, 3);
      const type = 'heading_' + lvl;
      blocks.push({
        object: 'block', type,
        [type]: { rich_text: _inlineRichText(hm[2]), color: 'default', is_toggleable: false }
      });
      i++; continue;
    }

    // Horizontal rule → divider
    if (/^([-*_]){3,}\s*$/.test(line.trim())) {
      blocks.push(_divider());
      i++; continue;
    }

    // Blockquote (collect consecutive > lines)
    if (line.startsWith('> ')) {
      const bqLines = [];
      while (i < lines.length && lines[i].startsWith('> ')) { bqLines.push(lines[i].slice(2)); i++; }
      blocks.push({ object: 'block', type: 'quote', quote: { rich_text: _inlineRichText(bqLines.join(' ')), color: 'default' } });
      continue;
    }

    // Bullet list item
    const bm = line.match(/^(\s*)([-*+])\s+(.*)/);
    if (bm) {
      blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: _inlineRichText(bm[3]), color: 'default' } });
      i++; continue;
    }

    // Ordered list item
    const om = line.match(/^(\s*)\d+\.\s+(.*)/);
    if (om) {
      blocks.push({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: _inlineRichText(om[2]), color: 'default' } });
      i++; continue;
    }

    // Normal paragraph — collect consecutive non-blank non-special lines
    const pLines = [];
    while (i < lines.length && lines[i].trim() && !_isSpecial(lines[i])) { pLines.push(lines[i]); i++; }
    if (pLines.length) blocks.push(_paragraph(_inlineRichText(pLines.join(' '))));
  }

  return blocks;
}

function _isSpecial(line) {
  return /^```/.test(line) ||
    /^#{1,6}\s/.test(line) ||
    /^([-*_]){3,}\s*$/.test(line.trim()) ||
    line.startsWith('> ') ||
    /^(\s*)([-*+]|\d+\.)\s/.test(line);
}

// ---------------------------------------------------------------------------
// Inline markdown → Notion rich_text array
// ---------------------------------------------------------------------------

function _inlineRichText(text) {
  if (!text) return [_text('')];

  const re  = /(`[^`\n]+`|\*\*\*[^*\n]+\*\*\*|\*\*[^*\n]+\*\*|__[^_\n]+__|_[^_\n]+_|\*[^*\n]+\*|~~[^~\n]+~~|\[([^\]]+)\]\([^)]*\))/g;
  const out = [];
  let last  = 0;
  let m;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(..._textChunks(text.slice(last, m.index)));

    const tok = m[0];
    if (tok.startsWith('`') && tok.endsWith('`')) {
      out.push(_text(tok.slice(1, -1), { code: true }));
    } else if (tok.startsWith('***') && tok.endsWith('***')) {
      out.push(_text(tok.slice(3, -3), { bold: true, italic: true }));
    } else if ((tok.startsWith('**') && tok.endsWith('**')) || (tok.startsWith('__') && tok.endsWith('__'))) {
      out.push(_text(tok.slice(2, -2), { bold: true }));
    } else if ((tok.startsWith('*') && tok.endsWith('*')) || (tok.startsWith('_') && tok.endsWith('_'))) {
      out.push(_text(tok.slice(1, -1), { italic: true }));
    } else if (tok.startsWith('~~') && tok.endsWith('~~')) {
      out.push(_text(tok.slice(2, -2), { strikethrough: true }));
    } else if (tok.startsWith('[')) {
      out.push(_text(m[2] || '', { italic: true }));  // link: show text only
    }

    last = m.index + tok.length;
  }

  if (last < text.length) out.push(..._textChunks(text.slice(last)));
  return out.length ? out : [_text('')];
}

// ---------------------------------------------------------------------------
// Notion primitive constructors
// ---------------------------------------------------------------------------

function _text(content, opts = {}) {
  return {
    type: 'text',
    text: { content: String(content || '').slice(0, 2000), link: null },
    annotations: {
      bold:          opts.bold          || false,
      italic:        opts.italic        || false,
      strikethrough: opts.strikethrough || false,
      underline:     false,
      code:          opts.code          || false,
      color:         opts.color         || 'default',
    }
  };
}

// Splits text that may exceed 2000 chars into multiple _text elements.
function _textChunks(text, opts = {}) {
  return _chunkText(text, 2000).map(c => _text(c, opts));
}

function _paragraph(richText) {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: richText, color: 'default' } };
}

function _divider() {
  return { object: 'block', type: 'divider', divider: {} };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

// Splits text into sequential chunks of at most maxLen characters.
function _chunkText(text, maxLen) {
  if (!text) return [''];
  const chunks = [];
  for (let i = 0; i < text.length; i += maxLen) chunks.push(text.slice(i, i + maxLen));
  return chunks;
}

// Extracts a normalised Notion page ID (32 hex chars, no dashes) from a
// Notion page URL or raw ID string. Returns null if no ID can be parsed.
function _parsePageId(input) {
  if (!input) return null;

  // Strip query string and hash
  const clean = input.split('?')[0].split('#')[0].replace(/\/+$/, '');

  // Notion URL — extract last path segment
  if (clean.includes('notion.so') || clean.includes('notion.site')) {
    let segment;
    try {
      const segs = new URL(clean).pathname.split('/').filter(Boolean);
      segment    = segs[segs.length - 1] || '';
    } catch {
      const after = clean.split('notion.so/').pop() || '';
      segment     = after.split('/').pop() || '';
    }
    return _segmentToId(segment) || segment;
  }

  // Raw ID (with or without dashes)
  const raw = clean.replace(/-/g, '');
  return /^[a-f0-9]{32}$/i.test(raw) ? raw : null;
}

// Extracts a 32-hex-char ID from a Notion URL path segment like
// "Page-Title-abc123def456abc123def456ab" or just the raw hex ID.
function _segmentToId(segment) {
  const stripped = segment.replace(/-/g, '');
  if (/^[a-f0-9]{32}$/i.test(stripped)) return stripped;
  const m = stripped.match(/([a-f0-9]{32})$/i);
  return m ? m[1] : null;
}

// Reads the plain-text title from a Notion page API response.
function _extractTitle(page) {
  try {
    const prop = page.properties && (page.properties.title || page.properties.Name);
    if (!prop) return 'Untitled';
    return (prop.title || []).map(r => r.plain_text || '').join('').trim() || 'Untitled';
  } catch {
    return 'Untitled';
  }
}

// Maps common code fence language tags to Notion's supported language values.
// Notion's list: https://developers.notion.com/reference/block#code
function _codeLang(lang) {
  if (!lang) return 'plain text';
  const l   = lang.toLowerCase();
  const map = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    py: 'python', python3: 'python',
    sh: 'bash', shell: 'bash', zsh: 'bash',
    rb: 'ruby',
    rs: 'rust',
    kt: 'kotlin', kts: 'kotlin',
    cpp: 'c++', cxx: 'c++', cc: 'c++',
    cs: 'c#', csharp: 'c#',
    md: 'markdown',
    yml: 'yaml',
    ps1: 'powershell', psm1: 'powershell',
    dockerfile: 'docker',
    ex: 'elixir', exs: 'elixir',
    hs: 'haskell',
    ml: 'plain text', // OCaml not in Notion's list
    tf: 'plain text', // Terraform not in Notion's list
  };
  return map[l] || l;
}

// ---------------------------------------------------------------------------
// Metadata helper
// ---------------------------------------------------------------------------

// Appends author, tags, notes, and exported as labelled paragraph blocks.
// Only includes fields that have non-empty values.
// Modifies the blocks array in place; returns void.
function _appendNotionMetaBlocks(blocks, meta) {
  if (meta.author) {
    blocks.push(_paragraph([
      _text('Author: ', { bold: true, color: 'gray' }),
      _text(meta.author, { color: 'gray' })
    ]));
  }
  if (meta.tags) {
    blocks.push(_paragraph([
      _text('Tags: ', { bold: true, color: 'gray' }),
      _text(meta.tags, { color: 'gray' })
    ]));
  }
  if (meta.notes) {
    blocks.push(_paragraph([
      _text('Notes: ', { bold: true, color: 'gray' }),
      _text(meta.notes, { color: 'gray' })
    ]));
  }
  if (meta.exported) {
    blocks.push(_paragraph([
      _text('Exported: ', { bold: true, color: 'gray' }),
      _text(meta.exported, { color: 'gray' })
    ]));
  }
}
