// Last-resort UI for React render crashes: report, then offer a reload instead
// of a white screen. State lives on the server, so reloading is always safe.

import * as Sentry from '@sentry/react'
import { Component, type ReactNode } from 'react'
import { reportClientError } from './error-report.js'
import { t } from './i18n/index.js'

interface Props {
  children: ReactNode
}

interface State {
  crashed: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { crashed: false }

  static getDerivedStateFromError(): State {
    return { crashed: true }
  }

  override componentDidCatch(error: Error): void {
    // Render crashes never reach window.onerror in prod — hand them to Sentry
    // explicitly (no-op when the SDK is not initialized, e.g. dev/tests).
    Sentry.captureException(error)
    reportClientError({ message: error.message, stack: error.stack, source: 'react' })
  }

  override render(): ReactNode {
    if (!this.state.crashed) return this.props.children
    return (
      <div className="screen">
        <div className="panel">
          <h2>{t('errors.title')}</h2>
          <p className="hint-text">{t('errors.body')}</p>
          <button className="btn" onClick={() => window.location.reload()}>
            {t('errors.reload')}
          </button>
        </div>
      </div>
    )
  }
}
