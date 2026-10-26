import { useCallback, useReducer, useState } from 'react'
import { createSession, hudStatus, reduce } from '../core/fsm/index.ts'
import type { SessionEvent, SessionState } from '../core/fsm/index.ts'
import { DebugView } from './debug/DebugView.tsx'

type Tab = 'trip' | 'debug'

function sessionReducer(state: SessionState, event: SessionEvent): SessionState {
  // Effects are not run yet. The platform layer is wired to the FSM in M2.
  return reduce(state, event).state
}

function initialTab(): Tab {
  const params = new URLSearchParams(window.location.search)
  return params.has('debug') || params.has('replay') ? 'debug' : 'trip'
}

/** Placeholder trip screen: shows the state machine phases. Real screens come in M3. */
function TripDemo() {
  const [session, dispatch] = useReducer(sessionReducer, undefined, createSession)
  const send = useCallback(
    (type: 'START' | 'END_TRIP' | 'RESET') => dispatch({ type, t: performance.now() }),
    [],
  )
  return (
    <section>
      <p className="muted">State machine demo. The camera is not connected to it yet (M2).</p>
      <p>
        Phase: <strong>{session.phase}</strong> · HUD: <strong>{hudStatus(session)}</strong>
      </p>
      <div className="row">
        <button type="button" onClick={() => send('START')} disabled={session.phase !== 'IDLE'}>
          Start trip
        </button>
        <button type="button" onClick={() => send('END_TRIP')} disabled={session.phase === 'IDLE' || session.phase === 'SUMMARY'}>
          End trip
        </button>
        <button type="button" onClick={() => send('RESET')}>
          Reset
        </button>
      </div>
    </section>
  )
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
      {tab === 'trip' ? <TripDemo /> : <DebugView />}
    </main>
  )
}
