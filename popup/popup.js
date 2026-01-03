/**
 * AsizweAI Popup Controller
 * Premium UI with micro-interactions and enhanced UX
 */

import { Storage } from '../utils/storage.js';

class PopupController {
  constructor() {
    this.isCapturing = false;
    this.currentTabId = null;
    this.transcriptData = [];

    // Debounce timers
    this.volumeDebounceTimers = {
      original: null,
      translation: null
    };

    // Cache DOM elements
    this.elements = {
      // Control
      toggleBtn: document.getElementById('toggleBtn'),
      statusText: document.getElementById('statusText'),
      statusIndicator: document.getElementById('statusIndicator'),
      statusLabel: document.querySelector('.status-label'),

      // Language
      sourceLang: document.getElementById('sourceLang'),
      targetLang: document.getElementById('targetLang'),
      swapBtn: document.getElementById('swapBtn'),

      // Volume
      originalVolume: document.getElementById('originalVolume'),
      originalVolumeValue: document.getElementById('originalVolumeValue'),
      originalSliderFill: document.querySelector('#originalVolume ~ .slider-track .slider-fill'),
      translationVolume: document.getElementById('translationVolume'),
      translationVolumeValue: document.getElementById('translationVolumeValue'),
      translationSliderFill: document.querySelector('#translationVolume ~ .slider-track .slider-fill'),

      // Transcript
      transcriptDisplay: document.getElementById('transcriptDisplay'),
      clearTranscript: document.getElementById('clearTranscript'),
      copyTranscript: document.getElementById('copyTranscript'),

      // Settings & Error
      settingsBtn: document.getElementById('settingsBtn'),
      errorDisplay: document.getElementById('errorDisplay'),
      errorText: document.getElementById('errorText'),
      errorDismiss: document.getElementById('errorDismiss'),

      // Toast
      toast: document.getElementById('toast'),
      toastText: document.getElementById('toastText')
    };

    this.init();
  }

  async init() {
    await this.loadSettings();
    this.attachEventListeners();
    this.setupMessageListener();
    await this.checkCurrentState();
    this.initializeSliderFills();
  }

  /**
   * Load saved settings from storage
   */
  async loadSettings() {
    try {
      const settings = await Storage.getSettings();

      // Load saved language preferences
      if (settings.sourceLanguage) {
        this.elements.sourceLang.value = settings.sourceLanguage;
      }
      if (settings.targetLanguage) {
        this.elements.targetLang.value = settings.targetLanguage;
      }

      // Load volume settings
      if (settings.originalVolume !== undefined) {
        this.elements.originalVolume.value = settings.originalVolume;
        this.elements.originalVolumeValue.textContent = `${settings.originalVolume}%`;
      }
      if (settings.translationVolume !== undefined) {
        this.elements.translationVolume.value = settings.translationVolume;
        this.elements.translationVolumeValue.textContent = `${settings.translationVolume}%`;
      }

      // Check if API key is configured
      if (!settings.openaiApiKey && !settings.deepgramApiKey && !settings.elevenLabsApiKey) {
        this.showError('Please configure your API key in Settings');
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  /**
   * Initialize slider fill widths based on current values
   */
  initializeSliderFills() {
    this.updateSliderFill(this.elements.originalVolume, this.elements.originalSliderFill);
    this.updateSliderFill(this.elements.translationVolume, this.elements.translationSliderFill);
  }

  /**
   * Update slider fill element to match slider value
   */
  updateSliderFill(slider, fill) {
    if (slider && fill) {
      const percentage = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
      fill.style.width = `${percentage}%`;
    }
  }

  /**
   * Attach all event listeners
   */
  attachEventListeners() {
    // Toggle button with loading state
    this.elements.toggleBtn.addEventListener('click', () => this.toggleCapture());

    // Settings button
    this.elements.settingsBtn.addEventListener('click', () => {
      this.addButtonFeedback(this.elements.settingsBtn);
      chrome.runtime.openOptionsPage();
    });

    // Swap languages button
    this.elements.swapBtn.addEventListener('click', () => this.swapLanguages());

    // Language selectors
    this.elements.sourceLang.addEventListener('change', (e) => {
      this.handleLanguageChange('source', e.target.value);
    });

    this.elements.targetLang.addEventListener('change', (e) => {
      this.handleLanguageChange('target', e.target.value);
    });

    // Volume sliders with visual feedback
    this.elements.originalVolume.addEventListener('input', (e) => {
      this.handleVolumeChange('original', e.target);
    });

    this.elements.translationVolume.addEventListener('input', (e) => {
      this.handleVolumeChange('translation', e.target);
    });

    // Transcript actions
    this.elements.clearTranscript.addEventListener('click', () => this.clearTranscript());
    this.elements.copyTranscript.addEventListener('click', () => this.copyTranscript());

    // Error dismiss
    this.elements.errorDismiss.addEventListener('click', () => this.hideError());

    // Add keyboard support for main toggle
    this.elements.toggleBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggleCapture();
      }
    });
  }

