import { createContext, useContext } from 'react';
import useToast from '../hooks/useToast.js';
import Toast from '../components/Toast.jsx';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const { toasts, showToast, dismissToast } = useToast();
  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

/**
 * Access the global toast trigger: const { showToast } = useToastContext();
 */
export function useToastContext() {
  const ctx = useContext(ToastContext);
  if (!ctx) return { showToast: () => {} };
  return ctx;
}
