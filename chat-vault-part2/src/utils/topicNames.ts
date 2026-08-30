/** Normalize a topic display name for deduplication lookups. */
export function normalizeTopicName(name: string): string {
    return name.trim().toLowerCase();
}

/** Trim and validate a topic display name for persistence. */
export function sanitizeTopicDisplayName(name: string, maxLength = 64): string {
    const trimmed = name.trim();
    if (!trimmed) {
        throw new Error("Topic name cannot be empty");
    }
    if (trimmed.length > maxLength) {
        return trimmed.slice(0, maxLength);
    }
    return trimmed;
}
