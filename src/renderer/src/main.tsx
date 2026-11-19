import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'

document.documentElement.classList.add(`platform-${window.bari?.platform ?? 'web'}`)
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary scope="app">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
