import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

interface Props {
  /** "page": the rest of the app stays usable. "app": the whole window failed to draw. */
  scope: 'page' | 'app'
  /** Shown as secondary actions under the message (page scope). */
  actions?: (reset: () => void) => ReactNode
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches an exception thrown while drawing, so a bug in one view shows a message instead of a blank window.
 * Nothing is sent anywhere: the message is shown on screen and written to the local developer console only.
 * Project data is not affected; imports, curation and saved views are written by the main process.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Render error', error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  override render() {
    const { error } = this.state
    if (!error) return this.props.children
    const app = this.props.scope === 'app'
    return (
      <div className="empty" style={{ flex: 1, padding: 40, minHeight: app ? '100vh' : undefined }} role="alert" data-testid={`error-boundary-${this.props.scope}`}>
        <div className="ic"><AlertTriangle /></div>
        <h3>{app ? 'The window could not be drawn' : 'This page could not be drawn'}</h3>
        <p style={{ maxWidth: 560 }}>
          Something went wrong while drawing {app ? 'the app' : 'this page'}. Your project is safe: nothing here changes saved data.
          {app ? ' Reload the window to continue.' : ' Try again, or go to another page from the sidebar.'}
        </p>
        <pre className="small muted" style={{ maxWidth: 640, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '4px 0 12px' }}>{error.message || String(error)}</pre>
        <div className="row" style={{ justifyContent: 'center' }}>
          {app ? (
            <button className="btn primary" onClick={() => location.reload()}><RotateCcw size={15} /> Reload window</button>
          ) : (
            <>
              <button className="btn primary" onClick={this.reset} data-testid="error-retry"><RotateCcw size={15} /> Try again</button>
              {this.props.actions?.(this.reset)}
            </>
          )}
        </div>
      </div>
    )
  }
}
