import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider }     from './context/AuthContext.jsx'
import { LanguageProvider } from './context/LanguageContext.jsx'
import { DataProvider }     from './context/DataContext.jsx'
import { SettingsProvider } from './context/SettingsContext.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { installGlobalErrorReporting } from './utils/bugReporter.js'
import { getTenantPrefix } from './utils/tenantPath.js'
import './index.css'

// Bug Finder (Settings → Bug Finder): catches crashes outside React's render
// cycle (event handlers, timers, fetches) — render-time crashes are caught
// by <ErrorBoundary> below instead.
installGlobalErrorReporting()

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
              </DataProvider>
            </SettingsProvider>
          </AuthProvider>
        </LanguageProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
