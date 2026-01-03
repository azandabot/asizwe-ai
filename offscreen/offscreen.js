// Offscreen document for audio capture and processing
import { STTService } from '../lib/stt-service.js';
import { TranslationService } from '../lib/translation-service.js';
import { TTSService } from '../lib/tts-service.js';
import { StreamManager } from '../lib/stream-manager.js';

console.log('[AsizweAI Offscreen] Document loading...');

// Helper to send debug logs to service worker (so they appear in the SW console)
function debugLog(...args) {
  const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  console.log(...args);
  chrome.runtime.sendMessage({ type: 'DEBUG_LOG', message }).catch(() => {});
}

class OffscreenProcessor {
  constructor() {
    this.streamManager = null;
    this.sttService = null;
    this.translationService = null;
    this.ttsService = null;
    this.isProcessing = false;
    this.isInitialized = false;
    this.storedSettings = null;

    this.settings = {
      sourceLanguage: 'auto',
      targetLanguage: 'en',
      originalVolume: 30,
      translationVolume: 100
    };

    // Queue for managing translation/TTS flow
    this.processingQueue = [];
    this.isQueueProcessing = false;

    // Create services but don't initialize yet
    this.sttService = new STTService();
    this.translationService = new TranslationService();
    this.ttsService = new TTSService();

    console.log('[AsizweAI Offscreen] Processor created, waiting for settings...');
  }

  async initWithSettings(settings) {
    try {
      console.log('[AsizweAI Offscreen] Initializing services with settings...');
      this.storedSettings = settings;

      // Initialize services with settings passed from service worker
      await Promise.all([
        this.sttService.init(settings),
        this.translationService.init(settings),
        this.ttsService.init(settings)
      ]);

      console.log('[AsizweAI Offscreen] Services initialized successfully');

      // Set up transcript callback
      this.sttService.onTranscript = (text, isFinal) => {
        console.log('[AsizweAI Offscreen] Transcript callback:', text, 'Final:', isFinal);
        this.handleTranscript(text, isFinal);
      };

      this.isInitialized = true;
      console.log('[AsizweAI Offscreen] Processor fully initialized and ready');
      return { success: true };
    } catch (error) {
      console.error('[AsizweAI Offscreen] Error initializing:', error);
      return { error: error.message };
    }
  }

  async handleMessage(message) {
    console.log('[AsizweAI Offscreen] Handling message:', message.type);

    switch (message.type) {
      case 'START_PROCESSING':
        console.log('[AsizweAI Offscreen] START_PROCESSING with streamId:', message.streamId?.substring(0, 20));
        return await this.startProcessing(message.streamId, message.settings);

      case 'STOP_PROCESSING':
        console.log('[AsizweAI Offscreen] STOP_PROCESSING');
        return await this.stopProcessing();

      case 'UPDATE_SOURCE_LANG':
        this.settings.sourceLanguage = message.language;
        if (this.sttService) this.sttService.setLanguage(message.language);
        return { success: true };

      case 'UPDATE_TARGET_LANG':
        this.settings.targetLanguage = message.language;
        return { success: true };

      case 'UPDATE_ORIGINAL_VOLUME':
        this.settings.originalVolume = message.volume;
        if (this.streamManager) {
          this.streamManager.setOriginalVolume(message.volume);
        }
        return { success: true };

      case 'UPDATE_TRANSLATION_VOLUME':
        this.settings.translationVolume = message.volume;
        if (this.ttsService) this.ttsService.setVolume(message.volume);
        return { success: true };

      default:
        console.log('[AsizweAI Offscreen] Unknown message type:', message.type);
        return null; // Return null for messages we don't handle
    }
  }

