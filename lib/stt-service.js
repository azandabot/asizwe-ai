// Speech-to-Text Service
// Supports OpenAI Whisper, Deepgram, and Web Speech API

// Helper to send debug logs to service worker
function debugLog(...args) {
  const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  console.log(...args);
  try {
    chrome.runtime.sendMessage({ type: 'DEBUG_LOG', message }).catch(() => {});
  } catch (e) {}
}

export class STTService {
  constructor() {
    this.provider = 'openai';
    this.apiKey = null;
    this.socket = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.onTranscript = null;
    this.language = 'auto';
    this.isConnected = false;

    // For batching audio (Whisper)
    this.audioBuffer = [];
    this.bufferDuration = 0;
    this.maxBufferDuration = 15000; // 15 seconds - longer buffer to reduce API calls
    this.silenceTimeout = null;
    this.lastAudioTime = 0;
  }

  async init(settings = null) {
    debugLog('[STT] Initializing...');

    // If settings provided, use them directly (offscreen context)
    // Otherwise try to get from storage (may not work in offscreen)
    if (settings) {
      this.provider = settings.sttProvider || 'openai';
      // Select API key based on provider
      if (this.provider === 'deepgram') {
        this.apiKey = settings.deepgramApiKey;
      } else if (this.provider === 'elevenlabs') {
        this.apiKey = settings.elevenLabsApiKey;
      } else {
        this.apiKey = settings.openaiApiKey;
      }
    } else {
      try {
        const stored = await chrome.storage.sync.get([
          'openaiApiKey',
          'deepgramApiKey',
          'elevenLabsApiKey',
          'sttProvider'
        ]);
        this.provider = stored.sttProvider || 'openai';
        if (this.provider === 'deepgram') {
          this.apiKey = stored.deepgramApiKey;
        } else if (this.provider === 'elevenlabs') {
          this.apiKey = stored.elevenLabsApiKey;
        } else {
          this.apiKey = stored.openaiApiKey;
        }
      } catch (error) {
        debugLog('[STT] Could not access storage, using defaults:', error.message);
      }
    }

    debugLog('[STT] Provider:', this.provider);
    debugLog('[STT] API Key configured:', !!this.apiKey);

    if (!this.apiKey && this.provider !== 'webspeech') {
      debugLog('[STT] WARNING: No API key configured!');
    }
  }

  // Allow setting API key directly
  setApiKey(apiKey) {
    this.apiKey = apiKey;
    console.log('[AsizweAI STT] API Key set directly');
  }

  setProvider(provider) {
    this.provider = provider;
    console.log('[AsizweAI STT] Provider set to:', provider);
  }

  setLanguage(language) {
    this.language = language;
    console.log('[AsizweAI STT] Language set to:', language);
  }

  async connect(language = 'auto') {
    debugLog('[STT] Connecting with language:', language, 'provider:', this.provider);
    this.language = language;

    if (this.provider === 'deepgram') {
      return this.connectDeepgram(language);
    } else if (this.provider === 'webspeech') {
      return this.connectWebSpeech(language);
    } else if (this.provider === 'elevenlabs') {
      // ElevenLabs - batch mode like Whisper, but with better Zulu support
      debugLog('[STT] Using ElevenLabs (batch mode, best for African languages)');
      this.isConnected = true;
      return true;
    } else {
      // OpenAI Whisper - batch mode, no persistent connection
      debugLog('[STT] Using OpenAI Whisper (batch mode)');
      this.isConnected = true;
      return true;
    }
  }

