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
import './index.css'

// Bug Finder (Settings → Bug Finder): catches crashes outside React's render
// cycle (event handlers, timers, fetches) — render-time crashes are caught
// by <ErrorBoundary> below instead.
installGlobalErrorReporting()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <LanguageProvider>
          <SettingsProvider>
            <AuthProvider>
              <DataProvider>
                <App />
              </DataProvider>
            </AuthProvider>
          </SettingsProvider>
        </LanguageProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
