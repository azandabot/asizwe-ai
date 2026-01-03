// Language definitions for AsizweAI

export const SOURCE_LANGUAGES = [
  { code: 'auto', name: 'Auto-detect', flag: '' },
  { code: 'zu', name: 'Zulu', flag: '' },
  { code: 'xh', name: 'Xhosa', flag: '' },
  { code: 'af', name: 'Afrikaans', flag: '' },
  { code: 'en', name: 'English', flag: '' },
  { code: 'es', name: 'Spanish', flag: '' },
  { code: 'fr', name: 'French', flag: '' },
  { code: 'de', name: 'German', flag: '' },
  { code: 'pt', name: 'Portuguese', flag: '' },
  { code: 'it', name: 'Italian', flag: '' },
  { code: 'ja', name: 'Japanese', flag: '' },
  { code: 'ko', name: 'Korean', flag: '' },
  { code: 'zh', name: 'Chinese', flag: '' },
  { code: 'hi', name: 'Hindi', flag: '' },
  { code: 'ar', name: 'Arabic', flag: '' },
  { code: 'ru', name: 'Russian', flag: '' }
];

export const TARGET_LANGUAGES = [
  { code: 'en', name: 'English', flag: '', ttsLang: 'en-US' },
  { code: 'zu', name: 'Zulu', flag: '', ttsLang: 'zu-ZA' },
  { code: 'af', name: 'Afrikaans', flag: '', ttsLang: 'af-ZA' },
  { code: 'es', name: 'Spanish', flag: '', ttsLang: 'es-ES' },
  { code: 'fr', name: 'French', flag: '', ttsLang: 'fr-FR' },
  { code: 'de', name: 'German', flag: '', ttsLang: 'de-DE' },
  { code: 'pt', name: 'Portuguese', flag: '', ttsLang: 'pt-PT' },
  { code: 'it', name: 'Italian', flag: '', ttsLang: 'it-IT' },
  { code: 'ja', name: 'Japanese', flag: '', ttsLang: 'ja-JP' },
  { code: 'ko', name: 'Korean', flag: '', ttsLang: 'ko-KR' },
  { code: 'zh', name: 'Chinese', flag: '', ttsLang: 'zh-CN' },
  { code: 'hi', name: 'Hindi', flag: '', ttsLang: 'hi-IN' },
  { code: 'ar', name: 'Arabic', flag: '', ttsLang: 'ar-SA' }
];

export function getLanguageName(code) {
  const language = SOURCE_LANGUAGES.find(l => l.code === code)
                || TARGET_LANGUAGES.find(l => l.code === code);
  return language?.name || code;
}

export function getTTSLanguage(code) {
  const language = TARGET_LANGUAGES.find(l => l.code === code);
  return language?.ttsLang || 'en-US';
}
