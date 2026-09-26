# Jev Projects Review

A Chrome extension (Manifest V3) with a single job: **inspect the page you are on and show a
percentage score for every detection threshold**, powered by the TypeSafe Jev API
(`https://api.typesafe.ai/v1/systemone`).

Right-click anywhere on a page and choose **“Jev: inspect page”**, or open the extension popup and
press **“Inspect this page”**. A card appears in the top-right corner of the page with one row per
threshold:

| Row | Default threshold |
| --- | --- |
| ⚠️ Fraud | 50% |
| 📢 Advertising | 20% |
| 🤖 AI generation | 25% |
| 🚫 Spam | 25% |
| 🪤 Clickbait | 20% |
| 💎 Infobusiness | 25% |
| 🤬 Toxicity | 25% |
| 📕 Plagiat | 25% |

Every row shows the percentage returned by the API, a progress bar and the threshold it is compared
with. A row is highlighted when its percentage reaches the threshold (highlighted more strongly from
80% up). The card can be copied to the clipboard with **Copy** or closed with **×**.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Open the extension popup, paste your TypeSafe Jev API token and press **Save settings**.
   Without a token the card reports `Missing API key…`.

## Settings

- **TypeSafe Jev API token** — sent as `Authorization: Bearer <token>` with every request and stored
  in `chrome.storage.local` under `jevApiKey`.
- **Detection thresholds (%)** — the value each category percentage is compared with, per category,
  between 1 and 100. Stored under `jevThresholds` as fractions (`0.5` for `50%`).

## How it works

1. `background.js` registers the context menu item **“Jev: inspect page”** and handles two messages:
   `inspectActiveTab` (from the popup) and `analyzePage` (from the content script).
2. The content script collects the readable text of the page: innermost elements matching
   `TARGET_SELECTOR` (`p`, `article`, `section`, `li`, …), skipping anything inside
   `NOISE_SELECTOR` (`nav`, `footer`, `header`, `form`, …), blocks shorter than 30 characters and
   everything past 4 000 characters.
3. The text is POSTed to the Jev API as one `state` with eight `noul` questions (`is_fraud`,
   `is_advertising`, `is_ai_generated`, `is_spam`, `is_clickbait`, `is_infobusiness`, `is_toxic`,
   `is_plagiat`).
4. `content.js` turns every answer into a probability (0–1), compares it with the matching threshold
   and renders the percentage card.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest — permissions: `storage`, `activeTab`, `contextMenus`. |
| `background.js` | Context menu, popup routing and the Jev API request. |
| `content.js` | Page text collection and the percentage card. |
| `styles.css` | Styles for the card (light and dark). |
| `popup.html` / `popup.js` | Token and threshold settings plus the “Inspect this page” button. |

## Notes

- Thresholds are per category, so a page can be flagged for one category and clean for another.
- The card is injected into the page DOM with `z-index: 10003`, so page styles cannot hide it.
- Errors (missing token, HTTP failures, pages without readable text) are shown in a small
  self-dismissing toast and never break the page.

