import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import SeminarViewer from './components/SeminarViewer.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// /deck/<token> = 설명회 자료 공유 링크(로그인 없이 보기). 그 밖은 앱.
const deck = window.location.pathname.match(/^\/deck\/([A-Za-z0-9_-]{8,32})\/?$/)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary name="root">
      {deck ? <SeminarViewer token={deck[1]} /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
)
