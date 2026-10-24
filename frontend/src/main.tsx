import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Bundled locally so the reader keeps its typography offline.
import "@fontsource-variable/inter";
import "@fontsource-variable/source-serif-4/opsz.css";
import "@fontsource/noto-serif-sc/chinese-simplified-400.css";
import "@fontsource/noto-serif-sc/chinese-simplified-600.css";
import "./styles.css";
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  render() {
    return this.state.error ? (
      <div className="fatal-error">
        <h1>页面遇到问题</h1>
        <p>你的文件仍保存在本机。刷新页面或返回文献库后重试。</p>
        <pre>{this.state.error}</pre>
        <a href="/">返回文献库</a>
      </div>
    ) : (
      this.props.children
    );
  }
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