  /**
   * Handle language changes with animation
   */
  handleLanguageChange(type, value) {
    const storageKey = type === 'source' ? 'sourceLanguage' : 'targetLanguage';
    const messageType = type === 'source' ? 'UPDATE_SOURCE_LANG' : 'UPDATE_TARGET_LANG';

    Storage.set({ [storageKey]: value });
    this.sendMessage({ type: messageType, language: value });

    // Visual feedback
    const selectEl = type === 'source' ? this.elements.sourceLang : this.elements.targetLang;
    selectEl.parentElement.classList.add('select-changed');
    setTimeout(() => selectEl.parentElement.classList.remove('select-changed'), 200);
  }

  /**
   * Swap source and target languages
   */
  swapLanguages() {
    const sourceValue = this.elements.sourceLang.value;
    const targetValue = this.elements.targetLang.value;

    // Don't swap if source is auto-detect
    if (sourceValue === 'auto') {
      this.showToast('Cannot swap when source is Auto-detect');
      return;
    }

    // Check if target language exists in source options
    const sourceOption = this.elements.sourceLang.querySelector(`option[value="${targetValue}"]`);
    const targetOption = this.elements.targetLang.querySelector(`option[value="${sourceValue}"]`);

    if (!sourceOption || !targetOption) {
      this.showToast('Language not available for swap');
      return;
    }

    // Perform swap with animation
    this.elements.swapBtn.classList.add('swapping');

    this.elements.sourceLang.value = targetValue;
    this.elements.targetLang.value = sourceValue;

    // Save to storage
    Storage.set({
      sourceLanguage: targetValue,
      targetLanguage: sourceValue
    });

    // Notify service worker
    this.sendMessage({ type: 'UPDATE_SOURCE_LANG', language: targetValue });
    this.sendMessage({ type: 'UPDATE_TARGET_LANG', language: sourceValue });

    setTimeout(() => {
      this.elements.swapBtn.classList.remove('swapping');
    }, 300);
  }

  /**
   * Handle volume changes with debouncing
   */
  handleVolumeChange(type, slider) {
    const value = parseInt(slider.value);
    const isOriginal = type === 'original';

    // Update display value
    const valueEl = isOriginal ? this.elements.originalVolumeValue : this.elements.translationVolumeValue;
    valueEl.textContent = `${value}%`;

    // Update slider fill
    const fillEl = isOriginal ? this.elements.originalSliderFill : this.elements.translationSliderFill;
    this.updateSliderFill(slider, fillEl);

    // Update ARIA
    slider.setAttribute('aria-valuenow', value);

    // Clear existing timer
    const timerKey = isOriginal ? 'original' : 'translation';
    if (this.volumeDebounceTimers[timerKey]) {
      clearTimeout(this.volumeDebounceTimers[timerKey]);
    }

    // Debounce storage and message sending
    this.volumeDebounceTimers[timerKey] = setTimeout(() => {
      const storageKey = isOriginal ? 'originalVolume' : 'translationVolume';
      const messageType = isOriginal ? 'UPDATE_ORIGINAL_VOLUME' : 'UPDATE_TRANSLATION_VOLUME';

      Storage.set({ [storageKey]: value });
      this.sendMessage({ type: messageType, volume: value });
    }, 100);
  }

