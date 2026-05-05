import { createParser, type EventSourceMessage } from 'eventsource-parser';
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

export const CHAT_INPUT_MAX_LENGTH = 4000;

export type ChatRole = 'user' | 'assistant';
export type RetrievalMode = 'wiki_only' | 'graph_rag' | 'path_first' | 'community_first';

export const DEFAULT_RETRIEVAL_MODE: RetrievalMode = 'wiki_only';

export type ChatCitation = {
  index: number;
  chunk_id: string;
  wiki_page_pk: string;
  page_id?: string;
  section_id: string | null;
  relevance_score: number;
  source_chain_json: Record<string, unknown>;
  display_text: string;
  page_title: string;
  section_title: string | null;
  fallback: boolean;
};

export type ChatMessageStatus = 'complete' | 'streaming' | 'error';

export type ChatUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type ChatToolUsePart = {
  type: 'tool_use';
  id: string | null;
  name: string;
  input: unknown;
};

export type ChatChartPart = {
  type: 'chart';
  id: string;
  chart_type: string | null;
  option: Record<string, unknown>;
  raw: Record<string, unknown>;
};

export type ChatMessagePart = ChatToolUsePart | ChatChartPart;

export type ChatMessage = {
  id: string;
  session_id: string | null;
  role: ChatRole;
  content: string;
  parts: ChatMessagePart[];
  citations: ChatCitation[];
  usage: ChatUsage | null;
  created_at: string;
  status: ChatMessageStatus;
  agentPath: boolean;
  agentThinking: boolean;
  completedAt: string | null;
  latencyMs: number | null;
  firstSseLatencyMs: number | null;
  error?: string;
};

export type ChatApiMessage = {
  id: string;
  session_id: string;
  role: string;
  content: string;
  citations_json: unknown[];
  created_at: string;
};

export type ChatApiSessionDetail = {
  id: string;
  messages: ChatApiMessage[];
};

export class ChatStreamError extends Error {
  readonly code: string;
  readonly status: number | null;

  constructor(input: { code: string; message: string; status?: number | null }) {
    super(input.message);
    this.name = 'ChatStreamError';
    this.code = input.code;
    this.status = input.status ?? null;
  }
}

type UseChatStreamParams = {
  spaceId: string;
  accessToken: string | null;
  onSession?: (sessionId: string) => void;
};

export type SendMessageOptions = {
  sessionId?: string | null;
  enableDeepAnalysis?: boolean;
  enableDatabase?: boolean;
  retrievalMode?: RetrievalMode;
};

