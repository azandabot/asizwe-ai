// Constants for AsizweAI

export const APP_NAME = 'AsizweAI';
export const APP_TAGLINE = 'Let Us Hear';
export const APP_VERSION = '1.0.0';

// Default settings
export const DEFAULT_SETTINGS = {
  sttProvider: 'openai',
  translationProvider: 'openai',
  ttsProvider: 'native',
  ttsSpeed: 1.0,
  sourceLanguage: 'auto',
  targetLanguage: 'en',
  originalVolume: 30,
  translationVolume: 100
};

// Status types
export const STATUS = {
  IDLE: 'idle',
  LISTENING: 'listening',
  TRANSLATING: 'translating',
  SPEAKING: 'speaking',
  ERROR: 'error'
};

// Message types
export const MESSAGE_TYPES = {
  START_CAPTURE: 'START_CAPTURE',
  STOP_CAPTURE: 'STOP_CAPTURE',
  GET_STATE: 'GET_STATE',
  CAPTURE_STARTED: 'CAPTURE_STARTED',
  CAPTURE_STOPPED: 'CAPTURE_STOPPED',
  TRANSCRIPT_UPDATE: 'TRANSCRIPT_UPDATE',
  STATUS_UPDATE: 'STATUS_UPDATE',
  ERROR: 'ERROR',
  UPDATE_SOURCE_LANG: 'UPDATE_SOURCE_LANG',
  UPDATE_TARGET_LANG: 'UPDATE_TARGET_LANG',
  UPDATE_ORIGINAL_VOLUME: 'UPDATE_ORIGINAL_VOLUME',
  UPDATE_TRANSLATION_VOLUME: 'UPDATE_TRANSLATION_VOLUME'
};

// API endpoints
export const API_ENDPOINTS = {
  OPENAI_TRANSCRIPTION: 'https://api.openai.com/v1/audio/transcriptions',
  OPENAI_CHAT: 'https://api.openai.com/v1/chat/completions',
  OPENAI_MODELS: 'https://api.openai.com/v1/models',
  DEEPGRAM_LISTEN: 'wss://api.deepgram.com/v1/listen',
  ELEVENLABS_TTS: 'https://api.elevenlabs.io/v1/text-to-speech'
};

// Audio settings
export const AUDIO_SETTINGS = {
  SAMPLE_RATE: 16000,
  BUFFER_SIZE: 4096,
  MAX_BUFFER_DURATION: 5000, // ms
  SILENCE_TIMEOUT: 1500 // ms
};
