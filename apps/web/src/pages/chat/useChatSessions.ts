import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';

import type { ChatApiSessionDetail } from '../../hooks/useChatStream.js';
import { api } from '../../lib/api.js';
import { getErrorMessage } from '../../components/adminUi.js';
import { mergeSpaceOptions, normalizeSelectedSpaceIds, sortSessions } from './chatScopeUtils.js';
import type { AvailableChatSpace, ChatSession } from './types.js';

type UseChatSessionsParams = {
  spaceId: string;
  isAuthenticated: boolean;
  isAllowed: boolean;
  activeSessionId: string | null;
  selectedSpaceIds: string[];
  setSelectedSpaceIds: (updater: string[] | ((current: string[]) => string[])) => void;
  setAvailableSpaces: (updater: AvailableChatSpace[] | ((current: AvailableChatSpace[]) => AvailableChatSpace[])) => void;
  loadStreamSession: (session: ChatApiSessionDetail) => void;
  startStreamNewSession: () => void;
  closeMobileSidebar: () => void;
  scopeUpdateFailedMessage: string;
};

export function useChatSessions({
  spaceId,
  isAuthenticated,
  isAllowed,
  activeSessionId,
  selectedSpaceIds,
  setSelectedSpaceIds,
  setAvailableSpaces,
  loadStreamSession,
  startStreamNewSession,
  closeMobileSidebar,
  scopeUpdateFailedMessage,
}: UseChatSessionsParams) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const sessionSwitchRef = useRef(0);

  const loadSessions = useCallback(
    async (background = false) => {
      if (!isAuthenticated || spaceId.length === 0 || !isAllowed) {
        setSessions([]);
        setSessionsLoading(false);
        return;
      }

      if (!background) {
        setSessionsLoading(true);
      }
      setSessionsError(null);

      try {
        const response = await api.getWrapped<ChatSession[]>(
          `/spaces/${encodeURIComponent(spaceId)}/chat/sessions`,
          {
            page: 1,
            limit: 50,
          },
        );
        setSessions(sortSessions(response.data));
      } catch (err) {
        setSessionsError(getErrorMessage(err));
      } finally {
        if (!background) {
          setSessionsLoading(false);
        }
      }
    },
    [isAllowed, isAuthenticated, spaceId],
  );

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const openSession = useCallback(
    async (nextSessionId: string): Promise<void> => {
      setSessionsError(null);
      closeMobileSidebar();
      const switchVersion = ++sessionSwitchRef.current;

      try {
        const detail = await api.get<ChatApiSessionDetail>(
          `/spaces/${encodeURIComponent(spaceId)}/chat/sessions/${encodeURIComponent(nextSessionId)}`,
        );
        if (sessionSwitchRef.current !== switchVersion) return;
        setAvailableSpaces((current) => mergeSpaceOptions(current, detail.space_details ?? []));
        setSelectedSpaceIds(normalizeSelectedSpaceIds(spaceId, detail.space_ids ?? [spaceId]));
        loadStreamSession(detail);
      } catch (err) {
        if (sessionSwitchRef.current !== switchVersion) return;
        setSessionsError(getErrorMessage(err));
      }
    },
    [closeMobileSidebar, loadStreamSession, setAvailableSpaces, setSelectedSpaceIds, spaceId],
  );

  const newChat = useCallback((): void => {
    startStreamNewSession();
    setSelectedSpaceIds(normalizeSelectedSpaceIds(spaceId, [spaceId]));
    closeMobileSidebar();
  }, [closeMobileSidebar, setSelectedSpaceIds, spaceId, startStreamNewSession]);

  const executeDeleteSession = useCallback(
    async (session: ChatSession): Promise<void> => {
      setSessionsError(null);

      try {
        await api.delete<{ deleted: true }>(
          `/spaces/${encodeURIComponent(spaceId)}/chat/sessions/${encodeURIComponent(session.id)}`,
        );
        setSessions((current) => current.filter((item) => item.id !== session.id));
        if (session.id === activeSessionId) {
          startStreamNewSession();
          setSelectedSpaceIds(normalizeSelectedSpaceIds(spaceId, [spaceId]));
        }
      } catch (err) {
        setSessionsError(getErrorMessage(err));
      }
    },
    [activeSessionId, setSelectedSpaceIds, spaceId, startStreamNewSession],
  );

  const patchSessionSpaces = useCallback(
    async (nextSessionId: string, nextSpaceIds: string[]): Promise<void> => {
      await api.patch(
        `/spaces/${encodeURIComponent(spaceId)}/chat/sessions/${encodeURIComponent(nextSessionId)}`,
        { space_ids: nextSpaceIds },
      );
    },
    [spaceId],
  );

  const handleSpaceChange = useCallback(
    async (nextSpaceIds: string[]): Promise<void> => {
      const normalizedIds = normalizeSelectedSpaceIds(spaceId, nextSpaceIds);
      if (activeSessionId !== null) {
        const previousIds = selectedSpaceIds;
        setSelectedSpaceIds(normalizedIds);
        try {
          await patchSessionSpaces(activeSessionId, normalizedIds);
        } catch {
          setSelectedSpaceIds(previousIds);
          void message.error(scopeUpdateFailedMessage);
          return;
        }
        void loadSessions(true);
        return;
      }

      setSelectedSpaceIds(normalizedIds);
    },
    [activeSessionId, loadSessions, patchSessionSpaces, scopeUpdateFailedMessage, selectedSpaceIds, setSelectedSpaceIds, spaceId],
  );

  return {
    sessions,
    sessionsLoading,
    sessionsError,
    loadSessions,
    openSession,
    executeDeleteSession,
    newChat,
    handleSpaceChange,
  };
}
