/**
 * All sounds are generated with Web Audio oscillators: no files, no network
 * (SPEC §11). Gains are relative to the phone's media volume — a web page
 * cannot set absolute dB, so setup plays a test tone.
 */
import type { AlarmLevel, ChimeKind, SpokenMessage } from '../core/fsm/types.ts'

export type VoiceLang = 'en' | 'vi'

export type VoiceMessage = SpokenMessage | 'calibrate' | 'batteryLow' | 'lookAtRoad' | 'focusDriving'

export interface AudioEngine {
  /** Call inside a tap handler (browsers block audio until a user gesture). Returns false if audio is unavailable. */
  unlock(): boolean;
  /** True when sound can play now. If false, the UI must rely on visual alerts (SPEC §12 F8). */
  isReady(): boolean;
  startAlarm(level: AlarmLevel): void;
  stopAlarm(): void;
  chime(kind: ChimeKind | 'test'): void;
  speak(message: VoiceMessage): void;
  /** Voice language. Falls back to English when the phone has no voice for it. */
  setLanguage(lang: VoiceLang): void;
  dispose(): void;
}

export const SPOKEN_TEXT: Record<VoiceLang, Record<VoiceMessage, string>> = {
  en: {
    fatigueAdvisory: 'Signs of fatigue. Plan a break soon.',
    fatigueStrong: 'You are tired. Please stop at a safe place.',
    takeBreak: 'Please take a break.',
    eyesHidden: 'Eyes not visible. Limited monitoring.',
    calibrate: 'Look at the road and blink normally.',
    batteryLow: 'Battery low. Please connect the charger.',
    lookAtRoad: 'Please look at the road.',
    focusDriving: 'Please focus on driving.',
  },
  vi: {
    fatigueAdvisory: 'Có dấu hiệu mệt mỏi. Hãy sớm nghỉ ngơi.',
    fatigueStrong: 'Bạn đang mệt. Hãy dừng xe ở nơi an toàn.',
    takeBreak: 'Hãy nghỉ ngơi một chút.',
    eyesHidden: 'Không thấy mắt. Giám sát bị hạn chế.',
    calibrate: 'Hãy nhìn đường và chớp mắt bình thường.',
    batteryLow: 'Pin yếu. Hãy cắm sạc.',
    lookAtRoad: 'Vui lòng nhìn đường.',
    focusDriving: 'Vui lòng tập trung lái xe.',
  },
}

const VOICE_LOCALE: Record<VoiceLang, string> = { en: 'en-US', vi: 'vi-VN' }

interface Tone {
  /** Seconds from the cycle start. */
  at: number;
  dur: number;
  freq: number;
  /** Optional end frequency (chirp). */
  toFreq?: number;
  gain: number;
  toGain?: number;
  type?: OscillatorType;
}

/** One repeating cycle per alarm level (SPEC §11). */
export const ALARM_PATTERNS: Record<AlarmLevel, { cycle: number; tones: Tone[] }> = {
  D1: { cycle: 2.5, tones: [{ at: 0, dur: 0.12, freq: 880, gain: 0.3 }, { at: 0.24, dur: 0.12, freq: 880, gain: 0.3 }] },
  L1: { cycle: 2.5, tones: [{ at: 0, dur: 0.12, freq: 880, gain: 0.3 }, { at: 0.24, dur: 0.12, freq: 880, gain: 0.3 }] },
  D2: { cycle: 1.2, tones: [{ at: 0, dur: 1.0, freq: 600, toFreq: 1400, gain: 0.4, toGain: 0.8 }] },
  L2: { cycle: 1.2, tones: [{ at: 0, dur: 1.0, freq: 600, toFreq: 1400, gain: 0.4, toGain: 0.8 }] },
  // Square waves sound much louder than sine at the same gain.
  L3: {
    cycle: 0.5,
    tones: [
      { at: 0, dur: 0.24, freq: 1000, gain: 0.6, type: 'square' },
      { at: 0.25, dur: 0.24, freq: 1500, gain: 0.6, type: 'square' },
    ],
  },
}

const CHIMES: Record<ChimeKind | 'test' | 'speechFallback', Tone[]> = {
  monitoringOff: [{ at: 0, dur: 0.25, freq: 660, gain: 0.25 }, { at: 0.3, dur: 0.35, freq: 440, gain: 0.25 }],
  paused: [0, 0.2, 0.4].map((at) => ({ at, dur: 0.12, freq: 520, gain: 0.25 })),
  test: [{ at: 0, dur: 0.4, freq: 880, gain: 0.4 }],
  speechFallback: [{ at: 0, dur: 0.2, freq: 587, gain: 0.25 }, { at: 0.25, dur: 0.3, freq: 784, gain: 0.25 }],
}

export interface AudioDeps {
  createContext?: () => AudioContext;
  speech?: SpeechSynthesis | null;
}

