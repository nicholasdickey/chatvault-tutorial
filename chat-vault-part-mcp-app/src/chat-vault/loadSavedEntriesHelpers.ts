import type { AvailableTopic, Chat, Pagination, UserInfo } from "./types.js";
import type { ContentMetadata } from "./types.js";

export interface LoadSavedEntriesArgs {
  page: number;
  size: number;
  aboveTheFoldOnly: boolean;
  widgetVersion: string;
  query?: string;
  topicIds?: string[];
  [key: string]: unknown;
}

export function buildLoadSavedEntriesArgs(params: {
  page: number;
  widgetVersion: string;
  query?: string;
  topicIds?: string[];
  size?: number;
}): LoadSavedEntriesArgs {
  const args: LoadSavedEntriesArgs = {
    page: params.page,
    size: params.size ?? 10,
    aboveTheFoldOnly: true,
    widgetVersion: params.widgetVersion,
  };
  const trimmedQuery = params.query?.trim();
  if (trimmedQuery) {
    args.query = trimmedQuery;
  }
  if (params.topicIds && params.topicIds.length > 0) {
    args.topicIds = params.topicIds;
  }
  return args;
}

export function mergeAvailableTopics(
  fromApi: AvailableTopic[],
  chats: Chat[],
): AvailableTopic[] {
  const byId = new Map<string, AvailableTopic>();
  for (const topic of fromApi) {
    byId.set(topic.id, topic);
  }
  for (const chat of chats) {
    for (const topic of chat.topics ?? []) {
      if (byId.has(topic.id)) continue;
      byId.set(topic.id, { id: topic.id, name: topic.name, chatCount: 1 });
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function mergeTopicOptionLists(
  existing: AvailableTopic[],
  incoming: AvailableTopic[],
): AvailableTopic[] {
  const byId = new Map<string, AvailableTopic>();
  for (const topic of existing) {
    byId.set(topic.id, topic);
  }
  for (const topic of incoming) {
    const prev = byId.get(topic.id);
    byId.set(topic.id, {
      ...topic,
      chatCount: topic.chatCount ?? prev?.chatCount,
    });
  }
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function parseAvailableTopics(
  structuredContent: Record<string, unknown> | undefined,
): AvailableTopic[] {
  const raw = structuredContent?.availableTopics;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (item): item is { id: string; name: string; chatCount?: number } =>
        !!item &&
        typeof item === "object" &&
        typeof (item as { id?: unknown }).id === "string" &&
        typeof (item as { name?: unknown }).name === "string",
    )
    .map((item) => ({
      id: item.id,
      name: item.name,
      ...(item.chatCount != null ? { chatCount: Number(item.chatCount) } : {}),
    }));
}

export interface ParsedLoadSavedEntries {
  chats: Chat[];
  pagination: Pagination | null;
  availableTopics: AvailableTopic[];
  userInfo?: UserInfo;
  content?: ContentMetadata;
}

export function parseLoadSavedEntriesResponse(
  structuredContent: Record<string, unknown> | undefined,
): ParsedLoadSavedEntries | null {
  if (!structuredContent) return null;
  const rawChats = structuredContent.chats;
  const chats = Array.isArray(rawChats) ? (rawChats as Chat[]) : [];
  return {
    chats,
    pagination: (structuredContent.pagination as Pagination) ?? null,
    availableTopics: parseAvailableTopics(structuredContent),
    userInfo: structuredContent.userInfo as UserInfo | undefined,
    content: structuredContent.content as ContentMetadata | undefined,
  };
}
