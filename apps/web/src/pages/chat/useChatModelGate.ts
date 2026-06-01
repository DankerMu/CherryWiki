import { useEffect, useState } from 'react';

import { api } from '../../lib/api.js';

type ChatModelAvailabilityResponse = {
  available: boolean;
};

type ChatModelGateState = {
  available: boolean;
  loading: boolean;
};

export function useChatModelGate(enabled: boolean): ChatModelGateState {
  const [state, setState] = useState<ChatModelGateState>({ available: true, loading: enabled });

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
