/**
 * saveChatManually tool implementation
 * Parses HTML/text content from ChatGPT copy/paste and saves as structured chat
 */

import { db } from "../db/index.js";
import { chats } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { saveChatCore, checkForExistingChat } from "../utils/saveChatCore.js";
import type { UserContext } from "../server.js";
import { ANON_CHAT_EXPIRY_DAYS, ANON_MAX_CHATS } from "../server.js";

export interface SaveChatManuallyParams {
    userId: string;
    htmlContent: string;
    title?: string;
    widgetVersion?: string; // Widget version (optional, for tracking which widget version is calling)
    userContext?: UserContext; // User context from Findexar headers
}

export interface SaveChatManuallyResult {
    chatId: string;
    saved: boolean;
    turnsCount: number;
    error?: "limit_reached" | "parse_error" | "server_error";
    message?: string;
    portalLink?: string | null;
}

/**
 * Count non-expired chats for anonymous users
 */
async function countNonExpiredChats(userId: string): Promise<number> {
    const allChats = await db
        .select({ timestamp: chats.timestamp })
        .from(chats)
        .where(eq(chats.userId, userId));

    const now = new Date();
    const expiryDate = new Date(now.getTime() - ANON_CHAT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    return allChats.filter((chat) => {
        const chatDate = new Date(chat.timestamp);
        return chatDate >= expiryDate;
    }).length;
}

/**
 * Parse HTML structure to extract chat turns
 * ChatGPT uses <article> tags with data-turn="user" and data-turn="assistant" attributes
 */
function parseHtmlStructure(html: string): Array<{ prompt: string; response: string }> {
    const turns: Array<{ prompt: string; response: string }> = [];

    // Remove script and style tags
    let cleanHtml = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    cleanHtml = cleanHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

    // Extract all article tags with data-turn attributes
    // Pattern: <article[^>]*data-turn=["']?(user|assistant)["']?[^>]*>([\s\S]*?)<\/article>
    const articleRegex = /<article[^>]*data-turn\s*=\s*["']?(user|assistant)["']?[^>]*>([\s\S]*?)<\/article>/gi;

    const messages: Array<{ type: 'user' | 'assistant'; text: string }> = [];

    let match;
    while ((match = articleRegex.exec(cleanHtml)) !== null) {
        const type = (match[1]?.toLowerCase() || '') as 'user' | 'assistant';
        if (type !== 'user' && type !== 'assistant') continue;

        // Extract text content from the article, removing nested HTML tags
        let text = match[2] || '';
        // Remove all HTML tags but preserve structure
        text = text
            .replace(/<[^>]+>/g, ' ') // Replace tags with spaces
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();

        if (text && text.length > 0) {
            messages.push({ type, text });
        }
    }

    // Pair up user and assistant messages in order
    // Messages should alternate: user, assistant, user, assistant...
    let currentPrompt = '';
    for (const message of messages) {
        if (message.type === 'user') {
            // If we already have a prompt waiting, save it with empty response
            if (currentPrompt) {
                turns.push({ prompt: currentPrompt, response: '' });
            }
            currentPrompt = message.text;
        } else if (message.type === 'assistant') {
            // If we have a prompt waiting, pair it with this assistant response
            if (currentPrompt) {
                turns.push({ prompt: currentPrompt, response: message.text });
                currentPrompt = ''; // Reset
            } else {
                // Assistant message without preceding user - might be continuation
                // Add it as a turn with empty prompt
                turns.push({ prompt: '', response: message.text });
            }
        }
    }

    // If there's a leftover user message without response, add it
    if (currentPrompt) {
        turns.push({ prompt: currentPrompt, response: '' });
    }

    // If we found turns from article tags, return them
    if (turns.length > 0) {
        // Filter out turns with empty prompts or responses (unless it's the last one)
        return turns.filter(turn => turn.prompt || turn.response);
    }

    // Fallback: Look for role attributes (older format)
    const roleUserRegex = /<[^>]*role\s*=\s*["']?user["']?[^>]*>([\s\S]*?)<\/[^>]+>/gi;
    const roleAssistantRegex = /<[^>]*role\s*=\s*["']?assistant["']?[^>]*>([\s\S]*?)<\/[^>]+>/gi;

    const userMessages: string[] = [];
    const assistantMessages: string[] = [];

    while ((match = roleUserRegex.exec(cleanHtml)) !== null) {
        const text = match[1].replace(/<[^>]*>/g, '').trim();
        if (text) userMessages.push(text);
    }

    while ((match = roleAssistantRegex.exec(cleanHtml)) !== null) {
        const text = match[1].replace(/<[^>]*>/g, '').trim();
        if (text) assistantMessages.push(text);
    }

    // If we found role-based messages, pair them up
    if (userMessages.length > 0 || assistantMessages.length > 0) {
        const maxPairs = Math.max(userMessages.length, assistantMessages.length);
        for (let i = 0; i < maxPairs; i++) {
            const prompt = userMessages[i] || '';
            const response = assistantMessages[i] || '';
            if (prompt || response) {
                turns.push({ prompt, response });
            }
        }
        if (turns.length > 0) {
            return turns;
        }
    }

    return turns;
}

/**
 * Parse HTML/text content to extract chat turns
 * Expected format: "You said:" followed by prompt, "ChatGPT said:" followed by response
 * Also handles HTML structure from ChatGPT copy/paste
 */
function parseChatContent(content: string): Array<{ prompt: string; response: string }> {
    const turns: Array<{ prompt: string; response: string }> = [];

    // Check if content contains HTML
    const hasHtml = /<[^>]+>/.test(content);

    let text: string;
    if (hasHtml) {
        // Try to parse HTML structure first (ChatGPT's HTML copy has specific patterns)
        // Look for common ChatGPT HTML patterns like role attributes or specific classes
        const htmlTurns = parseHtmlStructure(content);
        if (htmlTurns.length > 0) {
            console.log("[saveChatManually] Successfully parsed HTML structure, found", htmlTurns.length, "turns");
            return htmlTurns;
        }

        // Fallback: For HTML content, preserve structure by converting block elements to newlines
        // This helps maintain the structure of ChatGPT's HTML copy
        text = content
            // Replace block-level HTML elements with newlines
            .replace(/<\/?(div|p|br|h[1-6]|li|ul|ol|blockquote)[^>]*>/gi, '\n')
            // Remove remaining HTML tags
            .replace(/<[^>]*>/g, '')
            // Normalize whitespace but preserve newlines
            .replace(/[ \t]+/g, ' ')
            .replace(/\n\s*\n\s*\n/g, '\n\n')
            .trim();
    } else {
        // Plain text - use as-is
        text = content.trim();
    }

    // Split by "You said:" markers
    const youSaidRegex = /You said:\s*/gi;
    const parts = text.split(youSaidRegex);

    // If no "You said:" markers found, try alternative parsing
    if (parts.length === 1) {
        // No markers found - try to parse as single message or look for other patterns
        // Check if it looks like a single AI response (common when copying just the AI's response)
        const chatGptSaidMatch = text.match(/ChatGPT said:\s*(.*)/is);
        const aiSaidMatch = text.match(/AI said:\s*(.*)/is);

        if (chatGptSaidMatch || aiSaidMatch) {
            // Found "ChatGPT said:" or "AI said:" but no "You said:" - treat as single turn with empty prompt
            const response = (chatGptSaidMatch?.[1] || aiSaidMatch?.[1] || '').trim();
            if (response) {
                turns.push({ prompt: '', response });
                return turns;
            }
        }

        // If content is plain text without conversation markers, treat it as a simple note
        // Save it as a single turn with the text as the prompt and empty response
        // This allows users to save unstructured notes without needing conversation format
        if (!hasHtml && text.split('\n').length < 20) {
            // Plain text without HTML and no conversation markers - treat as a note
            console.log("[saveChatManually] Content appears to be a simple note, saving as single turn");
            turns.push({ prompt: text, response: '' });
            return turns;
        }

        // Try to find alternating pattern (user message, then AI response)
        // Look for patterns like paragraphs separated by blank lines
        const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
        if (paragraphs.length >= 2) {
            // Assume first paragraph is user, second is AI, and so on
            for (let i = 0; i < paragraphs.length - 1; i += 2) {
                const prompt = paragraphs[i].trim();
                const response = paragraphs[i + 1].trim();
                if (prompt && response) {
                    turns.push({ prompt, response });
                }
            }
            if (turns.length > 0) {
                return turns;
            }
        }

        // No recognizable pattern found - treat as a note
        // Save the entire content as a single turn with text as prompt and empty response
        console.log("[saveChatManually] No recognizable conversation format found, treating as a note");
        if (text.trim().length > 0) {
            turns.push({ prompt: text.trim(), response: '' });
        }
        return turns;
    }

    // Skip the first part (everything before first "You said:")
    for (let i = 1; i < parts.length; i++) {
        const part = parts[i].trim();
        if (!part) continue;

        // Find "ChatGPT said:" or "AI said:" marker (ChatGPT copy uses "ChatGPT said:", widget copy uses "AI said:")
        const chatGptSaidIndex = part.search(/ChatGPT said:\s*/i);
        const aiSaidIndex = part.search(/AI said:\s*/i);

        let saidIndex = -1;
        let saidPattern = "";

        if (chatGptSaidIndex !== -1 && aiSaidIndex !== -1) {
            // Both found, use whichever comes first
            saidIndex = chatGptSaidIndex < aiSaidIndex ? chatGptSaidIndex : aiSaidIndex;
            saidPattern = chatGptSaidIndex < aiSaidIndex ? "ChatGPT said:" : "AI said:";
        } else if (chatGptSaidIndex !== -1) {
            saidIndex = chatGptSaidIndex;
            saidPattern = "ChatGPT said:";
        } else if (aiSaidIndex !== -1) {
            saidIndex = aiSaidIndex;
            saidPattern = "AI said:";
        }

        if (saidIndex === -1) {
            // No response marker found, skip this turn
            console.warn("[saveChatManually] No 'ChatGPT said:' or 'AI said:' found for turn", i, "part preview:", part.substring(0, 200));
            continue;
        }

        const prompt = part.substring(0, saidIndex).trim();
        const responsePart = part.substring(saidIndex);

        // Extract response (remove "ChatGPT said:" or "AI said:" prefix)
        const responseMatch = responsePart.match(new RegExp(`${saidPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(.*)`, 'is'));
        if (!responseMatch) {
            console.warn("[saveChatManually] Could not extract response for turn", i);
            continue;
        }

        let response = responseMatch[1].trim();

        // Remove next "You said:" if it exists in the response
        const nextYouSaidIndex = response.search(/You said:\s*/i);
        if (nextYouSaidIndex !== -1) {
            response = response.substring(0, nextYouSaidIndex).trim();
        }

        if (prompt && response) {
            turns.push({ prompt, response });
        } else {
            console.warn("[saveChatManually] Empty prompt or response for turn", i);
        }
    }

    return turns;
}

/**
 * Generate default title with timestamp
 */
function generateDefaultTitle(): string {
    const now = new Date();
    const timestamp = now.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
    return `manual save ${timestamp}`;
}

/**
 * Save a manually pasted chat to the database with embedding
 */
export async function saveChatManually(
    params: SaveChatManuallyParams
): Promise<SaveChatManuallyResult> {
    const { userId, htmlContent, title, userContext } = params;
    const isAnon = userContext?.isAnon ?? false;
    const portalLink = userContext?.portalLink ?? null;

    console.log("[saveChatManually] ===== ENTRY =====");
    console.log("[saveChatManually] Received params:", {
        userId: userId?.substring(0, 20) + "...",
        htmlContentLength: htmlContent?.length || 0,
        htmlContentPreview: htmlContent?.substring(0, 200) || "(empty)",
        title: title || "(none)",
        isAnon,
        hasPortalLink: !!portalLink,
        hasLoginLink: !!userContext?.loginLink,
    });
    console.log("[saveChatManually] Saving manual chat - userId:", userId, "hasTitle:", !!title, "isAnon:", isAnon);

    try {
        // Validate required parameters
        if (!userId) {
            throw new Error("userId is required");
        }
        if (!htmlContent || !htmlContent.trim()) {
            throw new Error("htmlContent is required");
        }

        // Check content size limits before parsing
        // Anonymous users: 2k limit, authenticated users: 100k limit
        const contentLength = htmlContent.length;
        const maxLength = isAnon ? 20000 : 1000000;

        if (contentLength > maxLength) {
            const limitType = isAnon ? "2,000 characters" : "100,000 characters";
            const message = isAnon
                ? `Content exceeds the ${limitType} limit for users without an account. Please shorten your content or sign in to save longer notes (up to 100,000 characters).`
                : `Content exceeds the ${limitType} limit. Please shorten your content.`;
            console.log("[saveChatManually] ❌ Content size limit exceeded:", {
                contentLength,
                maxLength,
                isAnon,
                limitType,
            });
            const errorResult = {
                chatId: "",
                saved: false,
                turnsCount: 0,
                error: "limit_reached" as const,
                message,
                portalLink: isAnon ? portalLink : null,
            };
            console.log("[saveChatManually] ===== EXIT (size limit) =====", errorResult);
            return errorResult;
        }

        // Check chat limit for anonymous users only (normal users are not affected)
        if (isAnon) {
            const nonExpiredCount = await countNonExpiredChats(userId);
            console.log("[saveChatManually] Anonymous user - non-expired chats:", nonExpiredCount, "limit:", ANON_MAX_CHATS);

            if (nonExpiredCount >= ANON_MAX_CHATS) {
                const message = `You've reached the limit of ${ANON_MAX_CHATS} free chats. Please delete a chat in the widget to save more, or upgrade your account to save unlimited chats.`;
                console.log("[saveChatManually] ❌ Chat count limit reached for anonymous user:", {
                    nonExpiredCount,
                    limit: ANON_MAX_CHATS,
                });
                const errorResult = {
                    chatId: "",
                    saved: false,
                    turnsCount: 0,
                    error: "limit_reached" as const,
                    message,
                    portalLink,
                };
                console.log("[saveChatManually] ===== EXIT (chat limit) =====", errorResult);
                return errorResult;
            }
        }

        // Parse the content to extract turns
        // If parsing fails, it will be saved as a note (single turn with text as prompt)
        console.log("[saveChatManually] Parsing content...");
        console.log("[saveChatManually] Content preview (first 500 chars):", htmlContent.substring(0, 500));
        const turns = parseChatContent(htmlContent);
        console.log("[saveChatManually] Parsed turns count:", turns.length);
        if (turns.length > 0) {
            console.log("[saveChatManually] First turn preview:", {
                prompt: turns[0].prompt.substring(0, 100),
                response: turns[0].response.substring(0, 100)
            });
        }

        // All unparseable content is now saved as a note, so we should always have at least one turn
        // Only check for empty content (not parse errors)
        if (turns.length === 0) {
            // This should not happen with the new logic, but handle it as a safety check
            console.warn("[saveChatManually] ❌ Unexpected: no turns after parsing, content may be empty");
            const errorResult = {
                chatId: "",
                saved: false,
                turnsCount: 0,
                error: "parse_error" as const,
                message: "Content is empty or could not be processed",
                portalLink: null,
            };
            console.log("[saveChatManually] ===== EXIT (empty content) =====", errorResult);
            return errorResult;
        }

        console.log("[saveChatManually] ✅ Parsed", turns.length, "turns successfully");
        console.log("[saveChatManually] Turn summary:", {
            totalTurns: turns.length,
            firstTurnPromptLength: turns[0]?.prompt?.length || 0,
            firstTurnResponseLength: turns[0]?.response?.length || 0,
            isNote: turns.length === 1 && !turns[0].response,
        });

        // Use provided title or generate default
        const finalTitle = title?.trim() || generateDefaultTitle();
        console.log("[saveChatManually] Using title:", finalTitle);

        // Use shared core logic to save the chat
        console.log("[saveChatManually] Calling saveChatCore...");
        const coreResult = await saveChatCore({
            userId,
            title: finalTitle,
            turns,
        });
        console.log("[saveChatManually] ✅ saveChatCore result:", {
            chatId: coreResult.chatId,
            saved: coreResult.saved,
        });

        const successResult = {
            chatId: coreResult.chatId,
            saved: coreResult.saved,
            turnsCount: turns.length,
        };
        console.log("[saveChatManually] ===== EXIT (success) =====", successResult);
        return successResult;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("[saveChatManually] ❌ EXCEPTION:", {
            error: errorMessage,
            errorType: error instanceof Error ? error.constructor.name : typeof error,
            stack: error instanceof Error ? error.stack : "N/A",
        });
        // Return structured error instead of throwing
        const errorResult = {
            chatId: "",
            saved: false,
            turnsCount: 0,
            error: "server_error" as const,
            message: "An error occurred while saving the chat. Please try again.",
            portalLink: null,
        };
        console.log("[saveChatManually] ===== EXIT (exception) =====", errorResult);
        return errorResult;
    }
}

