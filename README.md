# Grabit

Export your AI chats as real files. Grabit is a Chrome extension that saves conversations from ChatGPT, Claude, Gemini and Grok to Markdown, plain text, JSON, CSV, HTML, PDF and DOCX, or sends them to Notion.

Everything runs in your browser. There is no Grabit server, no account and no tracking.

## Why

Copying a long AI conversation by hand loses the formatting, the code blocks and the order of who said what. Most export tools cover one platform. Grabit covers four, and the output is laid out like a document you would actually share.

## Supported platforms

- ChatGPT
- Claude
- Gemini
- Grok

## Features

**Export formats**

| Format | Free | Pro |
| --- | --- | --- |
| Markdown (.md) | Yes | Yes |
| Plain text (.txt) | Yes | Yes |
| JSON (.json) | Yes | Yes |
| CSV (.csv) | Yes | Yes |
| HTML (.html) | Yes | Yes |
| PDF | Yes | Yes |
| DOCX (.docx) | No | Yes |
| Notion sync | No | Yes |

**Choose what gets exported**

- Export the whole conversation in one click.
- Tick individual messages to keep or drop.
- Export AI responses only.
- Export just the last N turns.

**Pro extras**

- Merge several conversations into one file.
- Set your own filename and metadata.
- No Grabit watermark on PDF and HTML output.
- No daily limit.

Exporting a whole conversation is unlimited on the free tier. Exports where you pick specific messages, AI responses only, or the last N turns are limited to 3 a day. The counter resets at midnight.

## Install

Grabit is not on the Chrome Web Store yet. For now, load it manually:

1. Download this repository: click **Code**, then **Download ZIP**, and unzip it. Or clone it with `git clone`.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked**.
5. Select the folder that contains `manifest.json`.

The Grabit icon appears in your toolbar. Pin it so it is easy to reach.

## Use

1. Open a conversation on ChatGPT, Claude, Gemini or Grok.
2. Click the Grabit icon.
3. Pick a format.
4. Optional: choose specific messages, AI responses only, or the last N turns.
5. Click export. The file downloads to your computer.

For long conversations, Grabit scrolls the page first so messages that have not loaded yet are included.

## How it works

- **Scrapers.** Each platform has its own content script that reads the conversation from the page's DOM. No API keys are needed.
- **Exporters.** Each format has its own converter. The file is built in the browser and downloaded directly.
- **Gate.** A small module counts selective exports per day and checks whether a Pro licence is active.
- **Licence check.** Pro is unlocked with a licence key validated through LemonSqueezy. There is no Grabit backend.
- **Notion sync.** Uses the official Notion API with OAuth. You choose where the page goes.

Built on Manifest V3 with plain JavaScript, HTML and CSS. DOCX files are written by Grabit's own exporter, and PDF files are generated with the bundled jsPDF library. Settings and the daily counter are stored with the Chrome storage API.

## Privacy

- Grabit reads a conversation only when you click export.
- Your conversations are processed on your device. They are not sent to us, because there is no "us" server to send them to.
- Two features talk to outside services, and only when you use them: Notion sync sends the conversation you chose to your Notion workspace, and the licence check sends your licence key to LemonSqueezy.
- No analytics. No ads. No accounts.

Full details are in [PRIVACY.md](PRIVACY.md).

## Status

Version 1 is feature-complete and in pre-launch testing.

- Pro licences are not on sale yet.
- A Chrome Web Store listing is planned.

**Later:** Obsidian export and support for more AI platforms.

## Known limits

Grabit reads each site's page structure. When ChatGPT, Claude, Gemini or Grok change their layout, an export can break until the scraper is updated. If an export looks wrong or comes out empty, please [open an issue](../../issues) and say which platform you were on.

## Authors

Built by Rakim Mistry ([@iamkimbo](https://github.com/iamkimbo)).

## License

No license has been chosen for this project yet. You are welcome to read the code and load the extension for your own use. Please ask before redistributing or reselling it.

Grabit is an independent project. It is not affiliated with or endorsed by OpenAI, Anthropic, Google or xAI.
