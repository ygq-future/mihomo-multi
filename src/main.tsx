import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Globally disable browser default context menu for pure desktop app feel
if (typeof window !== 'undefined') {
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault()
  })
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
