type AudioEventMap = {
  time: { currentTime: number; duration: number };
  duration: number;
  ended: undefined;
  error: string;
};

type Listener<K extends keyof AudioEventMap> = (value: AudioEventMap[K]) => void;

class AudioEngine {
  private readonly audio = new Audio();
  private context: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private loadGeneration = 0;
  private readonly listeners = new Map<keyof AudioEventMap, Set<(value: never) => void>>();

  constructor() {
    this.audio.preload = 'metadata';
    this.audio.addEventListener('timeupdate', () => {
      this.emit('time', {
        currentTime: this.audio.currentTime,
        duration: Number.isFinite(this.audio.duration) ? this.audio.duration : 0,
      });
    });
    this.audio.addEventListener('durationchange', () => {
      this.emit('duration', Number.isFinite(this.audio.duration) ? this.audio.duration : 0);
    });
    this.audio.addEventListener('ended', () => this.emit('ended', undefined));
    this.audio.addEventListener('error', () => {
      const code = this.audio.error?.code;
      const detail = code ? `（媒体错误 ${code}）` : '';
      this.emit('error', `无法播放这个文件${detail}`);
    });
  }

  on<K extends keyof AudioEventMap>(event: K, listener: Listener<K>): () => void {
    const bucket = this.listeners.get(event) ?? new Set();
    bucket.add(listener as (value: never) => void);
    this.listeners.set(event, bucket);
    return () => bucket.delete(listener as (value: never) => void);
  }

  private emit<K extends keyof AudioEventMap>(event: K, value: AudioEventMap[K]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value as never);
  }

  async load(sourceUrl: string, autoplay: boolean): Promise<void> {
    const generation = ++this.loadGeneration;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.audio.src = sourceUrl;
    this.audio.load();
    if (autoplay) await this.play(generation);
  }

  async play(expectedGeneration = this.loadGeneration): Promise<void> {
    try {
      await this.ensureGraph();
      if (expectedGeneration !== this.loadGeneration || !this.audio.src) return;
      await this.audio.play();
    } catch (error) {
      if (expectedGeneration !== this.loadGeneration) return;
      this.emit('error', error instanceof Error ? error.message : '播放启动失败');
    }
  }

  pause(): void {
    this.audio.pause();
  }

  seek(time: number): void {
    if (!Number.isFinite(time)) return;
    this.audio.currentTime = Math.min(Math.max(0, time), this.audio.duration || time);
  }

  setVolume(volume: number): void {
    this.audio.volume = Math.min(1, Math.max(0, volume));
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  private async ensureGraph(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
      this.source = this.context.createMediaElementSource(this.audio);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.82;
      this.source.connect(this.analyser);
      this.analyser.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') await this.context.resume();
  }

  async dispose(): Promise<void> {
    this.loadGeneration += 1;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.listeners.clear();
    if (this.context && this.context.state !== 'closed') await this.context.close();
    this.context = null;
    this.source = null;
    this.analyser = null;
  }
}

export const audioEngine = new AudioEngine();
