import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App.tsx'
import { registerServiceWorker } from './app/pwa.ts'
import './index.css'

const rootElement = document.getElementById('root')
if (rootElement === null) {
  throw new Error('BioMonitor: #root element not found in index.html')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

void registerServiceWorker()
