import { createParser, type EventSourceMessage } from 'eventsource-parser';
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

export const CHAT_INPUT_MAX_LENGTH = 4000;

export type ChatRole = 'user' | 'assistant';

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

export type ChatMessage = {
  id: string;
  session_id: string | null;
  role: ChatRole;
  content: string;
  citations: ChatCitation[];
  usage: ChatUsage | null;
  created_at: string;
  status: ChatMessageStatus;
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

type SendMessageOptions = {
  sessionId?: string | null;
};

export function useChatStream({ spaceId, accessToken, onSession }: UseChatStreamParams) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<ChatStreamError | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const isStreamingRef = useRef(false);

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
      const userMessageId = createLocalMessageId('user');
      const assistantMessageId = createLocalMessageId('assistant');
      const now = new Date().toISOString();
      const controller = new AbortController();
      abortControllerRef.current = controller;
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
          citations: [],
          usage: null,
          created_at: now,
          status: 'complete',
        },
        {
          id: assistantMessageId,
          session_id: requestSessionId,
          role: 'assistant',
          content: '',
          citations: [],
          usage: null,
          created_at: now,
          status: 'streaming',
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
            ...(requestSessionId !== null && requestSessionId.length > 0 ? { session_id: requestSessionId } : {}),
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
                ? { ...message, status: 'complete' }
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

    await sendMessage(lastUserMessage.content, { sessionId });
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
      citations: normalizeCitationArray(row.citations_json),
      usage: null,
      created_at: row.created_at,
      status: 'complete',
    }));
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

  if (eventType === 'content') {
    const delta = readString(data, 'delta') ?? '';
    if (delta.length > 0) {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessageId
            ? { ...message, content: `${message.content}${delta}`, status: 'streaming' }
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

  if (promptTokens === null || completionTokens === null || totalTokens === null) {
    return null;
  }

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
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
