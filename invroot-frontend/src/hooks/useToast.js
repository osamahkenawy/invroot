import { useState, useCallback, useRef } from 'react';

/**
 * Toast notification hook.
 * @param {number} duration - auto-dismiss delay in ms
 * @returns {{ toasts, showToast, dismissToast }}
 */
export default function useToast(duration = 3500) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismissToast = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message, type = 'success') => {
    const id = ++idRef.current;
    setToasts((list) => [...list, { id, message, type }]);
    if (duration > 0) {
      setTimeout(() => dismissToast(id), duration);
    }
    return id;
  }, [duration, dismissToast]);

  return { toasts, showToast, dismissToast };
}
