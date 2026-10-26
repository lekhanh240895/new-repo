import { useCallback, useReducer } from 'react'
import { createSession, hudStatus, reduce } from '../core/fsm/index.ts'
import type { SessionEvent, SessionState } from '../core/fsm/index.ts'

function sessionReducer(state: SessionState, event: SessionEvent): SessionState {
  // M0: effects are not run yet. The platform layer arrives in M1–M2.
  return reduce(state, event).state
}

/**
 * M0 placeholder. Shows that the core is wired in.
 * The real Setup / Dark Cockpit screens come in M3.
 */
export function App() {
  const [session, dispatch] = useReducer(sessionReducer, undefined, createSession)
  const send = useCallback(
    (type: 'START' | 'END_TRIP' | 'RESET') => dispatch({ type, t: performance.now() }),
    [],
  )

  return (
    <main className="app">
      <h1>BioMonitor DMS</h1>
      <p className="muted">Milestone M0 — core state machine only. No camera yet.</p>
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
    </main>
  )
}
