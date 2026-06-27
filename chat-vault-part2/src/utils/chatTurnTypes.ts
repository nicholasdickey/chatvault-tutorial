/** Shared types for paste parsing and verification. */

export type ChatTurn = { prompt: string; response: string };

export type ParseVerdict = "pass" | "fail" | "uncertain";

export type ParseIssue =
    | "missing_turns"
    | "paraphrased"
    | "citations_included"
    | "wrong_roles"
    | "incomplete_coverage"
    | "empty_output";

export interface ParseVerificationResult {
    verdict: ParseVerdict;
    issues: ParseIssue[];
    turnsInSource: number | null;
    turnsInOutput: number;
    coverage: "high" | "medium" | "low";
    explanation: string;
}

export interface ParseAttemptOptions {
    model?: string;
    /** Feedback from judge when retrying a rejected parse. */
    judgeFeedback?: string;
}
