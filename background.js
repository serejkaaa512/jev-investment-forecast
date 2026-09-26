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

// One detection question per category. `noul` answers come back as a
// probability between 0 and 1.
const CATEGORY_QUESTIONS = {
  is_fraud: 'Does this text contain phishing attempts, malicious scams, or fraudulent financial setups?',
  is_advertising: 'Is this text a paid advertisement, sponsored message, or tracking promotion?',
  is_ai_generated: 'Is this content low-effort, structurally repetitive AI-generated slop?',
  is_spam: 'Is this contextless clutter, repeated bot phrases, or automated spam?',
  is_clickbait: 'Is this text clickbait, a shocking headline, or bait for a click or Telegram-channel subscription?',
  is_infobusiness: "Does this text show signs of infobusiness, aggressive course selling, 'success gurus', marathons, or questionable mentorship?",
  is_toxic: 'Does this text contain open insults, harsh toxicity, profanity, hate incitement, or aggressive hate?',
  is_plagiat: 'Is this text plagiarized, near-duplicated from another source, or lifted content without attribution?',
  is_novel: 'Does this text present genuinely novel ideas, original research, or an unusual angle instead of well-known material?',
  is_promising: 'Does this text describe an idea, project, or opportunity with strong potential for future growth or success?',
  is_scalable: 'Does this text describe something that can grow to a much larger audience, market, or workload?',
  is_monetizable: 'Does this text show a clear way to make money, a monetizable product, service, or business model?',
  is_expert: 'Does this text show deep expert-level knowledge, precise technical detail, or specialist insight?',
  is_actionable: 'Does this text give concrete, practical steps the reader can apply right away?',
  is_trendy: 'Is this text riding a current viral trend, a hot topic, or fast-spreading hype?',
  is_nsfw: 'Does this text contain explicit sexual content, adult material, or NSFW language?',
  is_hate_speech: 'Does this text contain hate speech, slurs, or attacks on people because of their identity?',
  is_fake_news: 'Does this text spread fake news, fabricated facts, or deliberately misleading claims?',
  is_gambling: 'Does this text promote gambling, betting, casinos, or games of chance?',
  is_shilling: 'Is this text shilling or pumping a token, project, or product for hidden profit?',
  is_pseudoscience: 'Does this text promote pseudoscience, unproven remedies, or paranormal claims as fact?',
  is_offtopic: 'Is this text off-topic and unrelated to the main subject of the page?',
  is_feasible: 'Does this text describe an idea or project that is technically feasible and realistically achievable?',
  is_high_risk: 'Does this text involve high risk, such as financial loss, legal trouble, safety hazards, or very uncertain outcomes?',
  is_ethical: 'Does this text promote sustainability, environmental responsibility, or ethical business practices?',
  is_well_designed: 'Does this text describe a product or interface with thoughtful, high-quality UI/UX design?',
  is_clear: 'Is this text clear and concise, with a direct message and no unnecessary filler?'
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

