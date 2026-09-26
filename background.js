// Jev Projects Review — background service worker.
//
// The extension has a single feature: inspect a page. When the user asks for it
// (context menu item or the popup button) the content script of the tab is told
// to inspect the page, and the collected page text comes back here to be sent
// to the Jev API. The returned probabilities are handed to the content script,
// which renders the percentage card.

const INSPECT_MENU_ID = 'jev-inspect-page';
const API_URL = 'https://api.typesafe.ai/v1/systemone';
const API_MODEL = 'jev-latest';

// One detection question per threshold. `noul` answers come back as a
// probability between 0 and 1.
const CATEGORY_QUESTIONS = {
  is_fraud: 'Does this text contain phishing attempts, malicious scams, or fraudulent financial setups?',
  is_advertising: 'Is this text a paid advertisement, sponsored message, or tracking promotion?',
  is_ai_generated: 'Is this content low-effort, structurally repetitive AI-generated slop?',
  is_spam: 'Is this contextless clutter, repeated bot phrases, or automated spam?',
  is_clickbait: 'Is this text clickbait, a shocking headline, or bait for a click or Telegram-channel subscription?',
  is_infobusiness: "Does this text show signs of infobusiness, aggressive course selling, 'success gurus', marathons, or questionable mentorship?",
  is_toxic: 'Does this text contain open insults, harsh toxicity, profanity, hate incitement, or aggressive hate?',
  is_plagiat: 'Is this text plagiarized, near-duplicated from another source, or lifted content without attribution?'
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: INSPECT_MENU_ID,
    title: 'Jev: inspect page',
    contexts: ['page']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== INSPECT_MENU_ID || !tab || !tab.id) return;
  inspectTab(tab.id);
});

/** Asks the content script of a tab to inspect the page it is running in. */
function inspectTab(tabId) {
  chrome.tabs.sendMessage(tabId, { action: 'inspectPage' }, () => {
    void chrome.runtime.lastError;
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Popup button: inspect the tab the user is looking at right now.
  if (request.action === 'inspectActiveTab') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        sendResponse({ error: 'No active tab to inspect.' });
        return;
      }

      inspectTab(tab.id);
      sendResponse({ ok: true });
    });
    return true;
  }

  // Content script: run the Jev API request for the collected page text.
  if (request.action === 'analyzePage') {
    analyzePage(request.text)
      .then((results) => sendResponse({ success: true, results }))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  return undefined;
});

/**
 * Requests the probability of every detection category for the given text.
 *
 * @param {string} pageText Text collected from the page.
 * @returns {Promise<Object>} Category flag mapped to the API answer.
 * @throws {Error} When the API token is missing or the request fails.
 */
async function analyzePage(pageText) {
  if (!pageText) return {};

  const { jevApiKey } = await chrome.storage.local.get(['jevApiKey']);
  if (!jevApiKey) {
    throw new Error('Missing API key. Open the extension popup and add your TypeSafe Jev token.');
  }

  const questions = {};
  for (const [flag, instructions] of Object.entries(CATEGORY_QUESTIONS)) {
    questions[flag] = { type: 'noul', instructions };
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jevApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model: API_MODEL, state: pageText, questions })
  });

  if (!response.ok) {
    let message = `HTTP error! status: ${response.status}`;
    try {
      const errorData = await response.json();
      if (errorData && (errorData.message || errorData.error)) {
        message = errorData.message || errorData.error.message || message;
      }
    } catch (_) {
      // Keep the generic HTTP message when the body is not JSON.
    }
    throw new Error(message);
  }

  const data = await response.json();
  return data.answers || data.results || {};
}

