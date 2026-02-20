/**
 * Embeddings utility for generating vector embeddings using OpenAI API
 */

import OpenAI from "openai";
import * as dotenv from "dotenv";

dotenv.config();

if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
}

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

/** text-embedding-3-small max input is 8191 tokens; use ~4 chars/token for splitting */
export const MAX_EMBED_CHARS = 30_000;

/**
 * Generate embedding for text using OpenAI Embeddings API
 * Caller must ensure text stays within model context limit (8191 tokens)
 */
export async function generateEmbedding(text: string): Promise<number[]> {
    try {
        // Fallback truncation if a single turn exceeds limit (should not happen with normal splitting)
        const input = text.length > MAX_EMBED_CHARS
            ? text.slice(0, MAX_EMBED_CHARS) + " [truncated]"
            : text;
        if (text.length > MAX_EMBED_CHARS) {
            console.warn("[Embeddings] Single part exceeded limit, truncated:", text.length, "->", MAX_EMBED_CHARS);
        }
        console.log("[Embeddings] Generating embedding for text (length:", input.length, "chars)");

        const response = await openai.embeddings.create({
            model: "text-embedding-3-small", // Using small model for cost efficiency
            input,
        });

        const embedding = response.data[0].embedding;
        console.log("[Embeddings] Embedding generated, dimensions:", embedding.length);

        return embedding;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("[Embeddings] Failed to generate embedding:", errorMessage);
        throw new Error(`Failed to generate embedding: ${errorMessage}`);
    }
}

/**
 * Combine all prompts and responses from chat turns into a single text
 */
export function combineChatText(turns: Array<{ prompt: string; response: string }>): string {
    return turns
        .map((turn) => `${turn.prompt}\n${turn.response}`)
        .join("\n\n");
}

/**
 * Split turns into chunks that stay within the embedding model's context limit.
 * Keeps complete turns intact (never splits mid-turn).
 * @returns Array of turn arrays, each suitable for embedding
 */
export function splitTurnsForEmbedding(
    turns: Array<{ prompt: string; response: string }>,
    maxChars: number = MAX_EMBED_CHARS
): Array<Array<{ prompt: string; response: string }>> {
    if (turns.length === 0) return [];
    const combined = combineChatText(turns);
    if (combined.length <= maxChars) return [turns];    const chunks: Array<Array<{ prompt: string; response: string }>> = [];
    let currentChunk: Array<{ prompt: string; response: string }> = [];
    let currentLen = 0;    for (const turn of turns) {
        const turnText = `${turn.prompt}\n${turn.response}`;
        const turnLen = turnText.length + (currentChunk.length > 0 ? 2 : 0); // +2 for "\n\n"        if (currentLen + turnLen > maxChars && currentChunk.length > 0) {
            chunks.push(currentChunk);
            currentChunk = [];
            currentLen = 0;
        }
        currentChunk.push(turn);
        currentLen += turnLen;
    }
    if (currentChunk.length > 0) {
        chunks.push(currentChunk);
    }
    return chunks;
}