# Jev Investment Forecast

A Chrome extension (Manifest V3) with a single job: **inspect the page you are on and forecast its
investment potential with a percentage score for every category**, powered by the TypeSafe Jev API
(`https://api.typesafe.ai/v1/systemone`).

Right-click anywhere on a page and choose **“Jev: inspect page”**, or open the extension popup and
press **“Inspect this page”**. A card appears in the top-right corner of the page with one row per
category:

| Row | Highlight threshold |
| --- | --- |
| ⚠️ Fraud | 50% |
| 📢 Advertising | 20% |
| 🤖 AI generation | 25% |
| 🚫 Spam | 25% |
| 🪤 Clickbait | 20% |
| 💎 Infobusiness | 25% |
| 🤬 Toxicity | 25% |
| 📕 Plagiat | 25% |
| ✨ Novelty | 50% |
| 🚀 Promising Potential | 50% |
| 🌐 Scalability | 50% |
| 💰 Monetizable | 50% |
| 🎓 Expert Depth | 50% |
| 🛠️ Practical Value | 50% |
| 🔥 Viral / Trendy | 50% |
| 🔞 NSFW / Adult | 25% |
| 🗣️ Hate Speech | 25% |
| 📰 Fake News | 25% |
| 🎰 Gambling / Betting | 25% |
| 🚀 Shilling / Crypto-Pump | 25% |
| 🔮 Pseudoscience | 25% |
| 👑 Authority | 50% |
| 🛠️ Feasible | 50% |
| 💣 High Risk | 25% |
| 🌱 Sustainable | 50% |
| 🎨 High Quality UI/UX | 50% |
| 🎯 Clear & Concise | 50% |

The highlight thresholds are built into `content.js` (`THRESHOLDS`): the positive-value rows
(Novelty … Viral / Trendy, plus Authority, Feasible, Sustainable, High Quality UI/UX and Clear & Concise)
use a stricter 50% so only strongly valuable pages light up, while the risk rows use 25%. They are
constants now, not settings.

Every row shows the percentage returned by the API and a progress bar — the threshold itself is not drawn
on the card. A row is highlighted when its percentage reaches the built-in threshold for that category
(highlighted more strongly from 80% up). The card can be copied to the clipboard with **Copy**
(one `label percentage` line per category) or closed with **×**.

The 27 rows are laid out in three columns of nine rows, so the whole card stays about 420 px tall and
fits on screen without scrolling. Only in an unusually short window is the card capped to the viewport
height and scrolled internally.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Open the extension popup, paste your TypeSafe Jev API token and press **Save settings**.
   Without a token the card reports `Missing API key…`.

## Settings

- **TypeSafe Jev API token** — sent as `Authorization: Bearer <token>` with every request and stored
  in `chrome.storage.local` under `jevApiKey`.

Detection thresholds are **not configurable**: `content.js` ships the built-in `THRESHOLDS` constants
described above, so the popup only holds the token.

## How it works

1. `background.js` registers the context menu item **“Jev: inspect page”** and handles two messages:
   `inspectActiveTab` (from the popup) and `analyzePage` (from the content script).
2. The content script collects the readable text of the page: innermost elements matching
   `TARGET_SELECTOR` (`p`, `article`, `section`, `li`, …), skipping anything inside
   `NOISE_SELECTOR` (`nav`, `footer`, `header`, `form`, …), blocks shorter than 30 characters and
   everything past 4 000 characters.
3. The text is POSTed to the Jev API as one `state` with twenty-seven `noul` questions
   (`is_fraud`, `is_advertising`, `is_ai_generated`, `is_spam`, `is_clickbait`, `is_infobusiness`,
   `is_toxic`, `is_plagiat`, `is_novel`, `is_promising`, `is_scalable`, `is_monetizable`,
   `is_expert`, `is_actionable`, `is_trendy`, `is_nsfw`, `is_hate_speech`, `is_fake_news`,
   `is_gambling`, `is_shilling`, `is_pseudoscience`, `is_authority`, `is_feasible`, `is_high_risk`,
   `is_ethical`, `is_well_designed`, `is_clear`).
4. `content.js` turns every answer into a probability (0–1), compares it with the built-in threshold
   for that category and renders the percentage card.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest — permissions: `storage`, `activeTab`, `contextMenus`. |
| `background.js` | Context menu, popup routing and the Jev API request. |
| `content.js` | Page text collection and the percentage card. |
| `styles.css` | Styles for the card (light and dark). |
| `popup.html` / `popup.js` | Token settings plus the “Inspect this page” button. |

## Notes

- Thresholds are per category, so a page can be highlighted for one category and clean for another.
- The card is injected into the page DOM with `z-index: 10003`, so page styles cannot hide it.
- Errors (missing token, HTTP failures, pages without readable text) are shown in a small
  self-dismissing toast and never break the page.

