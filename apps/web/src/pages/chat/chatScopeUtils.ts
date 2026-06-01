import type { AuthUser } from '../../lib/auth.js';
import { DEFAULT_RETRIEVAL_MODE, type RetrievalMode, type SpaceDisplayInfo } from '../../hooks/useChatStream.js';
import type { AvailableChatSpace, ChatSession, ChatSettings } from './types.js';

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  enableDeepAnalysis: false,
  enableDatabase: false,
  retrievalMode: DEFAULT_RETRIEVAL_MODE,
};

export const CHAT_SPACE_SELECTION_MAX = 10;

export function normalizeSelectedSpaceIds(primarySpaceId: string, selectedSpaceIds: string[]): string[] {
  const normalized: string[] = [];
  const add = (value: string | undefined) => {
    const trimmed = value?.trim() ?? '';
    if (trimmed.length > 0 && !normalized.includes(trimmed)) {
      normalized.push(trimmed);
    }
  };

  add(primarySpaceId);
  for (const selectedSpaceId of selectedSpaceIds) {
    add(selectedSpaceId);
  }

  return normalized;
}

export function ensureSpaceOption(spaces: AvailableChatSpace[], spaceId: string, fallbackName: string): AvailableChatSpace[] {
  const normalized = mergeSpaceOptions(spaces, [{ id: spaceId, name: fallbackName }]);
  return normalized.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
}

export function mergeSpaceOptions(spaces: AvailableChatSpace[], incoming: SpaceDisplayInfo[]): AvailableChatSpace[] {
  const byId = new Map<string, AvailableChatSpace>();
  for (const space of spaces) {
    if (space.id.length > 0) {
      byId.set(space.id, space);
    }
  }
  for (const space of incoming) {
    if (space.id.length > 0 && space.name.length > 0) {
      byId.set(space.id, { id: space.id, name: space.name });
    }
  }
  return [...byId.values()];
}

export function getUserChatSpaces(
  user: AuthUser | null,
  hasSpacePermission: (spaceId: string, permission: string) => boolean,
): AvailableChatSpace[] {
  return (user?.spaces ?? [])
    .filter((space) => hasSpacePermission(space.id, 'chat:use'))
    .map((space) => ({ id: space.id, name: space.name }));
}

export function getKnownSpaceName(user: AuthUser | null, spaceId: string): string {
  return user?.spaces?.find((space) => space.id === spaceId)?.name ?? spaceId;
}

export function normalizeRetrievalMode(value: string): RetrievalMode {
  const validValues: RetrievalMode[] = ['wiki_only', 'graph_rag', 'path_first', 'community_first'];
  return validValues.includes(value as RetrievalMode) ? (value as RetrievalMode) : DEFAULT_RETRIEVAL_MODE;
}

export function loadChatSettings(spaceIds: string[]): ChatSettings {
  if (typeof window === 'undefined' || spaceIds.length === 0) {
    return DEFAULT_CHAT_SETTINGS;
  }

  const raw = window.sessionStorage.getItem(getChatSettingsKey(spaceIds));
  if (raw === null) {
    return DEFAULT_CHAT_SETTINGS;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return DEFAULT_CHAT_SETTINGS;
    }

    return {
      enableDeepAnalysis: parsed.enableDeepAnalysis === true,
      enableDatabase: parsed.enableDatabase === true,
      retrievalMode: typeof parsed.retrievalMode === 'string' ? normalizeRetrievalMode(parsed.retrievalMode) : DEFAULT_RETRIEVAL_MODE,
    };
  } catch {
    return DEFAULT_CHAT_SETTINGS;
  }
}

export function saveChatSettings(spaceIds: string[], settings: ChatSettings): void {
  if (typeof window === 'undefined' || spaceIds.length === 0) {
    return;
  }

  window.sessionStorage.setItem(getChatSettingsKey(spaceIds), JSON.stringify(settings));
}

export function getChatSettingsKey(spaceIds: string[]): string {
  return `cherry-chat-settings:${JSON.stringify([...spaceIds].sort())}`;
}

export function isSpaceDatabaseEnabled(value: unknown): boolean {
  return isRecord(value) && value.enabled === true;
}

export function sortSessions(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