  async startProcessing(streamId, settings) {
    try {
      console.log('[AsizweAI Offscreen] startProcessing called');

      // Initialize services if not already done, using settings from START_PROCESSING
      if (!this.isInitialized && settings) {
        console.log('[AsizweAI Offscreen] First time init with settings from START_PROCESSING');
        await this.initWithSettings(settings);
      }

      if (this.isProcessing) {
        console.log('[AsizweAI Offscreen] Already processing, stopping first...');
        await this.stopProcessing();
      }

      // Update settings
      if (settings) {
        this.settings = { ...this.settings, ...settings };
        console.log('[AsizweAI Offscreen] Settings updated:', this.settings);

        // Update API keys in services based on provider
        if (settings.sttProvider === 'deepgram' && settings.deepgramApiKey) {
          this.sttService.setApiKey(settings.deepgramApiKey);
          debugLog('[Offscreen] Set Deepgram API key for STT');
        } else if (settings.sttProvider === 'elevenlabs' && settings.elevenLabsApiKey) {
          this.sttService.setApiKey(settings.elevenLabsApiKey);
          debugLog('[Offscreen] Set ElevenLabs API key for STT');
        } else if (settings.openaiApiKey) {
          this.sttService.setApiKey(settings.openaiApiKey);
          debugLog('[Offscreen] Set OpenAI API key for STT');
        }

        // Translation always uses OpenAI
        if (settings.openaiApiKey) {
          this.translationService.setApiKey(settings.openaiApiKey);
        }
      }

      // Initialize stream manager
      debugLog('[Offscreen] Creating StreamManager...');
      this.streamManager = new StreamManager();

      // Set up audio data callback
      let audioChunkCount = 0;
      this.streamManager.onAudioData = (audioData) => {
        audioChunkCount++;
        if (audioChunkCount === 1) {
          debugLog('[Offscreen] First audio chunk received!');
        }
        if (audioChunkCount % 100 === 0) {
          debugLog('[Offscreen] Audio chunks sent to STT:', audioChunkCount);
        }
        this.sttService.sendAudio(audioData);
      };

      // Start stream capture
      debugLog('[Offscreen] Starting stream capture with ID:', streamId?.substring(0, 20));
      await this.streamManager.start(streamId, this.settings.originalVolume);
      debugLog('[Offscreen] Stream capture started successfully');

      // Connect STT service
      debugLog('[Offscreen] Connecting STT service...');
      await this.sttService.connect(this.settings.sourceLanguage);
      debugLog('[Offscreen] STT service connected');

      this.isProcessing = true;

      // Notify that capture started
      this.sendMessage({ type: 'CAPTURE_STARTED' });
      this.updateStatus('listening');

      console.log('[AsizweAI Offscreen] Processing started successfully!');
      return { success: true };

    } catch (error) {
      debugLog('[Offscreen] ERROR starting processing:', error.message);
      debugLog('[Offscreen] Error stack:', error.stack);
      this.sendMessage({ type: 'ERROR', message: error.message });
      return { error: error.message };
    }
  }

  async stopProcessing() {
    try {
      console.log('[AsizweAI Offscreen] Stopping processing...');
      this.isProcessing = false;

      // Stop stream manager
      if (this.streamManager) {
        this.streamManager.stop();
        this.streamManager = null;
      }

      // Disconnect STT
      if (this.sttService) {
        this.sttService.disconnect();
      }

      // Stop any ongoing TTS
      if (this.ttsService) {
        this.ttsService.stop();
      }

      // Clear queue
      this.processingQueue = [];
      this.isQueueProcessing = false;

      // Notify that capture stopped
      this.sendMessage({ type: 'CAPTURE_STOPPED' });
      this.updateStatus('idle');

      console.log('[AsizweAI Offscreen] Processing stopped');
      return { success: true };

    } catch (error) {
      console.error('[AsizweAI Offscreen] Error stopping processing:', error);
      return { error: error.message };
    }
  }

  async handleTranscript(text, isFinal) {
    if (!text || !text.trim()) return;

    debugLog('[Offscreen] Transcript:', text, 'Final:', isFinal);

    // Show interim results immediately
    if (!isFinal) {
      this.sendMessage({
        type: 'TRANSCRIPT_UPDATE',
        original: text + '...',
        translated: '(listening...)'
      });
      return;
    }

    // For final results, process immediately without queuing
    // This reduces latency by not waiting for previous TTS to finish
    this.processTranscriptImmediately(text);
  }

