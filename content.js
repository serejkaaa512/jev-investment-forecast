// Jev Projects Review — content script.
//
// The only feature of the extension: inspect the current page. The readable
// text of the page is collected, sent to the Jev API through the background
// service worker, and the answer is rendered as a floating card that shows one
// percentage per detection category.

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

// Built-in threshold per detection category: a row is highlighted when its
// probability reaches the constant below. Positive-value categories (novelty,
// scalability, …) use a stricter 50% so only strongly valuable pages light up,
// risk categories use 25%. Not user-configurable — it lives here only.
const THRESHOLDS = {
  is_fraud: 0.5,
  is_advertising: 0.2,
  is_ai_generated: 0.25,
  is_spam: 0.25,
  is_clickbait: 0.2,
  is_infobusiness: 0.25,
  is_toxic: 0.25,
  is_plagiat: 0.25,
  is_novel: 0.5,
  is_promising: 0.5,
  is_scalable: 0.5,
  is_monetizable: 0.5,
  is_expert: 0.5,
  is_actionable: 0.5,
  is_trendy: 0.5,
  is_nsfw: 0.25,
  is_hate_speech: 0.25,
  is_fake_news: 0.25,
  is_gambling: 0.25,
  is_shilling: 0.25,
  is_pseudoscience: 0.25,
  is_offtopic: 0.25,
  is_feasible: 0.5,
  is_high_risk: 0.25,
  is_ethical: 0.5,
  is_well_designed: 0.5,
  is_clear: 0.5
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
  { flag: 'is_plagiat', label: '📕 Plagiat', theme: 'jev-theme-plagiat' },
  { flag: 'is_novel', label: '✨ Novelty', theme: 'jev-theme-novel' },
  { flag: 'is_promising', label: '🚀 Promising Potential', theme: 'jev-theme-promising' },
  { flag: 'is_scalable', label: '🌐 Scalability', theme: 'jev-theme-scale' },
  { flag: 'is_monetizable', label: '💰 Monetizable', theme: 'jev-theme-monetize' },
  { flag: 'is_expert', label: '🎓 Expert Depth', theme: 'jev-theme-expert' },
  { flag: 'is_actionable', label: '🛠️ Practical Value', theme: 'jev-theme-practical' },
  { flag: 'is_trendy', label: '🔥 Viral / Trendy', theme: 'jev-theme-trendy' },
  { flag: 'is_nsfw', label: '🔞 NSFW / Adult', theme: 'jev-theme-nsfw' },
  { flag: 'is_hate_speech', label: '🗣️ Hate Speech', theme: 'jev-theme-hate' },
  { flag: 'is_fake_news', label: '📰 Fake News', theme: 'jev-theme-fake' },
  { flag: 'is_gambling', label: '🎰 Gambling / Betting', theme: 'jev-theme-gambling' },
  { flag: 'is_shilling', label: '🚀 Shilling / Crypto-Pump', theme: 'jev-theme-shill' },
  { flag: 'is_pseudoscience', label: '🔮 Pseudoscience', theme: 'jev-theme-pseudo' },
  { flag: 'is_offtopic', label: '📌 Off-topic', theme: 'jev-theme-offtopic' },
  { flag: 'is_feasible', label: '🛠️ Feasible', theme: 'jev-theme-feasible' },
  { flag: 'is_high_risk', label: '💣 High Risk', theme: 'jev-theme-risk' },
  { flag: 'is_ethical', label: '🌱 Sustainable', theme: 'jev-theme-ethical' },
  { flag: 'is_well_designed', label: '🎨 High Quality UI/UX', theme: 'jev-theme-design' },
  { flag: 'is_clear', label: '🎯 Clear & Concise', theme: 'jev-theme-clear' }
];

let card = null;
let toastTimer = null;

// Display metadata for the choice-type questions shown in a separate block.
// `key` is the criteria key sent by background.js; `label` is the human text
// shown on screen for that option.
const CHOICE_DISPLAY = [
  {
    flag: 'investment_amount',
    label: '💵 Recommended Investment',
    options: [
      { key: '1k dollars', label: '1k dollars' },
      { key: '10k dollars', label: '10k dollars' },
      { key: '100k dollars', label: '100k dollars' },
      { key: '1m dollars', label: '1m dollars' }
    ]
  },
  {
    flag: 'investment_duration',
    label: '⏳ Recommended Timeframe',
    options: [
      { key: '1m', label: '1 month' },
      { key: '1y', label: '1 year' },
      { key: '3y', label: '3 years' },
      { key: '10y', label: '10 years' }
    ]
  }
];

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

