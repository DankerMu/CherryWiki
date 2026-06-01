import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useChatModelAvailable } from '../../hooks/useChatModelAvailable.js';
import { api } from '../../lib/api.js';
import type { AuthUser } from '../../lib/auth.js';
import {
  ensureSpaceOption,
  getChatSettingsKey,
  getKnownSpaceName,
  getUserChatSpaces,
  isSpaceDatabaseEnabled,
  loadChatSettings,
  normalizeSelectedSpaceIds,
  saveChatSettings,
} from './chatScopeUtils.js';
import type { AvailableChatSpace, ChatSettings, ChatSpaceDetail } from './types.js';

type UseChatScopeSettingsParams = {
  spaceId: string;
  isAuthenticated: boolean;
  isAllowed: boolean;
  user: AuthUser | null;
  hasSpacePermission: (spaceId: string, permission: string) => boolean;
};

export function useChatScopeSettings({
  spaceId,
  isAuthenticated,
  isAllowed,
  user,
  hasSpacePermission,
}: UseChatScopeSettingsParams) {
  const [availableSpaces, setAvailableSpaces] = useState<AvailableChatSpace[]>([]);
  const [spaceRefreshVersion, setSpaceRefreshVersion] = useState(0);
  const [selectedSpaceIds, setSelectedSpaceIds] = useState<string[]>(() => normalizeSelectedSpaceIds(spaceId, [spaceId]));
  const [spaceDatabaseEnabled, setSpaceDatabaseEnabled] = useState(false);
  const selectedSpaceSettingsKey = useMemo(() => getChatSettingsKey(selectedSpaceIds), [selectedSpaceIds]);
  const [chatSettingsState, setChatSettingsState] = useState<{ storageKey: string; settings: ChatSettings }>(() => {
    const initialSpaceIds = normalizeSelectedSpaceIds(spaceId, [spaceId]);
    return {
      storageKey: getChatSettingsKey(initialSpaceIds),
      settings: loadChatSettings(initialSpaceIds),
    };
  });
  const chatSettingsKeyRef = useRef(chatSettingsState.storageKey);
  const chatSettings =
    chatSettingsState.storageKey === selectedSpaceSettingsKey
      ? chatSettingsState.settings
      : loadChatSettings(selectedSpaceIds);
  const chatModelAvailable = useChatModelAvailable(isAuthenticated && isAllowed);

  const updateChatSettings = useCallback(
    (settings: ChatSettings): void => {
      chatSettingsKeyRef.current = selectedSpaceSettingsKey;
      setChatSettingsState({
        storageKey: selectedSpaceSettingsKey,
        settings,
      });
    },
    [selectedSpaceSettingsKey],
  );

  useEffect(() => {
    setSelectedSpaceIds(normalizeSelectedSpaceIds(spaceId, [spaceId]));
  }, [spaceId]);

  useEffect(() => {
    if (chatSettingsKeyRef.current !== selectedSpaceSettingsKey) {
      chatSettingsKeyRef.current = selectedSpaceSettingsKey;
      setChatSettingsState({
        storageKey: selectedSpaceSettingsKey,
        settings: loadChatSettings(selectedSpaceIds),
      });
    }
  }, [selectedSpaceIds, selectedSpaceSettingsKey]);

  useEffect(() => {
    if (chatSettingsState.storageKey === selectedSpaceSettingsKey) {
      saveChatSettings(selectedSpaceIds, chatSettingsState.settings);
    }
  }, [chatSettingsState, selectedSpaceIds, selectedSpaceSettingsKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadAvailableSpaces(): Promise<void> {
      if (!isAuthenticated || spaceId.length === 0 || !isAllowed) {
        setAvailableSpaces([]);
        return;
      }

      try {
        const response = await api.getWrapped<Array<AvailableChatSpace & { status?: string }>>('/spaces', {
          per_page: 100,
          sort: 'name',
        });
        if (cancelled) return;
        const spaces = response.data
          .filter((space) => (space.status ?? 'active') === 'active')
          .filter((space) => hasSpacePermission(space.id, 'chat:use'))
          .map((space) => ({ id: space.id, name: space.name }));
        setAvailableSpaces(ensureSpaceOption(spaces, spaceId, getKnownSpaceName(user, spaceId)));
      } catch {
        if (!cancelled) {
          setAvailableSpaces(ensureSpaceOption(getUserChatSpaces(user, hasSpacePermission), spaceId, getKnownSpaceName(user, spaceId)));
        }
      }
    }

    void loadAvailableSpaces();

    return () => {
      cancelled = true;
    };
  }, [hasSpacePermission, isAllowed, isAuthenticated, spaceId, spaceRefreshVersion, user]);

  useEffect(() => {
    setSelectedSpaceIds((current) => {
      const authorized = new Set(availableSpaces.map((space) => space.id));
      return normalizeSelectedSpaceIds(
        spaceId,
        current.filter((id) => id === spaceId || authorized.has(id)),
      );
    });
  }, [availableSpaces, spaceId]);

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

  useEffect(() => {
    if ((!spaceDatabaseEnabled || selectedSpaceIds.length > 1) && chatSettings.enableDatabase) {
      updateChatSettings({ ...chatSettings, enableDatabase: false });
    }
  }, [chatSettings, selectedSpaceIds.length, spaceDatabaseEnabled, updateChatSettings]);

  const resetSelectedSpacesToRoute = useCallback(() => {
    setSelectedSpaceIds(normalizeSelectedSpaceIds(spaceId, [spaceId]));
  }, [spaceId]);

  const refreshAvailableSpaces = useCallback(() => {
    setSpaceRefreshVersion((version) => version + 1);
  }, []);

  const databaseAvailable = selectedSpaceIds.length === 1 && spaceDatabaseEnabled;

  return {
    availableSpaces,
    chatModelAvailable,
    chatSettings,
    databaseAvailable,
    selectedSpaceIds,
    setAvailableSpaces,
    setSelectedSpaceIds,
    resetSelectedSpacesToRoute,
    refreshAvailableSpaces,
    updateChatSettings,
  };
}
