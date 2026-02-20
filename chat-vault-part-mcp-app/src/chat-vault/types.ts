/** Chat turn (prompt/response pair) */
export interface ChatTurn {
  prompt: string;
  response: string;
}

/** Chat item from loadMyChats/searchMyChats */
export interface Chat {
  id: string;
  title: string;
  timestamp?: string;
  turns?: ChatTurn[];
  userId?: string;
  type?: "chat" | "note";
  content?: string;
}

/** User info from widget/user context */
export interface UserInfo {
  portalLink?: string | null;
  loginLink?: string | null;
  isAnonymousPlan?: boolean;
  remainingSlots?: number;
  includes?: string[];
  limits?: {
    maxChats?: number;
    counterTooltip?: string;
    limitReachedMessageWithPortal?: string;
    limitReachedMessageWithoutPortal?: string;
    limitReachedTooltip?: string;
  };
  totalChats?: number;
  userName?: string;
  isAnon?: boolean;
  config?: { replace?: string };
  message?: string;
  messageType?: string;
}

/** Pagination info from loadMyChats */
export interface Pagination {
  totalPages: number;
  hasMore: boolean;
  total?: number;
}

/** Delete confirmation state */
export interface DeleteConfirmation {
  chatId: string;
  userId: string;
  title?: string;
}

/** Content metadata from widgetAdd parse */
export interface ContentMetadata {
  hasTitle: boolean;
  title: string;
  contentLength: number;
  contentPreview: string;
  hasHtml: boolean;
  htmlLength: number;
  textLength: number;
  subTitle?: string;
  limits?: {
    maxChats?: number;
    counterTooltip?: string;
    limitReachedMessageWithPortal?: string;
    limitReachedMessageWithoutPortal?: string;
    limitReachedTooltip?: string;
  };
  config?: {
    replace?: string;
    chatExpirationDays?: number;
    freeChatLimit?: number;
    limitReachedMessageWithPortal?: string;
    limitReachedMessageWithoutPortal?: string;
    limitReachedTooltip?: string;
  };
  message?: string;
  messageType?: string;
}

/** Editing turn state */
export interface EditingTurn {
  turnIndex: number;
  field: "prompt" | "response";
}

/** Tool result from ChatVault MCP (extends SDK with structuredContent) */
export interface ChatVaultToolResult {
  structuredContent?: {
    deleted?: boolean;
    message?: string;
    chatId?: string;
    saved?: boolean;
    turnsCount?: number;
    error?: unknown;
    [key: string]: unknown;
  };
  content?: Array<{ type: string; text?: string }>;
  error?: { message?: string; data?: unknown };
  jsonrpc?: string;
  [key: string]: unknown;
}