export function useChatStream({ spaceId, accessToken, onSession }: UseChatStreamParams) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<ChatStreamError | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const isStreamingRef = useRef(false);
  const lastSendOptionsRef = useRef<Omit<SendMessageOptions, 'sessionId'> | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const loadSession = useCallback((session: ChatApiSessionDetail) => {
    abortControllerRef.current?.abort();
    setSessionId(session.id);
    setMessages(normalizeChatMessages(session.messages));
    setError(null);
    setIsStreaming(false);
  }, []);

  const startNewSession = useCallback(() => {
    abortControllerRef.current?.abort();
    setSessionId(null);
    setMessages([]);
    setError(null);
    setIsStreaming(false);
  }, []);

  const sendMessage = useCallback(
    async (rawContent: string, options: SendMessageOptions = {}): Promise<void> => {
      const content = rawContent.trim();

      if (content.length === 0 || content.length > CHAT_INPUT_MAX_LENGTH || isStreamingRef.current) {
        return;
      }

      const requestSessionId = options.sessionId ?? sessionId;
      const retrievalMode = options.retrievalMode ?? DEFAULT_RETRIEVAL_MODE;
      const agentPath =
        options.enableDeepAnalysis === true || options.enableDatabase === true || isAgentRetrievalMode(retrievalMode);
      const userMessageId = createLocalMessageId('user');
      const assistantMessageId = createLocalMessageId('assistant');
      const now = new Date().toISOString();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      lastSendOptionsRef.current = {
        enableDeepAnalysis: options.enableDeepAnalysis === true,
        enableDatabase: options.enableDatabase === true,
        retrievalMode,
      };
      isStreamingRef.current = true;
      setIsStreaming(true);
      setError(null);
      setMessages((current) => [
        ...current,
        {
          id: userMessageId,
          session_id: requestSessionId,
          role: 'user',
          content,
          parts: [],
          citations: [],
          usage: null,
          created_at: now,
          status: 'complete',
          agentPath: false,
          agentThinking: false,
          completedAt: now,
          latencyMs: null,
          firstSseLatencyMs: null,
        },
        {
          id: assistantMessageId,
          session_id: requestSessionId,
          role: 'assistant',
          content: '',
          parts: [],
          citations: [],
          usage: null,
          created_at: now,
          status: 'streaming',
          agentPath,
          agentThinking: agentPath,
          completedAt: null,
          latencyMs: null,
          firstSseLatencyMs: null,
        },
      ]);

      let doneReceived = false;
      let streamError: ChatStreamError | null = null;

      try {
        const response = await fetch('/api/chat/completions', {
          method: 'POST',
          credentials: 'include',
          signal: controller.signal,
          headers: buildStreamHeaders(accessToken),
          body: JSON.stringify({
            space_id: spaceId,
            message: content,
            retrieval_mode: retrievalMode,
            ...(requestSessionId !== null && requestSessionId.length > 0 ? { session_id: requestSessionId } : {}),
            ...(options.enableDeepAnalysis === true ? { enable_deep_analysis: true } : {}),
            ...(options.enableDatabase === true ? { enable_database: true } : {}),
          }),
        });

        if (!response.ok) {
          throw await parseErrorResponse(response);
        }

        if (response.body === null) {
          throw new ChatStreamError({
            code: 'STREAM_INTERRUPTED',
            message: '响应中断，请重试',
            status: response.status,
          });
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parser = createParser({
          onEvent: (event) => {
            const result = handleStreamEvent(event, assistantMessageId, setMessages, setSessionId, onSession);
            if (result.done) {
              doneReceived = true;
            }
            if (result.error !== null) {
              streamError = result.error;
              setError(result.error);
            }
          },
          onError: (parseError) => {
            streamError = new ChatStreamError({
              code: 'STREAM_INTERRUPTED',
              message: parseError.message,
            });
            setError(streamError);
            markAssistantError(assistantMessageId, streamError.message, setMessages);
          },
        });

        while (true) {
          const result = await reader.read();
          if (result.done) {
            break;
          }

          parser.feed(decoder.decode(result.value, { stream: true }));
        }

        const remaining = decoder.decode();
        if (remaining.length > 0) {
          parser.feed(remaining);
        }
        parser.reset({ consume: true });

        if (!doneReceived && streamError === null) {
          throw new ChatStreamError({
            code: 'STREAM_INTERRUPTED',
            message: '响应中断，请重试',
          });
        }

        if (streamError === null) {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantMessageId && message.status === 'streaming'
                ? {
                    ...message,
                    status: 'complete',
                    agentThinking: false,
                    completedAt: message.completedAt ?? new Date().toISOString(),
                  }
                : message,
            ),
          );
        }
      } catch (err) {
        if (isAbortError(err)) {
          return;
        }

        const nextError = normalizeStreamError(err);
        setError(nextError);
        markAssistantError(assistantMessageId, nextError.message, setMessages);
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        isStreamingRef.current = false;
        setIsStreaming(false);
      }
    },
    [accessToken, onSession, sessionId, spaceId],
  );

  const retry = useCallback(async (): Promise<void> => {
    const lastUserMessage = [...messagesRef.current].reverse().find((message) => message.role === 'user');
    if (lastUserMessage === undefined) {
      return;
    }

    await sendMessage(lastUserMessage.content, { sessionId, ...(lastSendOptionsRef.current ?? {}) });
  }, [sendMessage, sessionId]);

  return {
    messages,
    sessionId,
    isStreaming,
    error,
    sendMessage,
    retry,
    loadSession,
    startNewSession,
  };
}

export function normalizeChatMessages(rows: ChatApiMessage[]): ChatMessage[] {
  return rows
    .filter((row) => row.role === 'user' || row.role === 'assistant')
    .map((row) => ({
      id: row.id,
      session_id: row.session_id,
      role: row.role as ChatRole,
      content: row.content,
      parts: [],
      citations: normalizeCitationArray(row.citations_json),
      usage: null,
      created_at: row.created_at,
      status: 'complete',
      agentPath: false,
      agentThinking: false,
      completedAt: null,
      latencyMs: null,
      firstSseLatencyMs: null,
    }));
}

export function isAgentRetrievalMode(mode: RetrievalMode): boolean {
  return mode === 'graph_rag' || mode === 'path_first' || mode === 'community_first';
}

