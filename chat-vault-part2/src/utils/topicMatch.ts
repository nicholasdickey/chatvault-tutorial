/** Cosine similarity between two embedding vectors (same length). */
export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0 || a.length !== b.length) {
        return 0;
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i]! * b[i]!;
        normA += a[i]! * a[i]!;
        normB += b[i]! * b[i]!;
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}

export interface TopicEmbeddingCandidate {
    id: string;
    embedding: number[] | null;
}

/** Returns the best-matching topic id when similarity meets the threshold. */
export function findBestTopicMatch(
    labelEmbedding: number[],
    candidates: TopicEmbeddingCandidate[],
    threshold: number
): string | null {
    let bestId: string | null = null;
    let bestScore = threshold;

    for (const candidate of candidates) {
        if (!candidate.embedding?.length) continue;
        const score = cosineSimilarity(labelEmbedding, candidate.embedding);
        if (score >= bestScore) {
            bestScore = score;
            bestId = candidate.id;
        }
    }

    return bestId;
}
