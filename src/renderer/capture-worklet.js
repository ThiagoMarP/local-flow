// AudioWorklet capture processor. Runs on the dedicated audio thread and ships
// buffered PCM frames (plus each frame's peak amplitude) back to the renderer,
// replacing the deprecated ScriptProcessorNode for steadier, glitch-free
// capture that doesn't compete with the main thread.
const FRAME = 1024;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(FRAME);
    this.filled = 0;
  }

  process(inputs) {
    // Mono input, first channel. process() is called per 128-sample render
    // quantum; we accumulate into FRAME-sized chunks to keep message traffic
    // close to the old ScriptProcessor cadence.
    const channel = inputs[0] && inputs[0][0];
    if (!channel || channel.length === 0) return true;
    for (let index = 0; index < channel.length; index++) {
      this.buffer[this.filled++] = channel[index];
      if (this.filled === FRAME) this.flush();
    }
    return true;
  }

  flush() {
    const samples = this.buffer.slice(0, this.filled);
    let peak = 0;
    let sumSquares = 0;
    for (let index = 0; index < samples.length; index++) {
      const value = Math.abs(samples[index]);
      if (value > peak) peak = value;
      sumSquares += samples[index] * samples[index];
    }
    const rms = Math.sqrt(sumSquares / Math.max(1, samples.length));
    // Transfer the buffer so the renderer owns it without a copy.
    this.port.postMessage({ samples, peak, rms }, [samples.buffer]);
    this.filled = 0;
  }
}

registerProcessor("capture-processor", CaptureProcessor);