export function createAudioEngine(deps: AudioDeps = {}): AudioEngine {
  const makeContext =
    deps.createContext ??
    (() => {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (Ctor === undefined) throw new Error('Web Audio is not supported')
      return new Ctor()
    })
  const speech = deps.speech === undefined ? (typeof speechSynthesis === 'undefined' ? null : speechSynthesis) : deps.speech

  let ctx: AudioContext | null = null
  let keepAlive: ConstantSourceNode | null = null
  let alarmTimer: ReturnType<typeof setInterval> | null = null
  let alarmNodes: OscillatorNode[] = []
  let lang: VoiceLang = 'en'

  /** The phone's voice for `lang`, if it has one. */
  function voiceFor(l: VoiceLang): SpeechSynthesisVoice | null {
    if (speech === null) return null
    const prefix = l === 'vi' ? 'vi' : 'en'
    return speech.getVoices().find((v) => v.lang.toLowerCase().startsWith(prefix)) ?? null
  }

  function play(tones: readonly Tone[], startAt: number, track: boolean) {
    if (ctx === null) return
    for (const tone of tones) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const t0 = startAt + tone.at
      const t1 = t0 + tone.dur
      osc.type = tone.type ?? 'sine'
      osc.frequency.setValueAtTime(tone.freq, t0)
      if (tone.toFreq !== undefined) osc.frequency.linearRampToValueAtTime(tone.toFreq, t1)
      // Short attack/release to avoid clicks.
      gain.gain.setValueAtTime(0, t0)
      gain.gain.linearRampToValueAtTime(tone.gain, t0 + 0.01)
      gain.gain.linearRampToValueAtTime(tone.toGain ?? tone.gain, Math.max(t0 + 0.02, t1 - 0.03))
      gain.gain.linearRampToValueAtTime(0, t1)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0)
      osc.stop(t1 + 0.01)
      if (track) {
        alarmNodes.push(osc)
        osc.onended = () => {
          alarmNodes = alarmNodes.filter((n) => n !== osc)
        }
      }
    }
  }

  function ready(): boolean {
    if (ctx === null) return false
    if (ctx.state !== 'running') void ctx.resume().catch(() => {})
    return ctx.state === 'running'
  }

  const engine: AudioEngine = {
    unlock() {
      try {
        ctx ??= makeContext()
        void ctx.resume().catch(() => {})
        if (keepAlive === null) {
          // A silent, never-ending source keeps the audio output awake between alerts.
          keepAlive = ctx.createConstantSource()
          const silent = ctx.createGain()
          silent.gain.value = 0
          keepAlive.connect(silent).connect(ctx.destination)
          keepAlive.start()
        }
        // iOS only allows speech later if it was started once inside a gesture.
        speech?.speak(new SpeechSynthesisUtterance(''))
        return true
      } catch (err) {
        console.warn('BioMonitor: audio unavailable', err)
        return false
      }
    },
    isReady: ready,
    startAlarm(level) {
      engine.stopAlarm()
      if (!ready() || ctx === null) return
      const pattern = ALARM_PATTERNS[level]
      let next = ctx.currentTime + 0.02
      const scheduleCycle = () => {
        if (ctx === null) return
        // Schedule slightly ahead so timer jitter never leaves a gap.
        while (next < ctx.currentTime + pattern.cycle) {
          play(pattern.tones, Math.max(next, ctx.currentTime + 0.01), true)
          next += pattern.cycle
        }
      }
      scheduleCycle()
      alarmTimer = setInterval(scheduleCycle, Math.max(100, (pattern.cycle * 1000) / 2))
    },
    stopAlarm() {
      if (alarmTimer !== null) clearInterval(alarmTimer)
      alarmTimer = null
      for (const n of alarmNodes) {
        try {
          n.stop()
        } catch {
          // Already stopped.
        }
      }
      alarmNodes = []
    },
    chime(kind) {
      if (!ready() || ctx === null) return
      play(CHIMES[kind], ctx.currentTime + 0.02, false)
    },
    speak(message) {
      // Use the chosen language only if the phone can actually speak it.
      const voice = voiceFor(lang)
      const useLang: VoiceLang = lang !== 'en' && voice === null ? 'en' : lang
      const text = SPOKEN_TEXT[useLang][message]
      if (speech === null) {
        if (ready() && ctx !== null) play(CHIMES.speechFallback, ctx.currentTime + 0.02, false)
        return
      }
      try {
        speech.cancel()
        const u = new SpeechSynthesisUtterance(text)
        u.lang = VOICE_LOCALE[useLang]
        if (voice !== null && useLang === lang) u.voice = voice
        u.rate = 0.95
        speech.speak(u)
      } catch (err) {
        console.warn('BioMonitor: speech failed, using a tone', err)
        if (ready() && ctx !== null) play(CHIMES.speechFallback, ctx.currentTime + 0.02, false)
      }
    },
    setLanguage(l) {
      lang = l
    },
    dispose() {
      engine.stopAlarm()
      speech?.cancel()
      keepAlive?.stop()
      keepAlive = null
      void ctx?.close().catch(() => {})
      ctx = null
    },
  }
  return engine
}
