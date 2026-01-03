// Service Worker for AsizweAI
// Handles message routing, offscreen document management, and tab capture

console.log('[AsizweAI] Service worker starting...');

let offscreenDocumentCreated = false;
let isCapturing = false;
let currentTabId = null;
let currentSettings = {
  sourceLanguage: 'auto',
  targetLanguage: 'en',
  originalVolume: 30,
  translationVolume: 100
};

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Ignore messages from offscreen document that we're forwarding to popup
  if (sender.url && sender.url.includes('offscreen')) {
    // Handle debug logs from offscreen
    if (message.type === 'DEBUG_LOG') {
      console.log('[AsizweAI DEBUG]', message.message);
      sendResponse({ received: true });
      return false;
    }

    console.log('[AsizweAI] Message from offscreen:', message.type);
    // Forward to popup
    if (['CAPTURE_STARTED', 'CAPTURE_STOPPED', 'TRANSCRIPT_UPDATE', 'STATUS_UPDATE', 'ERROR'].includes(message.type)) {
      if (message.type === 'CAPTURE_STARTED') isCapturing = true;
      if (message.type === 'CAPTURE_STOPPED') isCapturing = false;
      broadcastToPopups(message);
    }
    sendResponse({ received: true });
    return false;
  }

  console.log('[AsizweAI] Service worker received message:', message.type);
  handleMessage(message, sender).then(sendResponse);
  return true; // Keep message channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'START_CAPTURE':
      console.log('[AsizweAI] START_CAPTURE received for tab:', message.tabId);
      return await handleStartCapture(message.tabId, message.settings);

    case 'STOP_CAPTURE':
      console.log('[AsizweAI] STOP_CAPTURE received');
      return await handleStopCapture();

    case 'GET_STATE':
      return {
        isCapturing,
        currentTabId,
        settings: currentSettings,
        status: isCapturing ? 'listening' : 'idle'
      };

    case 'UPDATE_SOURCE_LANG':
      currentSettings.sourceLanguage = message.language;
      await sendToOffscreen({ type: 'UPDATE_SOURCE_LANG', language: message.language });
      return { success: true };

    case 'UPDATE_TARGET_LANG':
      currentSettings.targetLanguage = message.language;
      await sendToOffscreen({ type: 'UPDATE_TARGET_LANG', language: message.language });
      return { success: true };

    case 'UPDATE_ORIGINAL_VOLUME':
      currentSettings.originalVolume = message.volume;
      await sendToOffscreen({ type: 'UPDATE_ORIGINAL_VOLUME', volume: message.volume });
      return { success: true };

    case 'UPDATE_TRANSLATION_VOLUME':
      currentSettings.translationVolume = message.volume;
      await sendToOffscreen({ type: 'UPDATE_TRANSLATION_VOLUME', volume: message.volume });
      return { success: true };

    default:
      console.log('[AsizweAI] Unknown message type:', message.type);
      return { error: 'Unknown message type' };
  }
}

async function handleStartCapture(tabId, settings) {
  try {
    console.log('[AsizweAI] handleStartCapture called');

    if (isCapturing) {
      console.log('[AsizweAI] Already capturing, stopping first...');
      await handleStopCapture();
    }

    // Update settings
    if (settings) {
      currentSettings = { ...currentSettings, ...settings };
      console.log('[AsizweAI] Settings updated:', currentSettings);
    }

    // Get stored API keys and other settings
    console.log('[AsizweAI] Loading stored settings...');
    const storedSettings = await chrome.storage.sync.get([
      'openaiApiKey',
      'deepgramApiKey',
      'elevenLabsApiKey',
      'sttProvider',
      'translationProvider',
      'ttsProvider',
      'ttsVoiceId',
      'ttsSpeed'
    ]);
    console.log('[AsizweAI] Stored settings loaded, OpenAI key present:', !!storedSettings.openaiApiKey);
    console.log('[AsizweAI] STT Provider from storage:', storedSettings.sttProvider);
    console.log('[AsizweAI] Deepgram key present:', !!storedSettings.deepgramApiKey);
    console.log('[AsizweAI] ElevenLabs key present:', !!storedSettings.elevenLabsApiKey);

    // Merge all settings
    const fullSettings = {
      ...currentSettings,
      ...storedSettings
    };
    console.log('[AsizweAI] Full settings sttProvider:', fullSettings.sttProvider);

    // Create offscreen document if needed
    console.log('[AsizweAI] Ensuring offscreen document exists...');
    await ensureOffscreenDocument();
    console.log('[AsizweAI] Offscreen document ready');

    // Get the media stream ID for tab capture
    console.log('[AsizweAI] Getting media stream ID for tab:', tabId);
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId
    });

    if (!streamId) {
      console.error('[AsizweAI] Failed to get stream ID');
      return { error: 'Failed to get media stream ID' };
    }
    console.log('[AsizweAI] Got stream ID:', streamId.substring(0, 20) + '...');

    currentTabId = tabId;

    // Send stream ID and full settings to offscreen document
    console.log('[AsizweAI] Sending START_PROCESSING to offscreen with settings...');
    const response = await sendToOffscreen({
      type: 'START_PROCESSING',
      streamId: streamId,
      settings: fullSettings
    });

    console.log('[AsizweAI] START_PROCESSING response:', response);

    if (response && response.error) {
      return { error: response.error };
    }

    return { success: true };

  } catch (error) {
    console.error('[AsizweAI] Error starting capture:', error);
    console.error('[AsizweAI] Error stack:', error.stack);

    // Provide helpful error message
    if (error.message.includes('activeTab') || error.message.includes('invoked')) {
      return { error: 'Please navigate to a regular website (like YouTube) first. Chrome system pages cannot be captured.' };
    }

    return { error: error.message };
  }
}

