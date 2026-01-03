// Stream Manager - Handles audio capture from tab

// Helper to send debug logs to service worker
function debugLog(...args) {
  const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  console.log(...args);
  try {
    chrome.runtime.sendMessage({ type: 'DEBUG_LOG', message }).catch(() => {});
  } catch (e) {}
}

export class StreamManager {
  constructor() {
    this.mediaStream = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.gainNode = null;
    this.processorNode = null;
    this.onAudioData = null;
  }

  async start(streamId, originalVolume = 30) {
    try {
      debugLog('[StreamManager] Starting with streamId:', streamId?.substring(0, 20) + '...');

      // Get media stream from tab
      debugLog('[StreamManager] Getting user media...');
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: streamId
          }
        },
        video: false
      });
      debugLog('[StreamManager] Got media stream, tracks:', this.mediaStream.getAudioTracks().length);

      // Create audio context with 16kHz sample rate for STT
      this.audioContext = new AudioContext({
        sampleRate: 16000
      });
      debugLog('[StreamManager] AudioContext created, state:', this.audioContext.state);

      // Resume audio context if suspended
      if (this.audioContext.state === 'suspended') {
        debugLog('[StreamManager] Resuming suspended AudioContext...');
        await this.audioContext.resume();
        debugLog('[StreamManager] AudioContext resumed, state:', this.audioContext.state);
      }

      // Create source from media stream
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      debugLog('[StreamManager] Source node created');

      // Create gain node for volume control
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = originalVolume / 100;

      // Connect source to gain and gain to destination (for playback)
      this.sourceNode.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);
      debugLog('[StreamManager] Audio routing connected');

      // Set up audio processing - try ScriptProcessor first (more reliable)
      // AudioWorklet can be problematic in offscreen documents
      this.setupScriptProcessor();

      debugLog('[StreamManager] Stream manager started successfully');
      return true;

    } catch (error) {
      debugLog('[StreamManager] ERROR starting:', error.message);
      debugLog('[StreamManager] Error stack:', error.stack);
      throw error;
    }
  }

  async setupAudioWorklet() {
    try {
      // Load the audio worklet module - use chrome.runtime.getURL for correct path
      const workletUrl = chrome.runtime.getURL('lib/audio-processor.js');
      console.log('[AsizweAI StreamManager] Loading worklet from:', workletUrl);
      await this.audioContext.audioWorklet.addModule(workletUrl);
      console.log('[AsizweAI StreamManager] Worklet module loaded');

      // Create the processor node
      this.processorNode = new AudioWorkletNode(this.audioContext, 'audio-capture-processor');
      console.log('[AsizweAI StreamManager] AudioWorkletNode created');

      // Handle messages from the worklet
      let chunkCount = 0;
      this.processorNode.port.onmessage = (event) => {
        if (event.data.type === 'audioData' && this.onAudioData) {
          chunkCount++;
          if (chunkCount % 50 === 1) {
            console.log('[AsizweAI StreamManager] Audio chunk received, count:', chunkCount);
          }
          this.onAudioData(event.data.buffer);
        }
      };

      // Connect source to processor (parallel to playback path)
      this.sourceNode.connect(this.processorNode);

      console.log('[AsizweAI StreamManager] Audio worklet setup complete');

    } catch (error) {
      console.error('[AsizweAI StreamManager] Error setting up audio worklet:', error);
      console.log('[AsizweAI StreamManager] Falling back to ScriptProcessorNode');
      // Fall back to ScriptProcessorNode (deprecated but more compatible)
      this.setupScriptProcessor();
    }
  }

  setupScriptProcessor() {
    debugLog('[StreamManager] Setting up ScriptProcessor for audio capture');

    const bufferSize = 4096;
    // ScriptProcessor with 1 input channel, 1 output channel
    const scriptProcessor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

    let chunkCount = 0;
    scriptProcessor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);

      // Pass through audio to output (required for ScriptProcessor to fire events)
      const outputData = event.outputBuffer.getChannelData(0);
      outputData.set(inputData);

      if (this.onAudioData) {
        chunkCount++;
        if (chunkCount === 1) {
          debugLog('[StreamManager] First audio chunk captured!');
        }
        if (chunkCount % 100 === 0) {
          debugLog('[StreamManager] Audio chunks captured:', chunkCount);
        }
        // Convert to 16-bit PCM
        const pcmData = this.floatTo16BitPCM(inputData);
        this.onAudioData(pcmData);
      } else {
        if (chunkCount === 0) {
          debugLog('[StreamManager] WARNING: No onAudioData callback set!');
          chunkCount = -1; // Prevent repeated warnings
        }
      }
    };

    // IMPORTANT: ScriptProcessor MUST be connected to destination to fire onaudioprocess
    // We insert it between source and gain node to capture audio
    // Disconnect the direct source->gain connection first
    this.sourceNode.disconnect(this.gainNode);

    // New chain: source -> scriptProcessor -> gainNode -> destination
    this.sourceNode.connect(scriptProcessor);
    scriptProcessor.connect(this.gainNode);
    // gainNode is already connected to destination from start()

    this.processorNode = scriptProcessor;
    debugLog('[StreamManager] ScriptProcessor setup complete, audio chain: source->processor->gain->destination');
  }

  floatTo16BitPCM(float32Array) {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);

    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    return buffer;
  }

  setOriginalVolume(volume) {
    if (this.gainNode) {
      // Smooth transition
      const currentTime = this.audioContext.currentTime;
      this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, currentTime);
      this.gainNode.gain.linearRampToValueAtTime(volume / 100, currentTime + 0.1);
    }
  }

  stop() {
    try {
      // Stop the processor
      if (this.processorNode) {
        if (this.processorNode.port) {
          this.processorNode.port.postMessage({ type: 'stop' });
        }
        this.processorNode.disconnect();
        this.processorNode = null;
      }

      // Disconnect nodes
      if (this.sourceNode) {
        this.sourceNode.disconnect();
        this.sourceNode = null;
      }

      if (this.gainNode) {
        this.gainNode.disconnect();
        this.gainNode = null;
      }

      // Close audio context
      if (this.audioContext) {
        this.audioContext.close();
        this.audioContext = null;
      }

      // Stop media stream tracks
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => track.stop());
        this.mediaStream = null;
      }

      console.log('Stream manager stopped');

    } catch (error) {
      console.error('Error stopping stream manager:', error);
    }
  }
}
