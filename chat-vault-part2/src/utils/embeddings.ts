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

/**
 * Generate embedding for text using OpenAI Embeddings API
 */
export async function generateEmbedding(text: string): Promise<number[]> {
    try {
        console.log("[Embeddings] Generating embedding for text (length:", text.length, "chars)");

        const response = await openai.embeddings.create({
            model: "text-embedding-3-small", // Using small model for cost efficiency
            input: text,
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

