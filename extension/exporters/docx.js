// =============================================================
// exporters/docx.js
// Generates Microsoft Word (.docx) files from conversation data.
// Premium-only. Pure client-side — no external library needed.
//
// DOCX is a ZIP archive of OOXML XML files. This implementation
// uses the ZIP "stored" method (compression = 0) so no DEFLATE
// library is required. File sizes are acceptable for text.
//
// Depends on (loaded before this file):
//   utils/export-utils.js  — triggerDownload / buildFilename /
//                            getPlatformLabel / getAssistantLabel /
//                            formatDateDisplay
// =============================================================

'use strict';

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

// Called from popup.js dispatch after premium check.
// data    — { messages, title, platform, exportedAt, messageCount } OR { isMerge, conversations, exportedAt }
// options — { isPremium, filename?, meta? }
function exportToDOCX(data, options = {}) {
  const meta     = options.meta || null;
  const bytes    = data.isMerge ? _buildMergedDOCX(data, meta) : _buildDOCX(data, meta);
  const filename = options.filename
    ? options.filename + '.docx'
    : data.isMerge
      ? 'merged-conversations-' + new Date().toISOString().slice(0, 10) + '.docx'
      : buildFilename(data, 'docx');
  triggerDownload(
    bytes,
    filename,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
}

// ---------------------------------------------------------------------------
// DOCX assembly
// ---------------------------------------------------------------------------

function _buildMergedDOCX(data, meta) {
  const hasMeta = meta && (meta.author || meta.tags || meta.notes);
  const files = {
    '[Content_Types].xml':          _xmlContentTypes(hasMeta),
    '_rels/.rels':                  _xmlRootRels(hasMeta),
    'word/document.xml':            _xmlMergedDocument(data, meta),
    'word/_rels/document.xml.rels': _xmlDocumentRels(),
    'word/styles.xml':              _xmlStyles(),
    'word/numbering.xml':           _xmlNumbering(),
    'word/settings.xml':            _xmlSettings(),
  };
  if (hasMeta) files['docProps/core.xml'] = _xmlCoreProps(meta);
  return _zipCreate(files);
}

function _xmlMergedDocument(data, meta) {
  const body = [];

  // Visible metadata block at the top of the document (before conversations)
  _appendDocxMetaBlock(body, meta);

  data.conversations.forEach((conv, i) => {
    if (i > 0) {
      // Page break before each conversation after the first
      body.push('    <w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    }

    const platformLabel  = getPlatformLabel(conv.platform);
    const assistantLabel = getAssistantLabel(conv.platform);

    body.push(_p(_runsXml(_xe(conv.title || 'Conversation')), 'Heading1'));
    body.push(_p(_runsXml(_xe(platformLabel)), 'Metadata'));

    for (const msg of conv.messages) {
      const isUser    = msg.role === 'user';
      const roleLabel = isUser ? 'You' : assistantLabel;
      const roleStyle = isUser ? 'RoleUser' : 'RoleAssistant';
      body.push(_p(_runsXml(_xe(roleLabel)), roleStyle));
      const blocks = _parseMarkdown(msg.content || '');
      for (const b of blocks) body.push(b);
    }
  });

  body.push(_p(''));

  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}>
  <w:body>
${body.join('\n')}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"
               w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

function _buildDOCX(data, meta) {
  const hasMeta = meta && (meta.author || meta.tags || meta.notes);
  const files = {
    '[Content_Types].xml':          _xmlContentTypes(hasMeta),
    '_rels/.rels':                  _xmlRootRels(hasMeta),
    'word/document.xml':            _xmlDocument(data, meta),
    'word/_rels/document.xml.rels': _xmlDocumentRels(),
    'word/styles.xml':              _xmlStyles(),
    'word/numbering.xml':           _xmlNumbering(),
    'word/settings.xml':            _xmlSettings(),
  };
  if (hasMeta) files['docProps/core.xml'] = _xmlCoreProps(meta);
  return _zipCreate(files);
}

// ---------------------------------------------------------------------------
// [Content_Types].xml
// ---------------------------------------------------------------------------

// hasMeta: true → adds core-properties content type entry for docProps/core.xml
function _xmlContentTypes(hasMeta) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
    (hasMeta ? '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' : '') +
  '</Types>';
}

// ---------------------------------------------------------------------------
// _rels/.rels
// ---------------------------------------------------------------------------

// hasMeta: true → adds relationship entry for docProps/core.xml
function _xmlRootRels(hasMeta) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    (hasMeta
      ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
      : '') +
  '</Relationships>';
}

// Generates docProps/core.xml document properties from user-provided metadata.
// Only includes fields that have values (creator, keywords, description).
// Returns an XML string
function _xmlCoreProps(meta) {
  const CP  = 'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"';
  const DC  = 'xmlns:dc="http://purl.org/dc/elements/1.1/"';
  const DCT = 'xmlns:dcterms="http://purl.org/dc/terms/"';
  const XSI = 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';

  const parts = [];
  if (meta.author) parts.push(`  <dc:creator>${_xe(meta.author)}</dc:creator>`);
  if (meta.tags)   parts.push(`  <cp:keywords>${_xe(meta.tags)}</cp:keywords>`);
  if (meta.notes)  parts.push(`  <dc:description>${_xe(meta.notes)}</dc:description>`);
  parts.push(`  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>`);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties ${CP} ${DC} ${DCT} ${XSI}>
${parts.join('\n')}
</cp:coreProperties>`;
}

// Appends visible metadata paragraphs (author, tags, notes, exported) to a body array.
// Skips silently when meta is null or all fields are empty.
// Returns void
function _appendDocxMetaBlock(body, meta) {
  if (!meta || (!meta.author && !meta.tags && !meta.notes)) return;
  if (meta.author)   body.push(_p(_runsXml(`Author: ${_xe(meta.author)}`), 'Metadata'));
  if (meta.tags)     body.push(_p(_runsXml(`Tags: ${_xe(meta.tags)}`), 'Metadata'));
  if (meta.notes)    body.push(_p(_runsXml(`Notes: ${_xe(meta.notes)}`), 'Metadata'));
  if (meta.exported) body.push(_p(_runsXml(`Exported: ${_xe(meta.exported)}`), 'Metadata'));
  body.push(_p(''));
}

// ---------------------------------------------------------------------------
// word/_rels/document.xml.rels
// ---------------------------------------------------------------------------

function _xmlDocumentRels() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
  '</Relationships>';
}

// ---------------------------------------------------------------------------
// word/settings.xml
// ---------------------------------------------------------------------------

function _xmlSettings() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:defaultTabStop w:val="720"/>' +
    '<w:compat>' +
      '<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>' +
    '</w:compat>' +
  '</w:settings>';
}

// ---------------------------------------------------------------------------
// word/numbering.xml — bullet (numId=1) and ordered (numId=2) list definitions
// ---------------------------------------------------------------------------

function _xmlNumbering() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:abstractNum w:abstractNumId="0">' +
      '<w:nsid w:val="00AB1C2D"/>' +
      '<w:multiLevelType w:val="hybridMultilevel"/>' +
      '<w:lvl w:ilvl="0">' +
        '<w:start w:val="1"/><w:numFmt w:val="bullet"/>' +
        '<w:lvlText w:val="&#x2022;"/><w:lvlJc w:val="left"/>' +
        '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>' +
        '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/></w:rPr>' +
      '</w:lvl>' +
      '<w:lvl w:ilvl="1">' +
        '<w:start w:val="1"/><w:numFmt w:val="bullet"/>' +
        '<w:lvlText w:val="&#x25E6;"/><w:lvlJc w:val="left"/>' +
        '<w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr>' +
        '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/></w:rPr>' +
      '</w:lvl>' +
    '</w:abstractNum>' +
    '<w:abstractNum w:abstractNumId="1">' +
      '<w:nsid w:val="00CD3E4F"/>' +
      '<w:multiLevelType w:val="hybridMultilevel"/>' +
      '<w:lvl w:ilvl="0">' +
        '<w:start w:val="1"/><w:numFmt w:val="decimal"/>' +
        '<w:lvlText w:val="%1."/><w:lvlJc w:val="left"/>' +
        '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>' +
      '</w:lvl>' +
    '</w:abstractNum>' +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
    '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
  '</w:numbering>';
}

// ---------------------------------------------------------------------------
// word/styles.xml
// ---------------------------------------------------------------------------

function _xmlStyles() {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}>
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>
      <w:sz w:val="24"/><w:szCs w:val="24"/>
      <w:lang w:val="en-US"/>
    </w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr>
      <w:spacing w:after="160" w:line="276" w:lineRule="auto"/>
    </w:pPr></w:pPrDefault>
  </w:docDefaults>

  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/><w:next w:val="Normal"/>
    <w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="480" w:after="160"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="44"/><w:szCs w:val="44"/><w:color w:val="111111"/></w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/><w:next w:val="Normal"/>
    <w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="320" w:after="120"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/><w:color w:val="111111"/></w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/><w:next w:val="Normal"/>
    <w:pPr><w:outlineLvl w:val="2"/><w:spacing w:before="240" w:after="80"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/><w:color w:val="374151"/></w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Code">
    <w:name w:val="Code"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>
      <w:shd w:val="clear" w:color="auto" w:fill="1E1E1E"/>
      <w:ind w:left="240" w:right="240"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>
      <w:sz w:val="20"/><w:szCs w:val="20"/><w:color w:val="D4D4D4"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="RoleUser">
    <w:name w:val="RoleUser"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="400" w:after="120"/>
      <w:pBdr><w:left w:val="single" w:sz="16" w:space="8" w:color="9CA3AF"/></w:pBdr>
      <w:ind w:left="240"/>
    </w:pPr>
    <w:rPr>
      <w:b/><w:caps/><w:sz w:val="20"/><w:szCs w:val="20"/>
      <w:color w:val="374151"/><w:spacing w:val="40"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="RoleAssistant">
    <w:name w:val="RoleAssistant"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="400" w:after="120"/>
      <w:pBdr><w:left w:val="single" w:sz="16" w:space="8" w:color="10B981"/></w:pBdr>
      <w:ind w:left="240"/>
    </w:pPr>
    <w:rPr>
      <w:b/><w:caps/><w:sz w:val="20"/><w:szCs w:val="20"/>
      <w:color w:val="059669"/><w:spacing w:val="40"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Metadata">
    <w:name w:val="Metadata"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="0" w:after="280"/></w:pPr>
    <w:rPr><w:i/><w:sz w:val="20"/><w:szCs w:val="20"/><w:color w:val="6B7280"/></w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Blockquote">
    <w:name w:val="Blockquote"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="D1D5DB"/></w:pBdr>
      <w:ind w:left="360"/>
      <w:spacing w:before="80" w:after="80"/>
    </w:pPr>
    <w:rPr><w:i/><w:color w:val="6B7280"/></w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="ListBullet">
    <w:name w:val="List Bullet"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="ListNumber">
    <w:name w:val="List Number"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr>
  </w:style>

  <w:style w:type="character" w:styleId="InlineCode">
    <w:name w:val="InlineCode"/>
    <w:rPr>
      <w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>
      <w:sz w:val="22"/><w:szCs w:val="22"/>
      <w:color w:val="C7254E"/>
      <w:shd w:val="clear" w:color="auto" w:fill="F9F2F4"/>
    </w:rPr>
  </w:style>
</w:styles>`;
}

// ---------------------------------------------------------------------------
// word/document.xml
// ---------------------------------------------------------------------------

function _xmlDocument(data, meta) {
  const { title, platform, messages } = data;
  const platformLabel  = getPlatformLabel(platform);
  const exportDate     = formatDateDisplay(new Date().toISOString());
  const assistantLabel = getAssistantLabel(platform);

  const body = [];

  // Document title
  body.push(_p(_runsXml(_xe(title || 'Conversation')), 'Heading1'));

  // Metadata line
  body.push(_p(_runsXml(`Exported from ${_xe(platformLabel)} · ${_xe(exportDate)}`), 'Metadata'));

  // Visible user metadata block (author, tags, notes) when provided
  _appendDocxMetaBlock(body, meta);

  // Messages
  for (const msg of messages) {
    const isUser    = msg.role === 'user';
    const roleLabel = isUser ? 'You' : assistantLabel;
    const roleStyle = isUser ? 'RoleUser' : 'RoleAssistant';

    body.push(_p(_runsXml(_xe(roleLabel)), roleStyle));

    const blocks = _parseMarkdown(msg.content || '');
    for (const b of blocks) body.push(b);
  }

  // Word requires a trailing paragraph
  body.push(_p(''));

  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}>
  <w:body>
${body.join('\n')}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"
               w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

// ---------------------------------------------------------------------------
// Markdown → OOXML paragraph blocks
// ---------------------------------------------------------------------------

function _parseMarkdown(md) {
  const blocks = [];
  const lines = md.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line — skip (paragraph breaks are implied by block boundaries)
    if (!line.trim()) { i++; continue; }

    // Fenced code block
    if (/^```/.test(line)) {
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // closing ```
      if (!codeLines.length) codeLines.push('');
      codeLines.forEach((cl, ci) => {
        const before  = ci === 0 ? ' w:before="160"' : '';
        const after   = ci === codeLines.length - 1 ? ' w:after="160"' : '';
        const spacing = (before || after) ? `<w:spacing${before}${after}/>` : '';
        blocks.push(
          `    <w:p><w:pPr><w:pStyle w:val="Code"/>${spacing}</w:pPr>` +
          `<w:r><w:t xml:space="preserve">${_xe(cl) || ' '}</w:t></w:r></w:p>`
        );
      });
      continue;
    }

    // ATX heading
    const hm = line.match(/^(#{1,6})\s+(.*)/);
    if (hm) {
      const lvl   = Math.min(hm[1].length, 3);
      blocks.push(_p(_inlineXml(hm[2]), `Heading${lvl}`));
      i++; continue;
    }

    // Horizontal rule
    if (/^([-*_]){3,}\s*$/.test(line.trim())) {
      blocks.push(
        '    <w:p><w:pPr>' +
        '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="E5E7EB"/></w:pBdr>' +
        '<w:spacing w:before="160" w:after="160"/>' +
        '</w:pPr></w:p>'
      );
      i++; continue;
    }

    // Blockquote (collect consecutive > lines)
    if (line.startsWith('> ')) {
      const bqLines = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        bqLines.push(lines[i].slice(2));
        i++;
      }
      blocks.push(_p(_inlineXml(bqLines.join(' ')), 'Blockquote'));
      continue;
    }

    // Bullet list item
    const bm = line.match(/^(\s*)([-*+])\s+(.*)/);
    if (bm) {
      const ilvl  = Math.min(Math.floor(bm[1].length / 2), 1);
      blocks.push(_listPara(_inlineXml(bm[3]), 1, ilvl));
      i++; continue;
    }

    // Ordered list item
    const om = line.match(/^(\s*)\d+\.\s+(.*)/);
    if (om) {
      blocks.push(_listPara(_inlineXml(om[2]), 2, 0));
      i++; continue;
    }

    // Normal paragraph — collect consecutive non-blank non-special lines
    const pLines = [];
    while (i < lines.length && lines[i].trim() && !_isSpecialLine(lines[i])) {
      pLines.push(lines[i]);
      i++;
    }
    if (pLines.length) {
      blocks.push(_p(_inlineXml(pLines.join(' '))));
    }
  }

  return blocks;
}

function _isSpecialLine(line) {
  return /^```/.test(line) ||
    /^#{1,6}\s/.test(line) ||
    /^([-*_]){3,}\s*$/.test(line.trim()) ||
    line.startsWith('> ') ||
    /^(\s*)([-*+]|\d+\.)\s/.test(line);
}

// ---------------------------------------------------------------------------
// Inline markdown → XML run string
// ---------------------------------------------------------------------------

function _inlineXml(text) {
  if (!text) return '';

  // Ordered: longest tokens first to avoid partial matches
  const re = /(`[^`\n]+`|\*\*\*[^*\n]+\*\*\*|\*\*[^*\n]+\*\*|__[^_\n]+__|_[^_\n]+_|\*[^*\n]+\*|~~[^~\n]+~~|\[([^\]]+)\]\([^)]*\))/g;
  let out  = '';
  let last = 0;
  let m;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out += _run(_xe(text.slice(last, m.index)));
    }
    const tok = m[0];

    if (tok.startsWith('`') && tok.endsWith('`')) {
      out += _run(_xe(tok.slice(1, -1)), { code: true });
    } else if (tok.startsWith('***') && tok.endsWith('***')) {
      out += _run(_xe(tok.slice(3, -3)), { bold: true, italic: true });
    } else if ((tok.startsWith('**') && tok.endsWith('**')) ||
               (tok.startsWith('__') && tok.endsWith('__'))) {
      out += _run(_xe(tok.slice(2, -2)), { bold: true });
    } else if ((tok.startsWith('*') && tok.endsWith('*')) ||
               (tok.startsWith('_') && tok.endsWith('_'))) {
      out += _run(_xe(tok.slice(1, -1)), { italic: true });
    } else if (tok.startsWith('~~') && tok.endsWith('~~')) {
      out += _run(_xe(tok.slice(2, -2)), { strike: true });
    } else if (tok.startsWith('[')) {
      // Link — render visible text only
      out += _run(_xe(m[2] || ''), { italic: true });
    }

    last = m.index + tok.length;
  }

  if (last < text.length) out += _run(_xe(text.slice(last)));

  return out;
}

