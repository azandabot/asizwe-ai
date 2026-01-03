// Translation Service
// Supports OpenAI GPT and LibreTranslate

export class TranslationService {
  constructor() {
    this.provider = 'openai';
    this.apiKey = null;
  }

  async init(settings = null) {
    console.log('[AsizweAI Translation] Initializing...');

    if (settings) {
      this.provider = settings.translationProvider || 'openai';
      this.apiKey = settings.openaiApiKey;
    } else {
      try {
        const stored = await chrome.storage.sync.get([
          'openaiApiKey',
          'translationProvider'
        ]);
        this.provider = stored.translationProvider || 'openai';
        this.apiKey = stored.openaiApiKey;
      } catch (error) {
        console.warn('[AsizweAI Translation] Could not access storage:', error.message);
      }
    }

    console.log('[AsizweAI Translation] Provider:', this.provider);
    console.log('[AsizweAI Translation] API Key configured:', !!this.apiKey);
  }

  setApiKey(apiKey) {
    this.apiKey = apiKey;
  }

  setProvider(provider) {
    this.provider = provider;
  }

  async translate(text, targetLang = 'en', sourceLang = 'auto') {
    if (!text?.trim()) return '';

    // Get full language name
    const targetLanguage = this.getLanguageName(targetLang);
    const sourceLanguage = sourceLang !== 'auto' ? this.getLanguageName(sourceLang) : null;

    if (this.provider === 'openai') {
      return this.translateWithOpenAI(text, targetLanguage, sourceLanguage);
    } else {
      // Try LibreTranslate, fall back to OpenAI if it fails
      try {
        const result = await this.translateWithLibre(text, targetLang, sourceLang);
        if (result && result !== text) {
          return result;
        }
      } catch (e) {
        console.log('[AsizweAI Translation] LibreTranslate failed, falling back to OpenAI');
      }
      // Fallback to OpenAI
      if (this.apiKey) {
        return this.translateWithOpenAI(text, targetLanguage, sourceLanguage);
      }
      return text;
    }
  }

  async translateWithOpenAI(text, targetLang, sourceLang) {
    if (!this.apiKey) {
      console.error('[AsizweAI Translation] No API key configured!');
      return text;
    }

    const systemPrompt = `You are a real-time translator. Translate the following text ${sourceLang ? 'from ' + sourceLang + ' ' : ''}to ${targetLang}.

Rules:
- Keep the same tone, emotion, and intent
- Preserve humor, idioms, and cultural nuances where possible
- Output ONLY the translation, no explanations or notes
- If the text is already in ${targetLang}, return it unchanged
- Keep it natural and conversational
- Do not add quotation marks around the translation
- Maintain any emphasis or emotion from the original`;

    try {
      console.log('[AsizweAI Translation] Calling OpenAI API...');
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text }
          ],
          max_tokens: 500,
          temperature: 0.3
        })
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('[AsizweAI Translation] API error:', error);
        throw new Error(error.error?.message || 'Translation API error');
      }

      const data = await response.json();
      const translation = data.choices?.[0]?.message?.content;
      console.log('[AsizweAI Translation] Result:', translation);

      return translation?.trim() || text;

    } catch (error) {
      console.error('[AsizweAI Translation] Error:', error);
      return text;
    }
  }

  async translateWithLibre(text, targetLang, sourceLang) {
    // Language code mapping for LibreTranslate
    const langCodes = {
      'en': 'en',
      'es': 'es',
      'fr': 'fr',
      'de': 'de',
      'pt': 'pt',
      'it': 'it',
      'ja': 'ja',
      'ko': 'ko',
      'zh': 'zh',
      'ar': 'ar',
      'ru': 'ru',
      'hi': 'hi',
      'af': 'af',
      'zu': 'en', // LibreTranslate doesn't support Zulu
      'xh': 'en'  // LibreTranslate doesn't support Xhosa
    };

    const target = langCodes[targetLang] || 'en';
    const source = sourceLang === 'auto' ? 'auto' : (langCodes[sourceLang] || 'auto');

    try {
      // Try multiple LibreTranslate instances (some may be down or rate-limited)
      const instances = [
        'https://libretranslate.de/translate',
        'https://translate.argosopentech.com/translate',
        'https://lt.vern.cc/translate'
      ];

      for (const url of instances) {
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              q: text,
              source: source,
              target: target,
              format: 'text'
            })
          });

          if (response.ok) {
            const data = await response.json();
            if (data.translatedText) {
              return data.translatedText;
            }
          }
        } catch (e) {
          console.log(`[AsizweAI Translation] LibreTranslate instance ${url} failed, trying next...`);
        }
      }

      throw new Error('All LibreTranslate instances failed');

    } catch (error) {
      console.error('[AsizweAI Translation] LibreTranslate error:', error);
      return text;
    }
  }

  getLanguageName(code) {
    const languages = {
      'en': 'English',
      'zu': 'Zulu',
      'xh': 'Xhosa',
      'af': 'Afrikaans',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'pt': 'Portuguese',
      'it': 'Italian',
      'ja': 'Japanese',
      'ko': 'Korean',
      'zh': 'Chinese',
      'hi': 'Hindi',
      'ar': 'Arabic',
      'ru': 'Russian'
    };

    return languages[code] || code;
  }
}
