import { Component } from 'react';
// Class component — hooks are unavailable here, so translate off the
// i18next instance directly.
import i18n from '../i18n/index.js';

/**
 * Catches render/runtime errors in the React tree and shows a
 * friendly fallback instead of a blank white screen.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught:', error, info);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-card">
            <h1>{i18n.t('common.something_wrong')}</h1>
            <p>{i18n.t('common.unexpected_error')}</p>
            {this.state.error && (
              <pre className="error-boundary-detail">{String(this.state.error?.message || this.state.error)}</pre>
            )}
            <button className="btn btn-primary" onClick={this.handleReload}>{i18n.t('common.reload')}</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
