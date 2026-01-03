// AudioWorklet processor for capturing and buffering audio data
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096; // Buffer size for sending chunks
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
    this.isRecording = true;

    // Listen for control messages
    this.port.onmessage = (event) => {
      if (event.data.type === 'stop') {
        this.isRecording = false;
      } else if (event.data.type === 'start') {
        this.isRecording = true;
      }
    };
  }

  process(inputs, outputs, parameters) {
    if (!this.isRecording) {
      return true;
    }

    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }

    const channelData = input[0]; // Mono channel
    if (!channelData) {
      return true;
    }

    // Buffer the audio data
    for (let i = 0; i < channelData.length; i++) {
      this.buffer[this.bufferIndex++] = channelData[i];

      // When buffer is full, send it
      if (this.bufferIndex >= this.bufferSize) {
        // Convert to 16-bit PCM
        const pcmData = this.floatTo16BitPCM(this.buffer);

        // Send to main thread
        this.port.postMessage({
          type: 'audioData',
          buffer: pcmData
        }, [pcmData]);

        // Reset buffer
        this.bufferIndex = 0;
        this.buffer = new Float32Array(this.bufferSize);
      }
    }

    return true;
  }

  floatTo16BitPCM(float32Array) {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);

    for (let i = 0; i < float32Array.length; i++) {
      // Clamp value between -1 and 1
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      // Convert to 16-bit signed integer
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    return buffer;
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
