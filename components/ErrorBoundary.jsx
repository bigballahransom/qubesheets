'use client';

// components/ErrorBoundary.jsx
//
// Reusable class error boundary (function components can't catch render
// errors). Catches render/lifecycle errors in its descendants, reports them
// to /api/debug/client-error, and renders `fallback` instead of letting the
// error reach app/error.tsx and blank the whole page.
//
// Props:
//   - fallback:  node, or (error, reset) => node. Defaults to null.
//   - onError:   optional (error, info) callback (e.g. toast + close modal).
//   - resetKey:  when it changes while an error is showing, the boundary
//                clears itself — so navigating to different content recovers.
//   - source:    label forwarded to the crash report.

import { Component } from 'react';
import { reportClientError } from '@/lib/client-error-reporting';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.reset = () => this.setState({ error: null });
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    reportClientError({
      message: error?.message || 'Unknown render error',
      stack: error?.stack,
      componentStack: info?.componentStack,
      source: this.props.source || 'ErrorBoundary',
    });
    try {
      this.props.onError?.(error, info);
    } catch {
      // onError must never re-throw inside the error path.
    }
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.reset();
    }
  }

  render() {
    if (this.state.error) {
      const { fallback = null } = this.props;
      return typeof fallback === 'function'
        ? fallback(this.state.error, this.reset)
        : fallback;
    }
    return this.props.children;
  }
}
