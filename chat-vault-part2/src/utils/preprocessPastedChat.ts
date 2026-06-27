/**
 * Deterministic preprocessing and quality checks for pasted chat blobs.
 * Used before and after LLM parsing to improve turn boundaries and catch incomplete parses.
 */

export interface PreprocessResult {
    /** Text sent to the LLM (HTML preserved when input is HTML, with boundary markers injected). */
    textForLLM: string;
    looksLikeHtml: boolean;
    /** Lower bound on turns the input likely contains. */
    estimatedMinTurns: number;
    /** Count of explicit user markers (You said:, Human:, etc.). */
    userMarkerCount: number;
    /** Hint block prepended to LLM input. */
    parsingHints: string;
}

const USER_MARKER_PATTERN = /\bYou said:\s*/gi;
const HUMAN_MARKER_PATTERN = /^Human:\s*/gim;
const USER_COLON_MARKER_PATTERN = /^User:\s*/gim;

/** Strip only script/style tags and their contents. */
export function stripScriptAndStyle(html: string): string {
    return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
}

/** Count explicit user-message markers in pasted content. */
export function countUserMarkers(text: string): number {
    const youSaid = (text.match(USER_MARKER_PATTERN) || []).length;
    const human = (text.match(HUMAN_MARKER_PATTERN) || []).length;
    const userColon = (text.match(USER_COLON_MARKER_PATTERN) || []).length;
    return youSaid + human + userColon;
}

/**
 * Estimate minimum turns from marker patterns.
 * Gemini: title + first assistant reply + N "You said:" pairs → N + 1 turns.
 */
export function estimateMinimumTurns(text: string): number {
    const markers = countUserMarkers(text);
    if (markers >= 2) return markers + 1;
    if (markers === 1) return 2;
    return 1;
}

/**
 * Inject visible turn/citation boundaries so the LLM can split multi-turn pastes reliably.
 */
export function injectParseBoundaries(text: string): string {
    let out = text;

    // User message boundaries (Gemini "You said:", ChatGPT-style Human:/User:)
    out = out.replace(/\s*(You said:\s*)/gi, "\n\n<<<USER>>>\n$1");
    out = out.replace(/^(\s*Human:\s*)/gim, "\n\n<<<USER>>>\n$1");
    out = out.replace(/^(\s*User:\s*)/gim, "\n\n<<<USER>>>\n$1");

    // Timestamps fused to preceding word: "home12:07 PM" → "home\n12:07 PM"
    out = out.replace(/([^\s\n<>/])(\d{1,2}:\d{2}\s*(?:[AP]M|a\.m\.|p\.m\.))/gi, "$1\n$2");

    // Grounding / citation blocks (Gemini "31 sites", link previews)
    out = out.replace(/(\d+\s+sites)/gi, "\n\n<<<CITATIONS — omit from assistant response>>>\n$1");

    return out;
}

function buildParsingHints(estimatedMinTurns: number, userMarkerCount: number): string {
    const lines = [
        "PARSING HINTS (metadata only — do not copy into turn text):",
        `- Expected minimum turns: ${estimatedMinTurns}`,
    ];
    if (userMarkerCount > 0) {
        lines.push(`- Found ${userMarkerCount} explicit user marker(s) (e.g. "You said:")`);
        lines.push("- Content BEFORE the first <<<USER>>> marker is turn 1 (title/query as prompt, following text as assistant response)");
        lines.push('- Each <<<USER>>> block starts a new user prompt; copy text after "You said:" as prompt (without the prefix or timestamp)');
    }
    lines.push("- Omit everything between <<<CITATIONS>>> markers from assistant responses");
    lines.push("- Output EVERY turn from start to end; never pick only one middle exchange");
    return lines.join("\n");
}

/** Minimal prep for parser: strip script/style only; no boundary injection. */
export function prepareRawPasteForLLM(htmlOrText: string): {
    text: string;
    looksLikeHtml: boolean;
} {
    const looksLikeHtml = /<[a-zA-Z]/.test(htmlOrText);
    const text = looksLikeHtml ? stripScriptAndStyle(htmlOrText) : htmlOrText;
    return { text, looksLikeHtml };
}

/** @deprecated Cost-era preprocess with boundary markers; not used by dual-LLM pipeline. */
export function preprocessPastedChat(htmlOrText: string): PreprocessResult {
    const looksLikeHtml = /<[a-zA-Z]/.test(htmlOrText);
    const base = looksLikeHtml ? stripScriptAndStyle(htmlOrText) : htmlOrText;
    const withBoundaries = injectParseBoundaries(base);
    const userMarkerCount = countUserMarkers(htmlOrText);
    const estimatedMinTurns = estimateMinimumTurns(htmlOrText);
    const parsingHints = buildParsingHints(estimatedMinTurns, userMarkerCount);

    return {
        textForLLM: `${parsingHints}\n\n--- PASTED CONTENT ---\n${withBoundaries}`,
        looksLikeHtml,
        estimatedMinTurns,
        userMarkerCount,
        parsingHints,
    };
}

const TIMESTAMP_SUFFIX = /\s*\d{1,2}:\d{2}\s*(?:[AP]M|a\.m\.|p\.m\.)\s*$/i;
const YOU_SAID_PREFIX = /^You said:\s*/i;

/** Clean prompt/response strings after LLM extraction. */
export function cleanupParsedTurn(turn: { prompt: string; response: string }): { prompt: string; response: string } {
    let prompt = turn.prompt.trim();
    let response = turn.response.trim();

    prompt = prompt.replace(YOU_SAID_PREFIX, "").replace(TIMESTAMP_SUFFIX, "").trim();
    response = response.replace(TIMESTAMP_SUFFIX, "").trim();

    // Drop synthesized References blocks the model sometimes invents
    response = response.replace(/\n\nReferences:\s*\n[\s\S]*$/i, "").trim();

    return { prompt, response };
}

export function cleanupParsedTurns(
    turns: Array<{ prompt: string; response: string }>
): Array<{ prompt: string; response: string }> {
    return turns
        .map(cleanupParsedTurn)
        .filter((t) => t.prompt.length > 0 || t.response.length > 0);
}

export interface ParseQualityResult {
    ok: boolean;
    reason?: string;
}

/** Strip HTML tags for rough plain-text length comparison. */
function plainTextLength(text: string): number {
    return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().length;
}

/** Reject parses that drop turns or lose most of the pasted content. */
export function validateParseQuality(
    turns: Array<{ prompt: string; response: string }>,
    originalInput: string,
    estimatedMinTurns: number
): ParseQualityResult {
    if (turns.length === 0) {
        return { ok: false, reason: "no turns" };
    }

    if (estimatedMinTurns > 1 && turns.length < estimatedMinTurns) {
        return {
            ok: false,
            reason: `turn count ${turns.length} < expected minimum ${estimatedMinTurns}`,
        };
    }

    if (estimatedMinTurns >= 2) {
        const totalExtracted =
            turns.reduce((sum, t) => sum + t.prompt.length + t.response.length, 0);
        const inputLen = plainTextLength(originalInput);
        if (inputLen > 500 && totalExtracted < inputLen * 0.2) {
            return {
                ok: false,
                reason: `extracted ${totalExtracted} chars vs input ~${inputLen} — likely incomplete`,
            };
        }
    }

    return { ok: true };
}
