import { useState } from 'react'
import { DebugView } from './debug/DebugView.tsx'
import { TripView } from './trip/TripView.tsx'

type Tab = 'trip' | 'debug'

function initialTab(): Tab {
  const params = new URLSearchParams(window.location.search)
  const tab = params.get('tab')
  if (tab === 'trip' || tab === 'debug') return tab
  return params.has('debug') || params.has('replay') ? 'debug' : 'trip'
}

export function App() {
  const [tab, setTab] = useState<Tab>(initialTab)
  return (
    <main className="app">
      <h1>BioMonitor DMS</h1>
      <nav className="tabs" aria-label="Views">
        <button type="button" aria-pressed={tab === 'trip'} onClick={() => setTab('trip')}>
          Trip
        </button>
        <button type="button" aria-pressed={tab === 'debug'} onClick={() => setTab('debug')}>
          Debug
        </button>
      </nav>
      {tab === 'trip' ? <TripView /> : <DebugView />}
    </main>
  )
}
