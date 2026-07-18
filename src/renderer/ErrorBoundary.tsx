import { Component, type ErrorInfo, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Renderer isolated an unexpected error', error, info);
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <main className="fatal-state">
          <div className="brand__mark"><span /></div>
          <h1>界面暂时无法显示</h1>
          <p>音乐文件没有被修改。请重新启动 Lyralume；日志中已保留错误信息。</p>
          <button className="button button--primary" type="button" onClick={() => window.location.reload()}>重新载入</button>
        </main>
      );
    }
    return this.props.children;
  }
}