// ---------------------------------------------------------------------------
// OOXML element builders
// ---------------------------------------------------------------------------

// Paragraph with optional style. content is raw XML (runs).
function _p(content, style) {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  return `    <w:p>${pPr}${content}</w:p>`;
}

// Simple plain-text run(s) — no inline formatting, for pre-escaped text.
function _runsXml(escapedText) {
  return `<w:r><w:t xml:space="preserve">${escapedText}</w:t></w:r>`;
}

// Formatted run. opts: { bold, italic, strike, code }
function _run(text, opts = {}) {
  if (!text) return '';
  const { bold, italic, strike, code } = opts;
  const parts = [];
  if (bold)   parts.push('<w:b/><w:bCs/>');
  if (italic) parts.push('<w:i/><w:iCs/>');
  if (strike) parts.push('<w:strike/>');
  if (code)   parts.push('<w:rStyle w:val="InlineCode"/>');
  const rPr = parts.length ? `<w:rPr>${parts.join('')}</w:rPr>` : '';
  return `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}

// List paragraph. numId: 1=bullet, 2=ordered. ilvl: 0|1 for indent level.
function _listPara(runsXml, numId, ilvl) {
  const style = numId === 2 ? 'ListNumber' : 'ListBullet';
  return `    <w:p>` +
    `<w:pPr><w:pStyle w:val="${style}"/>` +
    `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>` +
    `</w:pPr>${runsXml}</w:p>`;
}

// ---------------------------------------------------------------------------
// XML character escaping
// ---------------------------------------------------------------------------

function _xe(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---------------------------------------------------------------------------
// ZIP (stored / no compression)
// ---------------------------------------------------------------------------

// CRC-32 lookup table built once at module load.
const _CRC_TABLE = (function () {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
}());

function _crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = _CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Creates a valid ZIP archive from a name→utf8string map.
// Returns Uint8Array.
function _zipCreate(files) {
  const enc     = new TextEncoder();
  const entries = [];

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const dataBytes = enc.encode(content);
    entries.push({ nameBytes, dataBytes, crc: _crc32(dataBytes) });
  }

  // Pass 1 — build local file records and track offsets
  const localParts = [];
  let offset = 0;
  for (const entry of entries) {
    entry.localOffset = offset;
    const lh = _zipLocalHeader(entry);
    localParts.push(lh, entry.dataBytes);
    offset += lh.length + entry.dataBytes.length;
  }

  // Pass 2 — central directory
  const cdParts = entries.map(e => _zipCDHeader(e));
  const cdSize  = cdParts.reduce((s, p) => s + p.length, 0);
  const eocd    = _zipEOCD(entries.length, cdSize, offset);

  // Assemble
  const total = offset + cdSize + eocd.length;
  const out   = new Uint8Array(total);
  let pos = 0;
  for (const part of [...localParts, ...cdParts, [eocd]].flat()) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

function _zipLocalHeader({ nameBytes, dataBytes, crc }) {
  const buf  = new ArrayBuffer(30 + nameBytes.length);
  const view = new DataView(buf);
  const u8   = new Uint8Array(buf);
  view.setUint32(0,  0x04034b50,      true);
  view.setUint16(4,  20,              true);  // version needed
  view.setUint16(6,  0,               true);  // flags
  view.setUint16(8,  0,               true);  // compression: stored
  view.setUint16(10, 0,               true);  // mod time
  view.setUint16(12, 0,               true);  // mod date
  view.setUint32(14, crc,             true);
  view.setUint32(18, dataBytes.length, true);  // compressed size
  view.setUint32(22, dataBytes.length, true);  // uncompressed size
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, 0,               true);  // extra field length
  u8.set(nameBytes, 30);
  return u8;
}

function _zipCDHeader({ nameBytes, dataBytes, crc, localOffset }) {
  const buf  = new ArrayBuffer(46 + nameBytes.length);
  const view = new DataView(buf);
  const u8   = new Uint8Array(buf);
  view.setUint32(0,  0x02014b50,      true);
  view.setUint16(4,  20,              true);  // version made by
  view.setUint16(6,  20,              true);  // version needed
  view.setUint16(8,  0,               true);  // flags
  view.setUint16(10, 0,               true);  // compression: stored
  view.setUint16(12, 0,               true);  // mod time
  view.setUint16(14, 0,               true);  // mod date
  view.setUint32(16, crc,             true);
  view.setUint32(20, dataBytes.length, true);
  view.setUint32(24, dataBytes.length, true);
  view.setUint16(28, nameBytes.length, true);
  view.setUint16(30, 0,               true);  // extra length
  view.setUint16(32, 0,               true);  // comment length
  view.setUint16(34, 0,               true);  // disk start
  view.setUint16(36, 0,               true);  // internal attrs
  view.setUint32(38, 0,               true);  // external attrs
  view.setUint32(42, localOffset,     true);
  u8.set(nameBytes, 46);
  return u8;
}

function _zipEOCD(count, cdSize, cdOffset) {
  const buf  = new ArrayBuffer(22);
  const view = new DataView(buf);
  const u8   = new Uint8Array(buf);
  view.setUint32(0,  0x06054b50, true);
  view.setUint16(4,  0,          true);  // disk number
  view.setUint16(6,  0,          true);  // disk with CD
  view.setUint16(8,  count,      true);
  view.setUint16(10, count,      true);
  view.setUint32(12, cdSize,     true);
  view.setUint32(16, cdOffset,   true);
  view.setUint16(20, 0,          true);  // comment length
  return u8;
}