/** Inspects the page and renders one percentage row per category. */
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
      const probability = getProbability(results[category.flag]);

      card.list.appendChild(buildRow(category, probability));
      card.lines.push(`${category.label} ${formatPercent(probability)}`);
    }

    // Append the choice-results block below the category list.
    const choiceBlock = createChoiceBlock(results);
    card.element.appendChild(choiceBlock);

    for (const item of CHOICE_DISPLAY) {
      const answer = results[item.flag];
      const chosen = getChoiceAnswer(answer);
      const probabilities = getChoiceProbabilities(answer);

      card.lines.push(`${item.label} ${chosen ? getChoiceLabel(item, chosen) : '—'}`);
      for (const option of item.options) {
        card.lines.push(`  ${option.label} ${formatPercent(probabilities[option.key] ?? null)}`);
      }
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

/** Extracts the chosen criteria key from a Jev choice-type API response. */
function getChoiceAnswer(answer) {
  if (answer === undefined || answer === null) return null;
  if (typeof answer === 'string') return answer;
  if (typeof answer === 'object') {
    return answer.choice ?? answer.selected ?? answer.value ?? answer.answer ?? null;
  }
  return String(answer);
}

/** Every option probability of a choice-type answer, keyed by criteria key. */
function getChoiceProbabilities(answer) {
  if (!answer || typeof answer !== 'object' || !answer.probabilities) return {};
  return answer.probabilities;
}

/** Human label for a criteria key of a displayed choice question. */
function getChoiceLabel(item, key) {
  const option = item.options.find((entry) => entry.key === key);
  return option ? option.label : key;
}

/** Builds the investment-recommendation block shown below the category list. */
function createChoiceBlock(results) {
  const block = document.createElement('div');
  block.className = 'jev-choice-block';

  const header = document.createElement('div');
  header.className = 'jev-choice-header';
  header.textContent = '📊 Investment Recommendation';
  block.appendChild(header);

  const list = document.createElement('div');
  list.className = 'jev-choice-list';

  for (const item of CHOICE_DISPLAY) {
    const answer = results[item.flag];
    const chosen = getChoiceAnswer(answer);
    const probabilities = getChoiceProbabilities(answer);

    const row = document.createElement('div');
    row.className = 'jev-choice-row';

    const head = document.createElement('div');
    head.className = 'jev-choice-row-head';

    const label = document.createElement('span');
    label.className = 'jev-choice-label';
    label.textContent = item.label;

    const value = document.createElement('span');
    value.className = 'jev-choice-value';
    value.textContent = chosen ? getChoiceLabel(item, chosen) : '—';

    head.append(label, value);
    row.appendChild(head);

    // One line per option: label, probability and a bar; the chosen one is highlighted.
    const options = document.createElement('div');
    options.className = 'jev-choice-options';

    for (const option of item.options) {
      const probability = probabilities[option.key] ?? null;

      const optionRow = document.createElement('div');
      optionRow.className = 'jev-choice-option';
      if (chosen && option.key === chosen) optionRow.classList.add('is-selected');

      const optionHead = document.createElement('div');
      optionHead.className = 'jev-choice-option-head';

      const optionLabel = document.createElement('span');
      optionLabel.className = 'jev-choice-option-label';
      optionLabel.textContent = option.label;

      const optionValue = document.createElement('span');
      optionValue.className = 'jev-choice-option-value';
      optionValue.textContent = formatPercent(probability);

      optionHead.append(optionLabel, optionValue);

      const bar = document.createElement('div');
      bar.className = 'jev-inspect-bar';

      const fill = document.createElement('span');
      fill.className = 'jev-inspect-fill';
      fill.style.width = probability === null ? '0%' : `${Math.round(clamp01(probability) * 100)}%`;
      bar.appendChild(fill);

      optionRow.append(optionHead, bar);
      options.appendChild(optionRow);
    }

    row.appendChild(options);
    list.appendChild(row);
  }

  block.appendChild(list);
  return block;
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

/** One category row: label, percentage and progress bar. */
function buildRow(category, probability) {
  const threshold = THRESHOLDS[category.flag];

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

  row.append(head, bar);

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