  async processTranscriptImmediately(text) {
    try {
      debugLog('[Offscreen] Processing immediately:', text);
      this.updateStatus('translating');

      // Start translation immediately
      const translatePromise = this.translationService.translate(
        text,
        this.settings.targetLanguage,
        this.settings.sourceLanguage
      );

      // Show original text right away
      this.sendMessage({
        type: 'TRANSCRIPT_UPDATE',
        original: text,
        translated: '(translating...)'
      });

      const translated = await translatePromise;
      debugLog('[Offscreen] Translation:', translated);

      // Send translated text to popup
      this.sendMessage({
        type: 'TRANSCRIPT_UPDATE',
        original: text,
        translated: translated
      });

      // Stop any currently playing TTS to speak new translation
      this.ttsService.stop();

      this.updateStatus('speaking');

      // Duck original audio while speaking
      if (this.streamManager) {
        this.streamManager.setOriginalVolume(Math.min(this.settings.originalVolume, 20));
      }

      // Speak the translation (don't await - let it play while we continue listening)
      this.ttsService.speak(translated, this.settings.targetLanguage).then(() => {
        // Restore volume when done speaking
        if (this.streamManager && this.isProcessing) {
          this.streamManager.setOriginalVolume(this.settings.originalVolume);
        }
        this.updateStatus('listening');
      }).catch(err => {
        debugLog('[Offscreen] TTS error:', err.message);
        this.updateStatus('listening');
      });

    } catch (error) {
      console.error('[AsizweAI Offscreen] Error processing transcript:', error);
      this.sendMessage({ type: 'ERROR', message: error.message });
      this.updateStatus('listening');
    }
  }

  // Keep old queue methods for compatibility but they won't be used
  async processQueue() {
    if (this.isQueueProcessing || this.processingQueue.length === 0) {
      return;
    }

    this.isQueueProcessing = true;
    debugLog('[Offscreen] Processing queue, items:', this.processingQueue.length);

    while (this.processingQueue.length > 0 && this.isProcessing) {
      const text = this.processingQueue.shift();

      try {
        this.updateStatus('translating');

        const translated = await this.translationService.translate(
          text,
          this.settings.targetLanguage,
          this.settings.sourceLanguage
        );

        this.sendMessage({
          type: 'TRANSCRIPT_UPDATE',
          original: text,
          translated: translated
        });

        this.updateStatus('speaking');

        if (this.streamManager) {
          this.streamManager.setOriginalVolume(Math.min(this.settings.originalVolume, 20));
        }

        await this.ttsService.speak(translated, this.settings.targetLanguage);

        if (this.streamManager) {
          this.streamManager.setOriginalVolume(this.settings.originalVolume);
        }

        this.updateStatus('listening');

      } catch (error) {
        console.error('[AsizweAI Offscreen] Error processing transcript:', error);
        this.sendMessage({ type: 'ERROR', message: error.message });
      }
    }

    this.isQueueProcessing = false;
  }

  updateStatus(status) {
    console.log('[AsizweAI Offscreen] Status update:', status);
    this.sendMessage({ type: 'STATUS_UPDATE', status });
  }

  sendMessage(message) {
    chrome.runtime.sendMessage(message).catch(error => {
      // Ignore errors when popup is closed
      console.log('[AsizweAI Offscreen] Send message failed (popup may be closed):', error.message);
    });
  }
}

// Initialize processor
console.log('[AsizweAI Offscreen] Creating OffscreenProcessor...');
const processor = new OffscreenProcessor();

// Listen for messages - handle synchronously where possible
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[AsizweAI Offscreen] Received message:', message.type);

  // Only handle messages meant for offscreen processing
  const offscreenMessages = [
    'START_PROCESSING',
    'STOP_PROCESSING',
    'UPDATE_SOURCE_LANG',
    'UPDATE_TARGET_LANG',
    'UPDATE_ORIGINAL_VOLUME',
    'UPDATE_TRANSLATION_VOLUME'
  ];

  if (!offscreenMessages.includes(message.type)) {
    // Not for us, don't respond
    return false;
  }

  // Handle the message asynchronously
  processor.handleMessage(message).then(response => {
    console.log('[AsizweAI Offscreen] Sending response:', response);
    sendResponse(response);
  }).catch(error => {
    console.error('[AsizweAI Offscreen] Error handling message:', error);
    sendResponse({ error: error.message });
  });

  return true; // Keep channel open for async response
});

console.log('[AsizweAI Offscreen] Message listener registered');
