import { useEffect, useState } from 'react';

import { api } from '../lib/api.js';

type ChatModelAvailabilityResponse = {
  available: boolean;
};

type ChatModelAvailabilityState = {
  available: boolean;
  loading: boolean;
};

export function useChatModelAvailable(enabled = true): ChatModelAvailabilityState {
  const [state, setState] = useState<ChatModelAvailabilityState>({ available: true, loading: enabled });

  useEffect(() => {
    let cancelled = false;

    if (!enabled) {
      setState({ available: true, loading: false });
      return () => {
        cancelled = true;
      };
    }

    setState((current) => ({ ...current, loading: true }));

    api
      .getWrapped<ChatModelAvailabilityResponse>('/models/chat-available')
      .then((response) => {
        if (!cancelled) {
          setState({ available: response.data.available, loading: false });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ available: true, loading: false });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return state;
}
