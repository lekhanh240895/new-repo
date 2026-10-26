import { useState } from 'react'
import { DebugView } from './debug/DebugView.tsx'
import { setLang, useLang, type Lang } from './i18n.ts'
import { TripView } from './trip/TripView.tsx'

type Tab = 'trip' | 'debug'

function initialTab(): Tab {
  const params = new URLSearchParams(window.location.search)
  const tab = params.get('tab')
  if (tab === 'trip' || tab === 'debug') return tab
  return params.has('debug') || params.has('replay') ? 'debug' : 'trip'
}

const LANGS: readonly { code: Lang; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'vi', label: 'VI' },
]

export function App() {
  const [tab, setTab] = useState<Tab>(initialTab)
  const { lang, t } = useLang()
  return (
    <main className="app">
      <header className="app-header">
        <h1>{t('app.title')}</h1>
        <div className="lang" role="group" aria-label={t('lang.label')}>
          {LANGS.map((l) => (
            <button key={l.code} type="button" aria-pressed={lang === l.code} onClick={() => setLang(l.code)}>
              {l.label}
            </button>
          ))}
        </div>
      </header>
      <nav className="tabs" aria-label="Views">
        <button type="button" aria-pressed={tab === 'trip'} onClick={() => setTab('trip')}>
          {t('tab.trip')}
        </button>
        <button type="button" aria-pressed={tab === 'debug'} onClick={() => setTab('debug')}>
          {t('tab.debug')}
        </button>
      </nav>
      {tab === 'trip' ? <TripView /> : <DebugView />}
    </main>
  )
}
