import { describe, expect, it } from 'vitest'
import { STRINGS } from './i18n.ts'

describe('i18n', () => {
  it('Vietnamese has every English key, and no text is empty', () => {
    expect(Object.keys(STRINGS.vi).sort()).toEqual(Object.keys(STRINGS.en).sort())
    for (const table of Object.values(STRINGS)) {
      for (const [key, text] of Object.entries(table)) expect(text.trim(), key).not.toBe('')
    }
  })

  it('Vietnamese text is actually translated (not copied English), except names', () => {
    const same = Object.keys(STRINGS.en).filter((k) => STRINGS.en[k as keyof typeof STRINGS.en] === STRINGS.vi[k as keyof typeof STRINGS.vi])
    expect(same).toEqual(['app.title'])
  })
})
