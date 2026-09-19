import DefaultTheme from 'vitepress/theme'
import FeedbackForm from './components/FeedbackForm.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('FeedbackForm', FeedbackForm)
  },
}
