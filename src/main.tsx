import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import ErrorBoundary from './components/shared/ErrorBoundary'
import { ToastProvider } from './components/shared/Toast'
import './design-system/tokens.css'
import './design-system/components.css'
import './index.css'

// 路由级 theme 由各页面 wrapper 控制（forge/work/paper）
// 全局默认 auto（跟随系统：深色→work，浅色→paper）
const savedTheme = localStorage.getItem('storyforge-theme') || 'auto'
document.documentElement.setAttribute('data-theme', savedTheme)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter basename="/storyforge">
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
