// Options page script for AsizweAI
import { Storage } from '../utils/storage.js';

class OptionsController {
  constructor() {
    this.elements = {
      // API Keys
      openaiApiKey: document.getElementById('openaiApiKey'),
      deepgramApiKey: document.getElementById('deepgramApiKey'),
      elevenLabsApiKey: document.getElementById('elevenLabsApiKey'),

      // Providers
      sttProvider: document.getElementById('sttProvider'),
      translationProvider: document.getElementById('translationProvider'),
      ttsProvider: document.getElementById('ttsProvider'),
      ttsVoicePreset: document.getElementById('ttsVoicePreset'),
      ttsVoiceId: document.getElementById('ttsVoiceId'),
      ttsSpeed: document.getElementById('ttsSpeed'),
      ttsSpeedValue: document.getElementById('ttsSpeedValue'),

      // Buttons
      saveSettings: document.getElementById('saveSettings'),
      testConnection: document.getElementById('testConnection'),

      // Status
      statusMessage: document.getElementById('statusMessage')
    };

    this.init();
  }

  async init() {
    await this.loadSettings();
    this.attachEventListeners();
  }

  async loadSettings() {
    const settings = await Storage.getSettings();

    // Load API keys
    if (settings.openaiApiKey) {
      this.elements.openaiApiKey.value = settings.openaiApiKey;
    }
    if (settings.deepgramApiKey) {
      this.elements.deepgramApiKey.value = settings.deepgramApiKey;
    }
    if (settings.elevenLabsApiKey) {
      this.elements.elevenLabsApiKey.value = settings.elevenLabsApiKey;
    }

    // Load providers
    if (settings.sttProvider) {
      this.elements.sttProvider.value = settings.sttProvider;
    }
    if (settings.translationProvider) {
      this.elements.translationProvider.value = settings.translationProvider;
    }
    if (settings.ttsProvider) {
      this.elements.ttsProvider.value = settings.ttsProvider;
    }
    if (settings.ttsVoiceId) {
      this.elements.ttsVoiceId.value = settings.ttsVoiceId;
      // Try to match preset
      const presetOption = Array.from(this.elements.ttsVoicePreset.options).find(
        opt => opt.value === settings.ttsVoiceId
      );
      if (presetOption) {
        this.elements.ttsVoicePreset.value = settings.ttsVoiceId;
      } else if (settings.ttsVoiceId) {
        this.elements.ttsVoicePreset.value = 'custom';
      }
    }
    if (settings.ttsSpeed) {
      this.elements.ttsSpeed.value = settings.ttsSpeed;
      this.elements.ttsSpeedValue.textContent = `${settings.ttsSpeed}x`;
    }
  }

  attachEventListeners() {
    // Toggle password visibility
    document.querySelectorAll('.toggle-visibility').forEach(btn => {
      btn.addEventListener('click', () => this.toggleVisibility(btn));
    });

    // Speed slider
    this.elements.ttsSpeed.addEventListener('input', (e) => {
      this.elements.ttsSpeedValue.textContent = `${e.target.value}x`;
    });

    // Voice preset selector
    this.elements.ttsVoicePreset.addEventListener('change', (e) => {
      const value = e.target.value;
      if (value && value !== 'custom') {
        this.elements.ttsVoiceId.value = value;
      } else if (value === 'custom') {
        this.elements.ttsVoiceId.value = '';
        this.elements.ttsVoiceId.focus();
      }
    });

    // Save button
    this.elements.saveSettings.addEventListener('click', () => this.saveSettings());

    // Test connection button
    this.elements.testConnection.addEventListener('click', () => this.testConnection());
  }

  toggleVisibility(btn) {
    const targetId = btn.dataset.target;
    const input = document.getElementById(targetId);

    if (input.type === 'password') {
      input.type = 'text';
      btn.classList.add('visible');
    } else {
      input.type = 'password';
      btn.classList.remove('visible');
    }
  }

  async saveSettings() {
    const btn = this.elements.saveSettings;
    btn.classList.add('loading');

    try {
      const openaiApiKey = this.elements.openaiApiKey.value.trim();
      const deepgramApiKey = this.elements.deepgramApiKey.value.trim();
      const elevenLabsApiKey = this.elements.elevenLabsApiKey.value.trim();
      const sttProvider = this.elements.sttProvider.value;
      const translationProvider = this.elements.translationProvider.value;
      const ttsProvider = this.elements.ttsProvider.value;
      const ttsVoiceId = this.elements.ttsVoiceId.value.trim();
      const ttsSpeed = parseFloat(this.elements.ttsSpeed.value);

      // Validate required fields
      if (!openaiApiKey && sttProvider === 'openai') {
        this.showStatus('OpenAI API key is required when using OpenAI Whisper', 'error');
        btn.classList.remove('loading');
        return;
      }

      if (!deepgramApiKey && sttProvider === 'deepgram') {
        this.showStatus('Deepgram API key is required when using Deepgram', 'error');
        btn.classList.remove('loading');
        return;
      }

      if (!elevenLabsApiKey && sttProvider === 'elevenlabs') {
        this.showStatus('ElevenLabs API key is required when using ElevenLabs STT', 'error');
        btn.classList.remove('loading');
        return;
      }

      if (!elevenLabsApiKey && ttsProvider === 'elevenlabs') {
        this.showStatus('ElevenLabs API key is required when using ElevenLabs TTS', 'error');
        btn.classList.remove('loading');
        return;
      }

      // Save each setting individually to avoid quota limits
      // chrome.storage.sync has 8KB per item limit
      await chrome.storage.sync.set({ openaiApiKey });
      await chrome.storage.sync.set({ deepgramApiKey });
      await chrome.storage.sync.set({ elevenLabsApiKey });
      await chrome.storage.sync.set({ sttProvider });
      await chrome.storage.sync.set({ translationProvider });
      await chrome.storage.sync.set({ ttsProvider });
      await chrome.storage.sync.set({ ttsVoiceId });
      await chrome.storage.sync.set({ ttsSpeed });

      this.showStatus('Settings saved successfully!', 'success');
    } catch (error) {
      console.error('Error saving settings:', error);
      this.showStatus('Failed to save settings: ' + error.message, 'error');
    } finally {
      btn.classList.remove('loading');
    }
  }

  async testConnection() {
    const btn = this.elements.testConnection;
    btn.classList.add('loading');

    try {
      const openaiKey = this.elements.openaiApiKey.value.trim();

      if (!openaiKey) {
        this.showStatus('Please enter an OpenAI API key to test', 'error');
        return;
      }

      // Test OpenAI API key
      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${openaiKey}`
        }
      });

      if (response.ok) {
        this.showStatus('Connection successful! API key is valid.', 'success');
      } else if (response.status === 401) {
        this.showStatus('Invalid API key. Please check and try again.', 'error');
      } else {
        const error = await response.json();
        this.showStatus(`API Error: ${error.error?.message || 'Unknown error'}`, 'error');
      }
    } catch (error) {
      console.error('Connection test error:', error);
      this.showStatus('Connection failed: ' + error.message, 'error');
    } finally {
      btn.classList.remove('loading');
    }
  }

  showStatus(message, type) {
    this.elements.statusMessage.textContent = message;
    this.elements.statusMessage.className = `status-message ${type}`;

    // Auto-hide after 5 seconds
    setTimeout(() => {
      this.elements.statusMessage.classList.add('hidden');
    }, 5000);
  }
}

// Initialize options page
document.addEventListener('DOMContentLoaded', () => {
  new OptionsController();
});
