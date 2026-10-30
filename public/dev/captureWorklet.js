// Hands the microphone's raw samples to the capture page, mixed down to mono
// as an AnalyserNode mixes them for mic mode, a block at a time.
const BLOCK = 4096

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.block = new Float32Array(BLOCK)
    this.filled = 0
  }

  process([channels]) {
    const frames = channels[0]?.length ?? 0
    for (let i = 0; i < frames; i++) {
      let sum = 0
      for (const channel of channels) sum += channel[i]
      this.block[this.filled++] = sum / channels.length
      if (this.filled === BLOCK) {
        this.port.postMessage(this.block, [this.block.buffer])
        this.block = new Float32Array(BLOCK)
        this.filled = 0
      }
    }
    return true
  }
}

registerProcessor('capture', CaptureProcessor)