  /**
   * Setup Chrome runtime message listener
   */
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.type) {
        case 'CAPTURE_STARTED':
          this.onCaptureStarted();
          break;
        case 'CAPTURE_STOPPED':
          this.onCaptureStopped();
          break;
        case 'TRANSCRIPT_UPDATE':
          this.updateTranscript(message.original, message.translated, message.interim);
          break;
        case 'STATUS_UPDATE':
          this.updateStatus(message.status);
          break;
        case 'ERROR':
          this.showError(message.message);
          break;
      }
      return true;
    });
  }

  /**
   * Check current capture state on popup open
   */
  async checkCurrentState() {
    try {
      const response = await this.sendMessage({ type: 'GET_STATE' });
      if (response && response.isCapturing) {
        this.isCapturing = true;
        this.elements.toggleBtn.dataset.state = 'active';
        this.elements.toggleBtn.setAttribute('aria-pressed', 'true');
        this.elements.toggleBtn.setAttribute('aria-label', 'Stop translation');
        this.updateStatus(response.status || 'listening');
      }
    } catch (error) {
      console.log('No active capture state');
    }
  }

  /**
   * Toggle capture on/off
   */
  async toggleCapture() {
    if (this.isCapturing) {
      await this.stopCapture();
    } else {
      await this.startCapture();
    }
  }

  /**
   * Start audio capture
   */
  async startCapture() {
    try {
      // Show loading state
      this.elements.toggleBtn.dataset.state = 'loading';
      this.elements.statusText.textContent = 'Starting...';

      // Check for API key first
      const settings = await Storage.getSettings();
      if (!settings.openaiApiKey && !settings.deepgramApiKey && !settings.elevenLabsApiKey) {
        this.elements.toggleBtn.dataset.state = 'idle';
        this.showError('Please configure your API key in Settings first');
        return;
      }

      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab) {
        this.elements.toggleBtn.dataset.state = 'idle';
        this.showError('No active tab found');
        return;
      }

      // Check if URL is capturable
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        this.elements.toggleBtn.dataset.state = 'idle';
        this.showError('Cannot capture audio from Chrome system pages');
        return;
      }

      this.currentTabId = tab.id;
      this.hideError();

      // Send start message to service worker
      const response = await this.sendMessage({
        type: 'START_CAPTURE',
        tabId: tab.id,
        settings: {
          sourceLanguage: this.elements.sourceLang.value,
          targetLanguage: this.elements.targetLang.value,
          originalVolume: parseInt(this.elements.originalVolume.value),
          translationVolume: parseInt(this.elements.translationVolume.value)
        }
      });

      if (response && response.error) {
        this.elements.toggleBtn.dataset.state = 'idle';
        this.showError(response.error);
      }
    } catch (error) {
      console.error('Error starting capture:', error);
      this.elements.toggleBtn.dataset.state = 'idle';
      this.showError('Failed to start capture: ' + error.message);
    }
  }

  /**
   * Stop audio capture
   */
  async stopCapture() {
    try {
      this.elements.toggleBtn.dataset.state = 'loading';
      this.elements.statusText.textContent = 'Stopping...';
      await this.sendMessage({ type: 'STOP_CAPTURE' });
    } catch (error) {
      console.error('Error stopping capture:', error);
      this.onCaptureStopped();
    }
  }

  /**
   * Handle capture started event
   */
  onCaptureStarted() {
    this.isCapturing = true;
    this.elements.toggleBtn.dataset.state = 'active';
    this.elements.toggleBtn.setAttribute('aria-pressed', 'true');
    this.elements.toggleBtn.setAttribute('aria-label', 'Stop translation');
    this.elements.statusText.textContent = 'Listening...';
    this.updateStatus('listening');
    this.hideError();
  }

  /**
   * Handle capture stopped event
   */
  onCaptureStopped() {
    this.isCapturing = false;
    this.elements.toggleBtn.dataset.state = 'idle';
    this.elements.toggleBtn.setAttribute('aria-pressed', 'false');
    this.elements.toggleBtn.setAttribute('aria-label', 'Start translation');
    this.elements.statusText.textContent = 'Ready to translate';
    this.updateStatus('idle');
  }

  /**
   * Update status indicator
   */
  updateStatus(status) {
    this.elements.statusIndicator.dataset.status = status;
    this.elements.statusLabel.textContent = this.formatStatus(status);

    // Update status text with context
    const statusMessages = {
      listening: 'Listening for speech...',
      translating: 'Translating...',
      speaking: 'Speaking translation...',
      idle: this.isCapturing ? 'Processing...' : 'Ready to translate',
      error: 'An error occurred'
    };

    if (statusMessages[status]) {
      this.elements.statusText.textContent = statusMessages[status];
    }
  }

  /**
   * Format status for display
   */
  formatStatus(status) {
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  /**
   * Update transcript display
   */
  updateTranscript(original, translated, interim = false) {
    // Remove empty state if exists
    const emptyState = this.elements.transcriptDisplay.querySelector('.transcript-empty');
    if (emptyState) {
      emptyState.remove();
    }

    // Store transcript data for copy
    if (!interim && (original || translated)) {
      this.transcriptData.push({ original, translated });
      this.elements.copyTranscript.disabled = false;
    }

    // Remove previous interim items
    if (interim) {
      const interimItems = this.elements.transcriptDisplay.querySelectorAll('.transcript-item.interim');
      interimItems.forEach(item => item.remove());
    }

    // Create transcript item
    const item = document.createElement('div');
    item.className = `transcript-item${interim ? ' interim' : ''}`;
    item.setAttribute('role', 'listitem');

    if (original) {
      const originalEl = document.createElement('div');
      originalEl.className = 'transcript-original';
      originalEl.textContent = original;
      item.appendChild(originalEl);
    }

    if (translated) {
      const translatedEl = document.createElement('div');
      translatedEl.className = 'transcript-translated';
      translatedEl.textContent = translated;
      item.appendChild(translatedEl);
    }

    this.elements.transcriptDisplay.appendChild(item);

    // Scroll to bottom with smooth animation
    requestAnimationFrame(() => {
      this.elements.transcriptDisplay.scrollTop = this.elements.transcriptDisplay.scrollHeight;
    });
  }

  /**
   * Clear transcript display
   */
  clearTranscript() {
    this.addButtonFeedback(this.elements.clearTranscript);

    // Reset transcript data
    this.transcriptData = [];
    this.elements.copyTranscript.disabled = true;

    // Reset display with empty state
    this.elements.transcriptDisplay.innerHTML = `
      <div class="transcript-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          <line x1="9" y1="10" x2="15" y2="10"/>
        </svg>
        <p>Transcription will appear here...</p>
      </div>
    `;
  }

  /**
   * Copy transcript to clipboard
   */
  async copyTranscript() {
    if (this.transcriptData.length === 0) {
      this.showToast('No transcript to copy');
      return;
    }

    try {
      // Format transcript for copying
      const formattedText = this.transcriptData
        .map(item => {
          let text = '';
          if (item.original) text += `Original: ${item.original}\n`;
          if (item.translated) text += `Translation: ${item.translated}`;
          return text.trim();
        })
        .filter(text => text)
        .join('\n\n');

      await navigator.clipboard.writeText(formattedText);

      // Show success state
      this.elements.copyTranscript.classList.add('copied');
      this.showToast('Copied to clipboard');

      // Reset after delay
      setTimeout(() => {
        this.elements.copyTranscript.classList.remove('copied');
      }, 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
      this.showToast('Failed to copy to clipboard');
    }
  }

  /**
   * Show toast notification
   */
  showToast(message) {
    this.elements.toastText.textContent = message;
    this.elements.toast.classList.add('show');

    setTimeout(() => {
      this.elements.toast.classList.remove('show');
    }, 2500);
  }

  /**
   * Show error message
   */
  showError(message) {
    this.elements.errorText.textContent = message;
    this.elements.errorDisplay.classList.remove('hidden');
    this.updateStatus('error');
  }

  /**
   * Hide error message
   */
  hideError() {
    this.elements.errorDisplay.classList.add('hidden');
  }

  /**
   * Add visual feedback to button click
   */
  addButtonFeedback(button) {
    button.classList.add('clicked');
    setTimeout(() => button.classList.remove('clicked'), 150);
  }

  /**
   * Send message to service worker
   */
  sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        resolve(response);
      });
    });
  }
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});
