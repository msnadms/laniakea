import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const root = createRoot(document.getElementById('root')!)

const renderApp = () =>
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )

const fontsReady = Promise.all([
  document.fonts.load('400 14px "IBM Plex Mono"'),
  document.fonts.load('600 14px "Saira Condensed"'),
])

Promise.race([fontsReady, new Promise((r) => setTimeout(r, 1500))]).then(renderApp, renderApp)
