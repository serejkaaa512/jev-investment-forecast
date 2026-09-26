document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const inspectBtn = document.getElementById('inspectBtn');
  const saveBtn = document.getElementById('saveBtn');
  const footnote = document.getElementById('footnote');

  let savedTimer = null;
  let footnoteTimer = null;

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

  chrome.storage.local.get(['jevApiKey'], (result) => {
    if (result.jevApiKey) apiKeyInput.value = result.jevApiKey;
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
    chrome.storage.local.set({ jevApiKey: apiKeyInput.value.trim() }, flashSaved);
  });

  footnote.dataset.tip = footnote.textContent;
});

