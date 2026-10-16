import React from 'react';

interface Props { children: React.ReactNode; label?: string }
interface State { err: Error | null }

/** Render-time error boundary — turns white-screen crashes into a readable
 *  error card, keeping the rest of the shell alive. */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err: Error): State { return { err }; }
  componentDidCatch(err: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary]', this.props.label || '', err, info.componentStack);
  }
  reset = () => this.setState({ err: null });
  render() {
    if (!this.state.err) return this.props.children;
    const e = this.state.err;
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-xl w-full bg-danger-soft border border-danger-fg/40 rounded-xl p-5">
          <h2 className="text-base font-semibold text-danger mb-2">
            Trang bị lỗi runtime{this.props.label ? ` — ${this.props.label}` : ''}
          </h2>
          <p className="text-sm text-fg mb-3">{e.message || 'Unknown error'}</p>
          <details className="text-xs text-muted whitespace-pre-wrap break-all">
            <summary className="cursor-pointer text-fg mb-1">Stack</summary>
            {e.stack}
          </details>
          <button
            onClick={this.reset}
            className="mt-4 text-xs px-3 py-1.5 rounded bg-brand text-white hover:bg-brand-dark"
          >
            Thử lại
          </button>
        </div>
      </div>
    );
  }
}
