import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider }     from './context/AuthContext.jsx'
import { LanguageProvider } from './context/LanguageContext.jsx'
import { DataProvider }     from './context/DataContext.jsx'
import { SettingsProvider } from './context/SettingsContext.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import SelectEnhancer from './components/Common/SelectEnhancer.jsx'
import { installGlobalErrorReporting } from './utils/bugReporter.js'
import { getTenantPrefix } from './utils/tenantPath.js'
import { installUploadGuard } from './utils/uploadGuard.js'
import { installButtonTags } from './utils/buttonTags.js'
import { reloadOnceForChunkError } from './utils/chunkReload.js'
import './index.css'
import './ui-kit.css'

// Bug Finder (Settings → Bug Finder): catches crashes outside React's render
// cycle (event handlers, timers, fetches) — render-time crashes are caught
// by <ErrorBoundary> below instead.
installGlobalErrorReporting()

// A lazy page chunk that no longer exists (new build deployed while this tab
// was open) → reload once to get the new build. See utils/chunkReload.js.
window.addEventListener('vite:preloadError', (e) => {
  if (reloadOnceForChunkError()) e.preventDefault()
})

// Blocks programs / scripts / disguised files the moment they are picked in any file input (server re-checks every upload).
installUploadGuard()

// Print buttons blue, Export buttons green — the same on every page (see utils/buttonTags.js + ui-kit.css).
installButtonTags()

// Registers the (deliberately no-op / non-caching) service worker so the
// browser recognizes the app as installable — see public/service-worker.js
// for why it never intercepts/caches anything.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {})
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter basename={getTenantPrefix() || undefined}>
        <LanguageProvider>
          <AuthProvider>
            {/* Settings/Data must sit inside AuthProvider: both refetch from
                the API when the user logs in (their endpoints are authGuarded,
                so a logged-out fetch can only ever 401). */}
            <SettingsProvider>
              <DataProvider>
                <App />
                <SelectEnhancer />
              </DataProvider>
            </SettingsProvider>
          </AuthProvider>
        </LanguageProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
