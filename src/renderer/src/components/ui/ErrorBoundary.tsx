import { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { GlassSurface } from './GlassSurface'
import { GlassButton } from './GlassButton'

interface Props {
  children: ReactNode
  fallbackTitle?: string
  onReset?: () => void
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[Lumos ErrorBoundary] Caught render error:', error, errorInfo)
  }

  public handleReset = (): void => {
    this.setState({ hasError: false, error: null })
    this.props.onReset?.()
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="p-6 flex flex-col items-center justify-center text-center">
          <GlassSurface intensity="elevated" className="p-6 max-w-md flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-semibold text-white tracking-tight">
              {this.props.fallbackTitle || 'Surface Render Interrupted'}
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              {this.state.error?.message || 'A defensive boundary caught an unexpected UI state.'}
            </p>
            <GlassButton
              variant="standard"
              size="sm"
              onClick={this.handleReset}
              className="mt-2 text-xs"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Restore Surface</span>
            </GlassButton>
          </GlassSurface>
        </div>
      )
    }

    return this.props.children
  }
}
export default ErrorBoundary
