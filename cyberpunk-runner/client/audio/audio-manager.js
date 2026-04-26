export class AudioManager {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.initialized = false;
    this.musicNodes = [];
  }

  init() {
    // Defer AudioContext creation to user interaction
    const unlock = () => {
      if (this.initialized) return;
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.5;
      this.masterGain.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.3;
      this.musicGain.connect(this.masterGain);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.6;
      this.sfxGain.connect(this.masterGain);

      this.initialized = true;
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };

    window.addEventListener('click', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock);
  }

  playMusic() {
    if (!this.initialized) return;
    this._stopMusic();

    // Procedural ambient cyberpunk music using oscillators
    const now = this.ctx.currentTime;

    // Bass drone
    const bass = this.ctx.createOscillator();
    bass.type = 'sawtooth';
    bass.frequency.value = 55;
    const bassFilter = this.ctx.createBiquadFilter();
    bassFilter.type = 'lowpass';
    bassFilter.frequency.value = 200;
    const bassGain = this.ctx.createGain();
    bassGain.gain.value = 0.15;
    bass.connect(bassFilter).connect(bassGain).connect(this.musicGain);
    bass.start(now);
    this.musicNodes.push(bass);

    // Pad
    const pad = this.ctx.createOscillator();
    pad.type = 'sine';
    pad.frequency.value = 220;
    const padGain = this.ctx.createGain();
    padGain.gain.value = 0.05;
    pad.connect(padGain).connect(this.musicGain);
    pad.start(now);
    this.musicNodes.push(pad);

    // LFO for pad
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.2;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 30;
    lfo.connect(lfoGain).connect(pad.frequency);
    lfo.start(now);
    this.musicNodes.push(lfo);

    // High arpeggio notes
    const notes = [440, 523, 659, 784, 659, 523];
    let noteIndex = 0;
    const arpInterval = setInterval(() => {
      if (!this.initialized) {
        clearInterval(arpInterval);
        return;
      }
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = notes[noteIndex % notes.length];
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.04, this.ctx.currentTime);
      env.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.3);
      osc.connect(env).connect(this.musicGain);
      osc.start(this.ctx.currentTime);
      osc.stop(this.ctx.currentTime + 0.3);
      noteIndex++;
    }, 400);
    this._arpInterval = arpInterval;
  }

  _stopMusic() {
    for (const node of this.musicNodes) {
      try { node.stop(); } catch (e) { /* already stopped */ }
    }
    this.musicNodes = [];
    if (this._arpInterval) {
      clearInterval(this._arpInterval);
      this._arpInterval = null;
    }
  }

  playCollect() {
    if (!this.initialized) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1760, this.ctx.currentTime + 0.1);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);
    osc.connect(gain).connect(this.sfxGain);
    osc.start(this.ctx.currentTime);
    osc.stop(this.ctx.currentTime + 0.15);
  }

  playKeyFragment() {
    if (!this.initialized) return;
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, this.ctx.currentTime + i * 0.1);
      gain.gain.linearRampToValueAtTime(0.15, this.ctx.currentTime + i * 0.1 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + i * 0.1 + 0.2);
      osc.connect(gain).connect(this.sfxGain);
      osc.start(this.ctx.currentTime + i * 0.1);
      osc.stop(this.ctx.currentTime + i * 0.1 + 0.2);
    });
  }

  playDeath() {
    if (!this.initialized) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(440, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(55, this.ctx.currentTime + 0.5);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.5);
    const dist = this.ctx.createWaveShaperFunction
      ? null
      : this.ctx.createWaveShaper();
    if (dist) {
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        const x = (i / 128) - 1;
        curve[i] = (Math.PI + 200 * x) / (Math.PI + 200 * Math.abs(x));
      }
      dist.curve = curve;
      osc.connect(dist).connect(gain).connect(this.sfxGain);
    } else {
      osc.connect(gain).connect(this.sfxGain);
    }
    osc.start(this.ctx.currentTime);
    osc.stop(this.ctx.currentTime + 0.5);
  }

  startOverdrive() {
    if (!this.initialized) return;
    // Add distortion effect to music
    if (this.musicGain) {
      this.musicGain.gain.linearRampToValueAtTime(0.5, this.ctx.currentTime + 0.2);
    }
  }

  stopOverdrive() {
    if (!this.initialized) return;
    if (this.musicGain) {
      this.musicGain.gain.linearRampToValueAtTime(0.3, this.ctx.currentTime + 0.5);
    }
  }

  dispose() {
    this._stopMusic();
    if (this.ctx) {
      this.ctx.close();
    }
    this.initialized = false;
  }
}