  connectDeepgram(language) {
    return new Promise((resolve, reject) => {
      if (!this.apiKey) {
        debugLog('[STT] ERROR: Deepgram API key not configured');
        reject(new Error('Deepgram API key not configured'));
        return;
      }

      // Map language codes
      const langMap = {
        'auto': 'en',
        'zu': 'en', // Deepgram doesn't support Zulu directly
        'xh': 'en',
        'af': 'af',
        'en': 'en',
        'es': 'es',
        'fr': 'fr',
        'de': 'de',
        'pt': 'pt',
        'it': 'it',
        'ja': 'ja',
        'ko': 'ko',
        'zh': 'zh',
        'hi': 'hi',
        'ar': 'ar',
        'ru': 'ru'
      };

      const lang = langMap[language] || 'en';

      // Build URL with encoding parameters for raw PCM audio
      // Optimized for LOW LATENCY real-time translation:
      // - interim_results=true: Get partial results as speech happens
      // - endpointing=300: Detect end of speech faster (300ms silence)
      // - utterance_end_ms=1000: Finalize utterance after 1s silence (was 1.5s)
      // - vad_events=true: Voice activity detection for faster response
      let url = `wss://api.deepgram.com/v1/listen?language=${lang}&model=nova-2&smart_format=true&interim_results=true&endpointing=300&utterance_end_ms=1000&vad_events=true&encoding=linear16&sample_rate=16000&channels=1`;

      // Add keywords for Zulu/Xhosa to help Deepgram recognize common words
      // Even though Deepgram doesn't natively support these languages,
      // keywords can help it recognize specific words phonetically
      if (language === 'zu' || language === 'xh') {
        const zuluKeywords = [
          'sawubona', 'ngiyabonga', 'yebo', 'cha', 'mina', 'wena', 'thina',
          'baba', 'mama', 'umuntu', 'abantu', 'uthando', 'ukudla', 'amanzi',
          'indlu', 'imali', 'isikhathi', 'namhlanje', 'kusasa', 'izolo',
          'ngiyakuthanda', 'siyabonga', 'hamba', 'woza', 'dlala', 'funda',
          'sebenza', 'phuza', 'lala', 'vuka', 'hlala', 'khuluma', 'lalela'
        ];
        // Deepgram keywords parameter (comma-separated, with optional boost)
        const keywordsParam = zuluKeywords.map(w => `${w}:2`).join(',');
        url += `&keywords=${encodeURIComponent(keywordsParam)}`;
        debugLog('[STT] Added Zulu keywords to Deepgram');
      }

      debugLog('[STT] Connecting to Deepgram with language:', lang);
      debugLog('[STT] API key starts with:', this.apiKey?.substring(0, 8) + '...');

      try {
        this.socket = new WebSocket(url, ['token', this.apiKey]);
      } catch (e) {
        debugLog('[STT] Failed to create WebSocket:', e.message);
        reject(e);
        return;
      }

      this.socket.onopen = () => {
        debugLog('[STT] Deepgram WebSocket connected successfully!');
        this.isConnected = true;

        // Send keep-alive pings every 10 seconds
        this.keepAliveInterval = setInterval(() => {
          if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({ type: 'KeepAlive' }));
          }
        }, 10000);

        resolve(true);
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'Results') {
            const transcript = data.channel?.alternatives?.[0]?.transcript;
            const isFinal = data.is_final;

            if (transcript) {
              debugLog('[STT] Deepgram transcript:', transcript, 'Final:', isFinal);
              if (this.onTranscript) {
                this.onTranscript(transcript, isFinal);
              }
            }
          } else if (data.type === 'Error') {
            debugLog('[STT] Deepgram error message:', JSON.stringify(data));
          }
        } catch (error) {
          debugLog('[STT] Error parsing Deepgram response:', error.message);
        }
      };

      this.socket.onerror = (error) => {
        debugLog('[STT] Deepgram WebSocket error - check API key');
        // Send error to popup
        try {
          chrome.runtime.sendMessage({
            type: 'ERROR',
            message: 'Deepgram connection failed. Please check your API key.'
          }).catch(() => {});
        } catch (e) {}
        reject(new Error('Deepgram connection failed - check API key'));
      };

      this.socket.onclose = (event) => {
        debugLog('[STT] Deepgram WebSocket closed, code:', event.code, 'reason:', event.reason);
        this.isConnected = false;
      };
    });
  }

  connectWebSpeech(language) {
    return new Promise((resolve, reject) => {
      if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        reject(new Error('Web Speech API not supported'));
        return;
      }

      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.recognition = new SpeechRecognition();

      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = language === 'auto' ? 'en-US' : language;

      this.recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          const isFinal = event.results[i].isFinal;

          if (this.onTranscript) {
            this.onTranscript(transcript, isFinal);
          }
        }
      };

      this.recognition.onerror = (error) => {
        console.error('[AsizweAI STT] Web Speech API error:', error);
      };

      this.recognition.start();
      this.isConnected = true;
      console.log('[AsizweAI STT] Web Speech API connected');
      resolve(true);
    });
  }

  sendAudio(audioBuffer) {
    if (!this.isConnected) {
      return;
    }

    if (this.provider === 'deepgram') {
      this.sendToDeepgram(audioBuffer);
    } else if (this.provider === 'openai') {
      this.bufferForWhisper(audioBuffer);
    } else if (this.provider === 'elevenlabs') {
      this.bufferForElevenLabs(audioBuffer);
    }
    // Web Speech API handles its own audio
  }

  sendToDeepgram(audioBuffer) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(audioBuffer);
    }
  }

  // ElevenLabs uses same buffering as Whisper
  bufferForElevenLabs(audioBuffer) {
    // Add to buffer
    this.audioBuffer.push(new Uint8Array(audioBuffer));
    this.bufferDuration += (audioBuffer.byteLength / 2) / 16000 * 1000;
    this.lastAudioTime = Date.now();

    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
    }

    if (this.audioBuffer.length % 50 === 0) {
      debugLog('[STT] Buffer duration:', Math.round(this.bufferDuration), 'ms, chunks:', this.audioBuffer.length);
    }

    // Send every 10 seconds for ElevenLabs
    if (this.bufferDuration >= 10000) {
      debugLog('[STT] Buffer full (10s), sending to ElevenLabs...');
      this.sendToElevenLabs();
    } else {
      this.silenceTimeout = setTimeout(() => {
        if (this.audioBuffer.length > 0) {
          debugLog('[STT] Silence timeout, sending to ElevenLabs...');
          this.sendToElevenLabs();
        }
      }, 1500);
    }
  }

  async sendToElevenLabs() {
    if (this.audioBuffer.length === 0) {
      debugLog('[STT] No audio to send');
      return;
    }

    if (!this.apiKey) {
      debugLog('[STT] ERROR: No ElevenLabs API key configured!');
      return;
    }

    // Combine all buffered audio
    const totalLength = this.audioBuffer.reduce((sum, arr) => sum + arr.length, 0);
    const combinedBuffer = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of this.audioBuffer) {
      combinedBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    // Clear buffer
    this.audioBuffer = [];
    this.bufferDuration = 0;

    debugLog('[STT] Sending', totalLength, 'bytes to ElevenLabs API...');

    try {
      // Create WAV file from PCM data
      const wavBlob = this.createWavBlob(combinedBuffer);
      debugLog('[STT] Created WAV blob:', wavBlob.size, 'bytes');

      // ElevenLabs Speech-to-Text API
      const formData = new FormData();
      formData.append('file', wavBlob, 'audio.wav');
      formData.append('model_id', 'scribe_v1'); // ElevenLabs Scribe model

      // Map language codes to ElevenLabs format
      const langMap = {
        'zu': 'zul', // Zulu
        'xh': 'xho', // Xhosa
        'af': 'afr', // Afrikaans
        'en': 'eng', // English
        'auto': null // Let it auto-detect
      };

      const langCode = langMap[this.language] || null;
      if (langCode) {
        formData.append('language_code', langCode);
      }

      debugLog('[STT] Calling ElevenLabs API with language:', this.language, '-> code:', langCode || 'auto');

      const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey
        },
        body: formData
      });

      if (!response.ok) {
        const error = await response.json();
        debugLog('[STT] ElevenLabs API error:', JSON.stringify(error));

        const errorMsg = error.detail?.message || error.detail || 'ElevenLabs API error';
        try {
          chrome.runtime.sendMessage({ type: 'ERROR', message: errorMsg }).catch(() => {});
        } catch (e) {}

        throw new Error(errorMsg);
      }

      const data = await response.json();
      debugLog('[STT] ElevenLabs response:', JSON.stringify(data));

      // ElevenLabs returns { text: "transcription" }
      const transcript = data.text;
      if (transcript && this.onTranscript) {
        debugLog('[STT] ElevenLabs transcript:', transcript);
        this.onTranscript(transcript, true);
      } else {
        debugLog('[STT] No text in response or no callback set');
      }

    } catch (error) {
      debugLog('[STT] ElevenLabs transcription error:', error.message);
    }
  }

  bufferForWhisper(audioBuffer) {
    // Add to buffer
    this.audioBuffer.push(new Uint8Array(audioBuffer));
    this.bufferDuration += (audioBuffer.byteLength / 2) / 16000 * 1000; // Approximate duration in ms
    this.lastAudioTime = Date.now();

    // Reset silence timeout
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
    }

    // Log buffer status occasionally
    if (this.audioBuffer.length % 50 === 0) {
      debugLog('[STT] Buffer duration:', Math.round(this.bufferDuration), 'ms, chunks:', this.audioBuffer.length);
    }

    // Check if we should send to Whisper
    if (this.bufferDuration >= this.maxBufferDuration) {
      debugLog('[STT] Buffer full (15s), sending to Whisper...');
      this.sendToWhisper();
    } else {
      // Set timeout for silence detection
      this.silenceTimeout = setTimeout(() => {
        if (this.audioBuffer.length > 0) {
          debugLog('[STT] Silence timeout, sending to Whisper...');
          this.sendToWhisper();
        }
      }, 1500); // 1.5 second silence
    }
  }

  async sendToWhisper() {
    if (this.audioBuffer.length === 0) {
      debugLog('[STT] No audio to send');
      return;
    }

    if (!this.apiKey) {
      debugLog('[STT] ERROR: No API key configured!');
      return;
    }

    // Combine all buffered audio
    const totalLength = this.audioBuffer.reduce((sum, arr) => sum + arr.length, 0);
    const combinedBuffer = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of this.audioBuffer) {
      combinedBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    // Clear buffer
    this.audioBuffer = [];
    this.bufferDuration = 0;

    debugLog('[STT] Sending', totalLength, 'bytes to Whisper API...');

    try {
      // Create WAV file from PCM data
      const wavBlob = this.createWavBlob(combinedBuffer);
      debugLog('[STT] Created WAV blob:', wavBlob.size, 'bytes');

      // Send to Whisper API
      const formData = new FormData();
      formData.append('file', wavBlob, 'audio.wav');
      formData.append('model', 'whisper-1');

      // Whisper supported languages (ISO-639-1 codes)
      // Note: Zulu (zu) and Xhosa (xh) are NOT supported by Whisper
      // For these, we use auto-detection with prompt hints
      const whisperSupportedLangs = [
        'af', 'ar', 'hy', 'az', 'be', 'bs', 'bg', 'ca', 'zh', 'hr', 'cs', 'da',
        'nl', 'en', 'et', 'fi', 'fr', 'gl', 'de', 'el', 'he', 'hi', 'hu', 'is',
        'id', 'it', 'ja', 'kn', 'kk', 'ko', 'lv', 'lt', 'mk', 'ms', 'mr', 'mi',
        'ne', 'no', 'fa', 'pl', 'pt', 'ro', 'ru', 'sr', 'sk', 'sl', 'es', 'sw',
        'sv', 'tl', 'ta', 'th', 'tr', 'uk', 'ur', 'vi', 'cy'
      ];

      // Only set language if Whisper supports it
      if (this.language !== 'auto' && whisperSupportedLangs.includes(this.language)) {
        formData.append('language', this.language);
      }

      // Add prompt to help Whisper recognize African languages
      // This is especially important for Zulu/Xhosa which aren't natively supported
      const languageHints = {
        'zu': 'Transcribe this isiZulu (Zulu) speech accurately. Common Zulu words and phrases: sawubona (hello), ngiyabonga (thank you), yebo (yes), cha (no), mina (me), wena (you), thina (we), baba (father), mama (mother), umuntu (person), abantu (people), uthando (love), ukudla (food), amanzi (water), indlu (house), imali (money), isikhathi (time), namhlanje (today), kusasa (tomorrow), izolo (yesterday), ngiyakuthanda (I love you), unjani (how are you), ngiyaphila (I am fine), hamba kahle (go well), sala kahle (stay well).',
        'xh': 'Transcribe this isiXhosa (Xhosa) speech accurately. Common Xhosa words: molo (hello), enkosi (thank you), ewe (yes), hayi (no), mna (me), wena (you), thina (we), utata (father), umama (mother), umntu (person), abantu (people), uthando (love), ukutya (food), amanzi (water), indlu (house), imali (money), ixesha (time), namhlanje (today), ngomso (tomorrow), izolo (yesterday).',
        'af': 'Transcribe this Afrikaans speech accurately.'
      };

      if (languageHints[this.language]) {
        formData.append('prompt', languageHints[this.language]);
        debugLog('[STT] Added language prompt for:', this.language);
      }

      debugLog('[STT] Calling Whisper API with language:', this.language);
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: formData
      });

      if (!response.ok) {
        const error = await response.json();
        debugLog('[STT] Whisper API error:', JSON.stringify(error));

        // Send user-friendly error to popup
        const errorMsg = error.error?.code === 'insufficient_quota'
          ? 'OpenAI API quota exceeded. Please add credits at platform.openai.com or use Deepgram (free $200 credits at deepgram.com)'
          : (error.error?.message || 'Whisper API error');

        try {
          chrome.runtime.sendMessage({ type: 'ERROR', message: errorMsg }).catch(() => {});
        } catch (e) {}

        throw new Error(errorMsg);
      }

      const data = await response.json();
      debugLog('[STT] Whisper response:', data.text || '(empty)');

      if (data.text && this.onTranscript) {
        debugLog('[STT] Transcript received:', data.text);
        this.onTranscript(data.text, true);
      } else {
        debugLog('[STT] No text in response or no callback set');
      }

    } catch (error) {
      debugLog('[STT] Whisper transcription error:', error.message);
    }
  }

  createWavBlob(pcmData) {
    const sampleRate = 16000;
    const numChannels = 1;
    const bitsPerSample = 16;

    const buffer = new ArrayBuffer(44 + pcmData.length);
    const view = new DataView(buffer);

    // WAV header
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + pcmData.length, true);
    this.writeString(view, 8, 'WAVE');
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bitsPerSample / 8, true);
    view.setUint16(32, numChannels * bitsPerSample / 8, true);
    view.setUint16(34, bitsPerSample, true);
    this.writeString(view, 36, 'data');
    view.setUint32(40, pcmData.length, true);

    // PCM data
    const dataView = new Uint8Array(buffer, 44);
    dataView.set(pcmData);

    return new Blob([buffer], { type: 'audio/wav' });
  }

  writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  disconnect() {
    console.log('[AsizweAI STT] Disconnecting...');
    this.isConnected = false;

    // Clear keep-alive interval
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }

    // Clear any pending timeout
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = null;
    }

    // Send any remaining buffered audio
    if (this.provider === 'openai' && this.audioBuffer.length > 0) {
      console.log('[AsizweAI STT] Sending remaining buffer before disconnect');
      this.sendToWhisper();
    }

    // Close Deepgram socket
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    // Stop Web Speech recognition
    if (this.recognition) {
      this.recognition.stop();
      this.recognition = null;
    }

    // Clear buffer
    this.audioBuffer = [];
    this.bufferDuration = 0;

    console.log('[AsizweAI STT] Disconnected');
  }
}
