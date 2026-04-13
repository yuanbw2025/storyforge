import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

// 从 localStorage 恢复主题
const savedTheme = localStorage.getItem('storyforge-theme') || 'midnight'
document.documentElement.setAttribute('data-theme', savedTheme)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/storyforge">
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
