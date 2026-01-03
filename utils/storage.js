// Chrome Storage Utility
export const Storage = {
  async get(keys) {
    return chrome.storage.sync.get(keys);
  },

  async set(data) {
    return chrome.storage.sync.set(data);
  },

  async remove(keys) {
    return chrome.storage.sync.remove(keys);
  },

  async clear() {
    return chrome.storage.sync.clear();
  },

  async getSettings() {
    return this.get([
      // API Keys
      'openaiApiKey',
      'deepgramApiKey',
      'elevenLabsApiKey',

      // Providers
      'sttProvider',
      'translationProvider',
      'ttsProvider',
      'ttsVoiceId',
      'ttsSpeed',

      // Language preferences
      'sourceLanguage',
      'targetLanguage',

      // Volume settings
      'originalVolume',
      'translationVolume'
    ]);
  },

  async saveSettings(settings) {
    return this.set(settings);
  },

  // Helper to check if API keys are configured
  async hasRequiredKeys() {
    const settings = await this.getSettings();
    const provider = settings.sttProvider || 'openai';

    if (provider === 'openai') {
      return !!settings.openaiApiKey;
    } else if (provider === 'deepgram') {
      return !!settings.deepgramApiKey;
    }

    return true; // Web Speech API doesn't need keys
  }
};
