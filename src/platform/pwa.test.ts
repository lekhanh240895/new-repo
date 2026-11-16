import { describe, expect, it } from 'vitest'
import { detectPlatform, installOffer, type InstallState } from './install.ts'
import { autoDownloadAllowed, connectionKind, MODEL_CACHE, MODEL_DOWNLOAD_MB } from './offline.ts'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'

describe('install offer', () => {
  it('knows iPhone and iPad (which reports itself as a Mac with touch)', () => {
    expect(detectPlatform(IPHONE, 5)).toBe('ios')
    expect(detectPlatform(IPAD_AS_MAC, 5)).toBe('ios')
    expect(detectPlatform(IPAD_AS_MAC, 0)).toBe('other') // a real Mac
    expect(detectPlatform(ANDROID, 5)).toBe('other')
  })

  const base: InstallState = { installed: false, canPrompt: false, platform: 'other', dismissed: false }

  it('Android with the browser offer: one tap', () => {
    expect(installOffer({ ...base, canPrompt: true })).toBe('prompt')
  })

  it('iPhone: the Share → Add to Home Screen steps', () => {
    expect(installOffer({ ...base, platform: 'ios' })).toBe('iosSteps')
  })

  it('nothing when installed, dismissed, or the browser cannot install', () => {
    expect(installOffer({ ...base, canPrompt: true, installed: true })).toBeNull()
    expect(installOffer({ ...base, platform: 'ios', dismissed: true })).toBeNull()
    expect(installOffer(base)).toBeNull()
  })
})

describe('offline model download', () => {
  it('reads the connection type; data saver counts as mobile data', () => {
    expect(connectionKind({ type: 'wifi' })).toBe('wifi')
    expect(connectionKind({ type: 'ethernet' })).toBe('wifi')
    expect(connectionKind({ type: 'cellular' })).toBe('cellular')
    expect(connectionKind({ type: 'wifi', saveData: true })).toBe('cellular')
    expect(connectionKind({})).toBe('unknown')
    expect(connectionKind(undefined)).toBe('unknown') // iPhone Safari has no connection API
  })

  it('downloads by itself only on Wi-Fi; asks on mobile data and when unknown', () => {
    expect(autoDownloadAllowed('wifi')).toBe(true)
    expect(autoDownloadAllowed('cellular')).toBe(false)
    expect(autoDownloadAllowed('unknown')).toBe(false)
  })

  it('uses the service worker model cache and knows the size', () => {
    expect(MODEL_CACHE).toMatch(/^biomonitor-model-[0-9a-f]{8}$/)
    expect(MODEL_DOWNLOAD_MB).toBeGreaterThan(5)
    expect(MODEL_DOWNLOAD_MB).toBeLessThan(40)
  })
})
