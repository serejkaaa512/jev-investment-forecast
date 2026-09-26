// Jev Projects Review — content script.
//
// The only feature of the extension: inspect the current page. The readable
// text of the page is collected, sent to the Jev API through the background
// service worker, and the answer is rendered as a floating card that shows one
// percentage per configured detection threshold.

const MIN_CHAR_LENGTH = 30;
const MAX_CHAR_LENGTH = 4000;

const CARD_TOP = 80;
const CARD_RIGHT = 20;
const TOAST_TIMEOUT_MS = 5000;
const STRONG_MATCH = 0.8;

// Innermost content blocks only: an element that nests another target is
// skipped so the same text never lands in the payload twice.
const TARGET_SELECTOR =
  'p, article, section, li, [role="article"], .tm-articles-list__item, ' +
  '.tm-article-presenter, .article-snippet, .tm-comment-thread__comment, .tm-comment';

// Navigation and other page furniture that never carries the page meaning.
const NOISE_SELECTOR =
  'nav, footer, header, script, style, noscript, form, .tm-page-sidebar, .tm-navbar';

// Threshold per detection category; a category is flagged when its probability
// is greater than or equal to the threshold configured in the popup.
const DEFAULT_THRESHOLDS = {
  is_fraud: 0.5,
  is_advertising: 0.2,
  is_ai_generated: 0.25,
  is_spam: 0.25,
  is_clickbait: 0.2,
  is_infobusiness: 0.25,
  is_toxic: 0.25,
  is_plagiat: 0.25
};

// Row order inside the result card.
const CATEGORIES = [
  { flag: 'is_fraud', label: '⚠️ Fraud', theme: 'jev-theme-fraud' },
  { flag: 'is_advertising', label: '📢 Advertising', theme: 'jev-theme-ad' },
  { flag: 'is_ai_generated', label: '🤖 AI generation', theme: 'jev-theme-ai' },
  { flag: 'is_spam', label: '🚫 Spam', theme: 'jev-theme-spam' },
  { flag: 'is_clickbait', label: '🪤 Clickbait', theme: 'jev-theme-clickbait' },
  { flag: 'is_infobusiness', label: '💎 Infobusiness', theme: 'jev-theme-infobiz' },
  { flag: 'is_toxic', label: '🤬 Toxicity', theme: 'jev-theme-toxic' },
  { flag: 'is_plagiat', label: '📕 Plagiat', theme: 'jev-theme-plagiat' }
];

let thresholds = { ...DEFAULT_THRESHOLDS };
let card = null;
let toastTimer = null;

/** Keeps only known categories with a threshold inside (0, 1]. */
function normalizeThresholds(stored) {
  const normalized = { ...DEFAULT_THRESHOLDS };
  if (!stored) return normalized;

  for (const { flag } of CATEGORIES) {
    const value = stored[flag];
    if (typeof value === 'number' && value > 0 && value <= 1) normalized[flag] = value;
  }
  return normalized;
}

chrome.storage.local.get(['jevThresholds'], (result) => {
  thresholds = normalizeThresholds(result.jevThresholds);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.jevThresholds) return;
  thresholds = normalizeThresholds(changes.jevThresholds.newValue);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'inspectPage') {
    inspectPage();
    sendResponse({ ok: true });
  }
});

/** Collects the readable text of the page, capped at the API payload limit. */
function collectPageText() {
  const chunks = [];
  for (const element of document.body.querySelectorAll(TARGET_SELECTOR)) {
    if (element.closest(NOISE_SELECTOR)) continue;
    if (element.querySelector(TARGET_SELECTOR)) continue;

    const text = (element.innerText || '').replace(/\s+/g, ' ').trim();
    if (text.length >= MIN_CHAR_LENGTH) chunks.push(text);
  }
  return chunks.join(' ').slice(0, MAX_CHAR_LENGTH);
}

/** Inspects the page and renders one percentage row per threshold. */
function inspectPage() {
  removeCard();

  const pageText = collectPageText();
  if (!pageText) {
    showToast('No readable text found on this page.');
    return;
  }

  card = createCard();
  card.list.appendChild(buildLoadingRow());
  document.body.appendChild(card.element);

  chrome.runtime.sendMessage({ action: 'analyzePage', text: pageText }, (response) => {
    removeCard();

    if (chrome.runtime.lastError) {
      showToast(chrome.runtime.lastError.message);
      return;
    }

    if (!response || response.error) {
      showToast(response && response.error ? response.error : 'Page inspection failed.');
      return;
    }

    const results = response.results || {};
    card = createCard();
    for (const category of CATEGORIES) {
      const threshold = thresholds[category.flag];
      const probability = getProbability(results[category.flag]);

      card.list.appendChild(buildRow(category, probability, threshold));
      card.lines.push(
        `${category.label} ${formatPercent(probability)} (threshold ${Math.round(threshold * 100)}%)`
      );
    }
    document.body.appendChild(card.element);
  });
}