export function getChatErrorMessage(error: ChatStreamError | null): string | null {
  if (error === null) {
    return null;
  }

  if (error.code === 'NO_CHAT_MODEL_CONFIGURED') {
    return '请联系管理员配置聊天模型';
  }

  if (error.code === 'NO_INDEXED_CONTENT') {
    return '知识库正在构建中，请稍后再试';
  }

  if (error.code === 'STREAM_INTERRUPTED') {
    return '响应中断，请重试';
  }

  if (error.code === 'NETWORK_ERROR') {
    return '连接失败';
  }

  return error.message.length > 0 ? error.message : '连接失败';
}

function buildStreamHeaders(accessToken: string | null): Headers {
  const headers = new Headers();
  headers.set('Accept', 'text/event-stream');
  headers.set('Content-Type', 'application/json');

  if (accessToken !== null && accessToken.length > 0) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  return headers;
}

function handleStreamEvent(
  event: EventSourceMessage,
  assistantMessageId: string,
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  setSessionId: Dispatch<SetStateAction<string | null>>,
  onSession: ((sessionId: string) => void) | undefined,
): { done: boolean; error: ChatStreamError | null } {
  if (event.data === '[DONE]') {
    return { done: true, error: null };
  }

  const data = parseEventData(event.data);
  const eventType = event.event ?? 'message';

  if (eventType === 'session') {
    const nextSessionId = readString(data, 'session_id');
    if (nextSessionId !== null) {
      setSessionId(nextSessionId);
      setMessages((current) =>
        current.map((message) => (message.session_id === null ? { ...message, session_id: nextSessionId } : message)),
      );
      onSession?.(nextSessionId);
    }
    return { done: false, error: null };
  }

  if (eventType === 'content' || eventType === 'message.delta') {
    const delta = readString(data, 'delta') ?? '';
    if (delta.length > 0) {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                content: `${message.content}${delta}`,
                status: 'streaming',
                agentThinking: false,
              }
            : message,
        ),
      );
    }
    return { done: false, error: null };
  }

  if (eventType === 'citations') {
    const citations = normalizeCitationArray(readUnknown(data, 'citations'));
    setMessages((current) =>
      current.map((message) => (message.id === assistantMessageId ? { ...message, citations } : message)),
    );
    return { done: false, error: null };
  }

  if (eventType === 'usage') {
    const usage = normalizeUsage(data);
    setMessages((current) =>
      current.map((message) => (message.id === assistantMessageId ? { ...message, usage } : message)),
    );
    return { done: false, error: null };
  }

  if (eventType === 'agent.tool_use') {
    const toolUse = normalizeToolUse(data);
    setMessages((current) =>
      current.map((message) =>
        message.id === assistantMessageId ? { ...message, parts: [...message.parts, toolUse] } : message,
      ),
    );
    return { done: false, error: null };
  }

  if (eventType === 'chart.data') {
    const chart = normalizeChartPart(data);
    setMessages((current) =>
      current.map((message) =>
        message.id === assistantMessageId ? { ...message, parts: [...message.parts, chart] } : message,
      ),
    );
    return { done: false, error: null };
  }

  if (eventType === 'message.completed') {
    const completedUsage = normalizeCompletedUsage(data);
    const latencyMs = readNumber(data, 'latency_ms');
    const firstSseLatencyMs = readNumber(data, 'first_sse_latency_ms');
    const completedAt = new Date().toISOString();
    setMessages((current) =>
      current.map((message) =>
        message.id === assistantMessageId
          ? {
              ...message,
              status: 'complete',
              agentThinking: false,
              completedAt,
              latencyMs,
              firstSseLatencyMs,
              usage: completedUsage ?? message.usage,
            }
          : message,
      ),
    );
    return { done: true, error: null };
  }

  if (eventType === 'error') {
    const nextError = new ChatStreamError({
      code: readString(data, 'code') ?? 'API_ERROR',
      message: readString(data, 'message') ?? 'Chat completion failed',
    });
    markAssistantError(assistantMessageId, nextError.message, setMessages);
    return { done: false, error: nextError };
  }

  return { done: false, error: null };
}

function markAssistantError(
  assistantMessageId: string,
  message: string,
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
): void {
  setMessages((current) =>
    current.map((chatMessage) =>
      chatMessage.id === assistantMessageId
        ? {
            ...chatMessage,
            status: 'error',
            agentThinking: false,
            error: message,
          }
        : chatMessage,
    ),
  );
}

async function parseErrorResponse(response: Response): Promise<ChatStreamError> {
  const body = await readJsonBody(response);
  const code = readErrorCode(body);
  const message = readErrorMessage(body) ?? response.statusText ?? 'Request failed';

  return new ChatStreamError({
    code,
    message,
    status: response.status,
  });
}

