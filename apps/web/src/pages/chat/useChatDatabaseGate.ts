import { useEffect, useMemo, useState } from 'react';

import { api } from '../../lib/api.js';
import { isSpaceDatabaseEnabled } from './chatScopeUtils.js';
import type { ChatSettings, ChatSpaceDetail } from './types.js';

type UseChatDatabaseGateParams = {
  spaceId: string;
  isAuthenticated: boolean;
  isAllowed: boolean;
  selectedSpaceIds: string[];
  chatSettings: ChatSettings;
  updateChatSettings: (settings: ChatSettings) => void;
};

export function useChatDatabaseGate({
  spaceId,
  isAuthenticated,
  isAllowed,
  selectedSpaceIds,
  chatSettings,
  updateChatSettings,
}: UseChatDatabaseGateParams) {
  const [spaceDatabaseEnabled, setSpaceDatabaseEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!isAuthenticated || spaceId.length === 0 || !isAllowed) {
      setSpaceDatabaseEnabled(false);
      return () => {
        cancelled = true;
      };
    }

    api
      .get<ChatSpaceDetail>(`/spaces/${encodeURIComponent(spaceId)}`)
      .then((space) => {
        if (!cancelled) {
          setSpaceDatabaseEnabled(isSpaceDatabaseEnabled(space.database_config));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSpaceDatabaseEnabled(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isAllowed, isAuthenticated, spaceId]);

  const databaseAvailable = useMemo(
    () => selectedSpaceIds.length === 1 && spaceDatabaseEnabled,
    [selectedSpaceIds.length, spaceDatabaseEnabled],
  );

  useEffect(() => {
    if (!databaseAvailable && chatSettings.enableDatabase) {
      updateChatSettings({ ...chatSettings, enableDatabase: false });
    }
  }, [chatSettings, databaseAvailable, updateChatSettings]);

  return {
    databaseAvailable,
  };
}