/** Converts a Jev API answer into a probability between 0 and 1, or null. */
function getProbability(answer) {
  if (answer === undefined || answer === null) return null;
  if (typeof answer === 'boolean') return answer ? 1 : 0;

  const raw =
    typeof answer === 'object' ? (answer.noul ?? answer.probability ?? answer.value) : answer;
  if (typeof raw === 'boolean') return raw ? 1 : 0;

  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return null;
  return clamp01(numeric > 1 ? numeric / 100 : numeric);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function formatPercent(probability) {
  return probability === null ? '—' : `${Math.round(probability * 100)}%`;
}

/** Floating card skeleton: header, actions and the row list. */
function createCard() {
  const element = document.createElement('div');
  element.className = 'jev-inspect-card';
  element.style.top = `${CARD_TOP}px`;
  element.style.right = `${CARD_RIGHT}px`;

  const header = document.createElement('div');
  header.className = 'jev-inspect-header';

  const title = document.createElement('span');
  title.className = 'jev-inspect-title';
  title.textContent = '🔍 Page inspection (Jev)';

  const actions = document.createElement('div');
  actions.className = 'jev-inspect-actions';

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'jev-inspect-copy';
  copyButton.textContent = 'Copy';
  copyButton.title = 'Copy the percentages';

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'jev-inspect-close';
  closeButton.textContent = '×';
  closeButton.title = 'Close';

  actions.append(copyButton, closeButton);
  header.append(title, actions);

  const list = document.createElement('div');
  list.className = 'jev-inspect-list';

  element.append(header, list);

  const state = { element, list, lines: [] };
  closeButton.addEventListener('click', removeCard);
  copyButton.addEventListener('click', () => copyLines(state, copyButton));

  return state;
}

/** Row shown while the page is being analyzed. */
function buildLoadingRow() {
  const row = document.createElement('div');
  row.className = 'jev-inspect-row jev-inspect-loading';
  row.textContent = 'Inspecting the page…';
  return row;
}

/** One threshold row: label, percentage, progress bar and the threshold value. */
function buildRow(category, probability, threshold) {
  const row = document.createElement('div');
  row.className = `jev-inspect-row ${category.theme}`;

  const head = document.createElement('div');
  head.className = 'jev-inspect-row-head';

  const label = document.createElement('span');
  label.className = 'jev-inspect-label';
  label.textContent = category.label;

  const value = document.createElement('span');
  value.className = 'jev-inspect-value';
  value.textContent = formatPercent(probability);

  head.append(label, value);

  const bar = document.createElement('div');
  bar.className = 'jev-inspect-bar';

  const fill = document.createElement('span');
  fill.className = 'jev-inspect-fill';
  fill.style.width = probability === null ? '0%' : `${Math.round(clamp01(probability) * 100)}%`;
  bar.appendChild(fill);

  const thresholdLine = document.createElement('div');
  thresholdLine.className = 'jev-inspect-threshold';
  thresholdLine.textContent = `threshold ${Math.round(threshold * 100)}%`;

  row.append(head, bar, thresholdLine);

  if (probability !== null && probability >= threshold) row.classList.add('is-flagged');
  if (probability !== null && probability >= STRONG_MATCH) row.classList.add('is-critical');

  return row;
}

/** Copies the rendered percentages to the clipboard. */
function copyLines(state, button) {
  const text = state.lines.length ? state.lines.join('\n') : 'No percentages yet.';

  copyText(text)
    .then(() => {
      button.textContent = '✓';
      setTimeout(() => {
        button.textContent = 'Copy';
      }, 1200);
    })
    .catch(() => showToast('Could not copy the percentages.'));
}

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);

  const area = document.createElement('textarea');
  area.value = text;
  area.className = 'jev-inspect-clipboard';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
  return Promise.resolve();
}

/** Removes the result card if one is on screen. */
function removeCard() {
  if (!card) return;

  card.element.remove();
  card = null;
}

/** Small self-dismissing message used for errors and hints. */
function showToast(message) {
  const existing = document.querySelector('.jev-inspect-toast');
  if (existing) existing.remove();
  if (toastTimer) clearTimeout(toastTimer);

  const toast = document.createElement('div');
  toast.className = 'jev-inspect-toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  toastTimer = setTimeout(() => toast.remove(), TOAST_TIMEOUT_MS);
}

