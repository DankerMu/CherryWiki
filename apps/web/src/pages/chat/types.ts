import type { RetrievalMode, SpaceDisplayInfo } from '../../hooks/useChatStream.js';

export type ChatSession = {
  id: string;
  title: string | null;
  space_ids?: string[];
  space_details?: SpaceDisplayInfo[];
  updated_at: string;
  created_at: string;
};

export type AvailableChatSpace = {
  id: string;
  name: string;
};

export type ChatSettings = {
  enableDeepAnalysis: boolean;
  enableDatabase: boolean;
  retrievalMode: RetrievalMode;
};

export type ChatSpaceDetail = {
  database_config?: unknown;
};
