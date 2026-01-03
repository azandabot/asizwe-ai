// Text-to-Speech Service
// Supports Browser Native TTS and ElevenLabs

export class TTSService {
  constructor() {
    this.provider = 'native';
    this.synth = null;
    this.currentUtterance = null;
    this.currentAudio = null;
    this.apiKey = null;
    this.voiceId = null;
    this.speed = 1.0;
    this.volume = 100;
  }

  async init(settings = null) {
    console.log('[AsizweAI TTS] Initializing...');

    if (settings) {
      this.provider = settings.ttsProvider || 'native';
      this.apiKey = settings.elevenLabsApiKey;
      this.voiceId = settings.ttsVoiceId || '21m00Tcm4TlvDq8ikWAM';
      this.speed = settings.ttsSpeed || 1.0;
      this.volume = settings.translationVolume || 100;
    } else {
      try {
        const stored = await chrome.storage.sync.get([
          'ttsProvider',
          'elevenLabsApiKey',
          'ttsVoiceId',
          'ttsSpeed',
          'translationVolume'
        ]);
        this.provider = stored.ttsProvider || 'native';
        this.apiKey = stored.elevenLabsApiKey;
        this.voiceId = stored.ttsVoiceId || '21m00Tcm4TlvDq8ikWAM';
        this.speed = stored.ttsSpeed || 1.0;
        this.volume = stored.translationVolume || 100;
      } catch (error) {
        console.warn('[AsizweAI TTS] Could not access storage:', error.message);
      }
    }

    // Initialize speech synthesis
    if (typeof speechSynthesis !== 'undefined') {
      this.synth = speechSynthesis;

      // Load voices
      if (this.synth.getVoices().length === 0) {
        await new Promise(resolve => {
          this.synth.onvoiceschanged = resolve;
          setTimeout(resolve, 1000); // Fallback timeout
        });
      }
    }

    console.log('[AsizweAI TTS] Provider:', this.provider);
    console.log('[AsizweAI TTS] Initialized');
  }

  setVolume(volume) {
    this.volume = volume;
  }

  setApiKey(apiKey) {
    this.apiKey = apiKey;
  }

  setProvider(provider) {
    this.provider = provider;
  }

  async speak(text, targetLang = 'en') {
    if (!text?.trim()) return;

    console.log('[AsizweAI TTS] Speaking:', text.substring(0, 50) + '...');

    // Stop any current speech
    this.stop();

    if (this.provider === 'elevenlabs' && this.apiKey) {
      return this.speakWithElevenLabs(text);
    } else {
      return this.speakNative(text, targetLang);
    }
  }

  speakNative(text, lang) {
    return new Promise((resolve, reject) => {
      if (!this.synth) {
        console.warn('[AsizweAI TTS] Speech synthesis not available');
        resolve();
        return;
      }

      // Get TTS language code
      const ttsLang = this.getTTSLanguage(lang);

      this.currentUtterance = new SpeechSynthesisUtterance(text);
      this.currentUtterance.lang = ttsLang;
      this.currentUtterance.rate = this.speed;
      this.currentUtterance.volume = this.volume / 100;

      // Find best voice for language
      const voices = this.synth.getVoices();
      const langPrefix = ttsLang.split('-')[0];

      // Prefer Google voices, then any matching language
      const voice = voices.find(v =>
        v.lang.toLowerCase().startsWith(langPrefix.toLowerCase()) &&
        v.name.toLowerCase().includes('google')
      ) || voices.find(v =>
        v.lang.toLowerCase().startsWith(langPrefix.toLowerCase())
      );

      if (voice) {
        this.currentUtterance.voice = voice;
        console.log('[AsizweAI TTS] Using voice:', voice.name);
      }

      this.currentUtterance.onend = () => {
        console.log('[AsizweAI TTS] Finished speaking');
        this.currentUtterance = null;
        resolve();
      };

      this.currentUtterance.onerror = (event) => {
        console.error('[AsizweAI TTS] Error:', event.error);
        this.currentUtterance = null;
        resolve(); // Resolve anyway to continue processing
      };

      this.synth.speak(this.currentUtterance);
    });
  }

  async speakWithElevenLabs(text) {
    try {
      console.log('[AsizweAI TTS] Using ElevenLabs...');
      // Use eleven_turbo_v2_5 for faster response (lower latency)
      // Fall back to eleven_multilingual_v2 for non-English
      const modelId = 'eleven_turbo_v2_5';

      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream?optimize_streaming_latency=4`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': this.apiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            text: text,
            model_id: modelId,
            voice_settings: {
              stability: 0.3,  // Lower = faster, more variable
              similarity_boost: 0.75,
              style: 0.0,
              use_speaker_boost: false  // Disable for speed
            }
          })
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail?.message || 'ElevenLabs API error');
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      return new Promise((resolve, reject) => {
        this.currentAudio = new Audio(audioUrl);
        this.currentAudio.playbackRate = this.speed;
        this.currentAudio.volume = this.volume / 100;

        this.currentAudio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          this.currentAudio = null;
          console.log('[AsizweAI TTS] Finished speaking (ElevenLabs)');
          resolve();
        };

        this.currentAudio.onerror = (error) => {
          console.error('[AsizweAI TTS] Audio playback error:', error);
          URL.revokeObjectURL(audioUrl);
          this.currentAudio = null;
          resolve();
        };

        this.currentAudio.play().catch(error => {
          console.error('[AsizweAI TTS] Play error:', error);
          resolve();
        });
      });

    } catch (error) {
      console.error('[AsizweAI TTS] ElevenLabs error:', error);
      // Fall back to native TTS
      return this.speakNative(text, 'en');
    }
  }

  stop() {
    // Stop native TTS
    if (this.synth) {
      this.synth.cancel();
    }
    this.currentUtterance = null;

    // Stop ElevenLabs audio
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
  }

  getTTSLanguage(lang) {
    const langMap = {
      'en': 'en-US',
      'zu': 'zu-ZA',
      'xh': 'xh-ZA',
      'af': 'af-ZA',
      'es': 'es-ES',
      'fr': 'fr-FR',
      'de': 'de-DE',
      'pt': 'pt-PT',
      'it': 'it-IT',
      'ja': 'ja-JP',
      'ko': 'ko-KR',
      'zh': 'zh-CN',
      'hi': 'hi-IN',
      'ar': 'ar-SA',
      'ru': 'ru-RU'
    };

    return langMap[lang] || 'en-US';
  }
}
