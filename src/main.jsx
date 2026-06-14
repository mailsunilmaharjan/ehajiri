import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider }     from './context/AuthContext.jsx'
import { LanguageProvider } from './context/LanguageContext.jsx'
import { DataProvider }     from './context/DataContext.jsx'
import { SettingsProvider } from './context/SettingsContext.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
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
  </React.StrictMode>,
)