function normalizeStreamError(error: unknown): ChatStreamError {
  if (error instanceof ChatStreamError) {
    return error;
  }

  if (error instanceof Error && error.message.length > 0) {
    return new ChatStreamError({
      code: 'NETWORK_ERROR',
      message: '连接失败',
    });
  }

  return new ChatStreamError({
    code: 'NETWORK_ERROR',
    message: '连接失败',
  });
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim().length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function readErrorCode(body: unknown): string {
  if (!isRecord(body)) {
    return 'API_ERROR';
  }

  const nestedError = body.error;
  if (isRecord(nestedError) && typeof nestedError.code === 'string') {
    return nestedError.code;
  }

  if (typeof body.code === 'string') {
    return body.code;
  }

  return 'API_ERROR';
}

function readErrorMessage(body: unknown): string | null {
  if (!isRecord(body)) {
    return null;
  }

  const nestedError = body.error;
  if (isRecord(nestedError) && typeof nestedError.message === 'string') {
    return nestedError.message;
  }

  if (typeof body.message === 'string') {
    return body.message;
  }

  return null;
}

function parseEventData(data: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(data) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeCitationArray(value: unknown): ChatCitation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeCitation).filter((citation): citation is ChatCitation => citation !== null);
}

function normalizeCitation(value: unknown): ChatCitation | null {
  if (!isRecord(value)) {
    return null;
  }

  const index = readNumber(value, 'index');
  const chunkId = readString(value, 'chunk_id') ?? '';
  const wikiPagePk = readString(value, 'wiki_page_pk') ?? '';
  const relevanceScore = readNumber(value, 'relevance_score');
  const sourceChainJson = readRecord(value, 'source_chain_json') ?? {};
  const displayText = readString(value, 'display_text') ?? readString(value, 'page_title') ?? 'Source';
  const pageTitle = readString(value, 'page_title') ?? displayText;

  if (index === null || wikiPagePk.length === 0) {
    return null;
  }

  return {
    index,
    chunk_id: chunkId,
    wiki_page_pk: wikiPagePk,
    section_id: readString(value, 'section_id'),
    relevance_score: relevanceScore ?? 0,
    source_chain_json: sourceChainJson,
    display_text: displayText,
    page_title: pageTitle,
    section_title: readString(value, 'section_title'),
    fallback: readBoolean(value, 'fallback') ?? false,
  };
}

function normalizeUsage(value: unknown): ChatUsage | null {
  if (!isRecord(value)) {
    return null;
  }

  const promptTokens = readNumber(value, 'prompt_tokens');
  const completionTokens = readNumber(value, 'completion_tokens');
  const totalTokens = readNumber(value, 'total_tokens');

  const agentInputTokens = readNumber(value, 'input_tokens');
  const agentOutputTokens = readNumber(value, 'output_tokens');

  if (promptTokens === null || completionTokens === null || totalTokens === null) {
    if (agentInputTokens === null && agentOutputTokens === null) {
      return null;
    }

    const normalizedPromptTokens = agentInputTokens ?? 0;
    const normalizedCompletionTokens = agentOutputTokens ?? 0;
    return {
      prompt_tokens: normalizedPromptTokens,
      completion_tokens: normalizedCompletionTokens,
      total_tokens: normalizedPromptTokens + normalizedCompletionTokens,
    };
  }

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  };
}

function normalizeCompletedUsage(value: unknown): ChatUsage | null {
  if (!isRecord(value)) {
    return null;
  }

  const nestedUsage = readRecord(value, 'usage');
  return normalizeUsage(nestedUsage ?? value);
}

function normalizeToolUse(value: Record<string, unknown>): ChatToolUsePart {
  return {
    type: 'tool_use',
    id: readString(value, 'id'),
    name: readString(value, 'name') ?? readString(value, 'tool') ?? readString(value, 'tool_name') ?? 'Tool',
    input: readUnknown(value, 'input') ?? readUnknown(value, 'tool_input') ?? {},
  };
}

function normalizeChartPart(value: Record<string, unknown>): ChatChartPart {
  const nestedData = readRecord(value, 'data');
  const raw = nestedData ?? value;
  const option = readRecord(raw, 'echarts_option') ?? readRecord(value, 'echarts_option') ?? raw;

  return {
    type: 'chart',
    id: createLocalMessageId('chart'),
    chart_type: readString(raw, 'chart_type') ?? readString(value, 'chart_type'),
    option,
    raw,
  };
}

function readUnknown(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === 'boolean' ? value : null;
}

function readRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function createLocalMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