async function handleStopCapture() {
  try {
    console.log('[AsizweAI] handleStopCapture called');
    await sendToOffscreen({ type: 'STOP_PROCESSING' });
    isCapturing = false;
    currentTabId = null;
    return { success: true };
  } catch (error) {
    console.error('[AsizweAI] Error stopping capture:', error);
    return { error: error.message };
  }
}

async function ensureOffscreenDocument() {
  // Check if document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });

  if (existingContexts.length > 0) {
    console.log('[AsizweAI] Offscreen document already exists');
    offscreenDocumentCreated = true;
    return;
  }

  // Create the offscreen document
  console.log('[AsizweAI] Creating new offscreen document...');
  await chrome.offscreen.createDocument({
    url: 'offscreen/offscreen.html',
    reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
    justification: 'Audio capture from tab and playback for real-time translation'
  });

  offscreenDocumentCreated = true;
  console.log('[AsizweAI] Offscreen document created');

  // Wait for it to initialize
  console.log('[AsizweAI] Waiting for offscreen to initialize...');
  await new Promise(resolve => setTimeout(resolve, 1000));
  console.log('[AsizweAI] Offscreen should be ready now');
}

async function sendToOffscreen(message) {
  console.log('[AsizweAI] sendToOffscreen:', message.type);

  // Check if offscreen document exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });

  if (existingContexts.length === 0) {
    console.error('[AsizweAI] No offscreen document found!');
    throw new Error('Offscreen document not found');
  }

  try {
    const response = await chrome.runtime.sendMessage(message);
    console.log('[AsizweAI] Response from offscreen:', response);
    return response;
  } catch (error) {
    console.error('[AsizweAI] Error sending to offscreen:', error.message);
    throw error;
  }
}

function broadcastToPopups(message) {
  // Send message to all extension popups/tabs
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup might be closed, ignore error
  });
}

// Handle extension install/update
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[AsizweAI] Extension installed/updated:', details.reason);

  if (details.reason === 'install') {
    console.log('[AsizweAI] First install, setting defaults');

    // Only set defaults on fresh install, not updates
    chrome.storage.sync.set({
      sttProvider: 'openai',
      translationProvider: 'openai',
      ttsProvider: 'native'
    }, () => {
      console.log('[AsizweAI] Provider defaults set to: openai/openai/native');
    });

    // Always ensure these defaults
    chrome.storage.sync.get(['ttsSpeed', 'sourceLanguage', 'targetLanguage', 'originalVolume', 'translationVolume'], (current) => {
      const defaults = {};
      if (!current.ttsSpeed) defaults.ttsSpeed = 1.0;
      if (!current.sourceLanguage) defaults.sourceLanguage = 'auto';
      if (!current.targetLanguage) defaults.targetLanguage = 'en';
      if (current.originalVolume === undefined) defaults.originalVolume = 30;
      if (current.translationVolume === undefined) defaults.translationVolume = 100;

      if (Object.keys(defaults).length > 0) {
        chrome.storage.sync.set(defaults);
      }
    });
  }
});

// Clean up on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === currentTabId && isCapturing) {
    console.log('[AsizweAI] Captured tab closed, stopping capture');
    handleStopCapture();
  }
});

console.log('[AsizweAI] Service worker initialized');
