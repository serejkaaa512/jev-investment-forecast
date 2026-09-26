document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const inspectBtn = document.getElementById('inspectBtn');
  const saveBtn = document.getElementById('saveBtn');
  const footnote = document.getElementById('footnote');

  // Default thresholds in percent, used when nothing is stored yet.
  const DEFAULT_THRESHOLDS = {
    is_fraud: 50,
    is_advertising: 20,
    is_ai_generated: 25,
    is_spam: 25,
    is_clickbait: 20,
    is_infobusiness: 25,
    is_toxic: 25,
    is_plagiat: 25
  };

  let savedTimer = null;
  let footnoteTimer = null;

  const fieldFor = (flag) => document.getElementById(`th_${flag}`);

  function showFootnote(message, isError) {
    if (footnoteTimer) clearTimeout(footnoteTimer);

    footnote.textContent = message;
    footnote.classList.toggle('error', Boolean(isError));

    if (!isError) {
      footnoteTimer = setTimeout(() => {
        footnote.textContent = footnote.dataset.tip;
        footnote.classList.remove('error');
      }, 4000);
    }
  }

  function flashSaved() {
    if (savedTimer) clearTimeout(savedTimer);

    saveBtn.classList.add('saved');
    savedTimer = setTimeout(() => saveBtn.classList.remove('saved'), 1100);
  }

  chrome.storage.local.get(['jevApiKey', 'jevThresholds'], (result) => {
    if (result.jevApiKey) apiKeyInput.value = result.jevApiKey;

    const stored = result.jevThresholds || {};
    for (const [flag, fallback] of Object.entries(DEFAULT_THRESHOLDS)) {
      const input = fieldFor(flag);
      if (!input) continue;

      const value = stored[flag];
      input.value =
        typeof value === 'number' && value > 0 && value <= 1 ? Math.round(value * 100) : fallback;
    }
  });

  inspectBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'inspectActiveTab' }, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        showFootnote(error.message, true);
        return;
      }

      if (!response || response.error) {
        showFootnote(
          response && response.error ? response.error : 'Could not inspect this page.',
          true
        );
        return;
      }

      showFootnote('Inspecting the page — the percentage card appears on the page.', false);
    });
  });

  saveBtn.addEventListener('click', () => {
    const thresholds = {};

    for (const flag of Object.keys(DEFAULT_THRESHOLDS)) {
      const percent = Number(fieldFor(flag).value);
      if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
        showFootnote('Every threshold must be a number between 1 and 100.', true);
        return;
      }
      thresholds[flag] = percent / 100;
    }

    chrome.storage.local.set(
      { jevApiKey: apiKeyInput.value.trim(), jevThresholds: thresholds },
      flashSaved
    );
  });

  footnote.dataset.tip = footnote.textContent;
});

