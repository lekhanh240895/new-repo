import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App.tsx'
import { startOfflineModel } from './app/offlineModel.ts'
import { registerServiceWorker } from './app/pwa.ts'
import { initInstall } from './platform/install.ts'
import '@picocss/pico/css/pico.min.css'
import './index.css'

const rootElement = document.getElementById('root')
if (rootElement === null) {
  throw new Error('BioMonitor: #root element not found in index.html')
}

// Before the first render: the browser may offer installation right away.
initInstall()

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

void registerServiceWorker()
// After the page has loaded, so the ~18 MB model download never slows the first screen.
window.addEventListener('load', () => setTimeout(() => void startOfflineModel(), 2000), { once: true })
