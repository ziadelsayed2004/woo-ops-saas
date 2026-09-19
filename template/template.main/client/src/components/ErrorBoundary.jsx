import React, { Component } from 'react';
import './ErrorBoundary.css';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary__card">
            <h1 className="error-boundary__title">عذراً، حدث خطأ ما</h1>
            <p className="error-boundary__subtitle">
              لقد واجه النظام خطأً غير متوقع أثناء معالجة طلبك.
            </p>
            {this.state.error && (
              <pre className="error-boundary__error-text ltr-value">
                {this.state.error.toString()}
              </pre>
            )}
            <button onClick={this.handleReset} className="error-boundary__button">
              العودة إلى الرئيسية
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

