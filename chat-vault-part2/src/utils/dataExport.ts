import { createHmac, timingSafeEqual } from "node:crypto";
import type { UserContext } from "../server.js";

const EXPORT_TTL_MS = 2 * 60 * 1000;

export interface DataExportTokenPayload {
  userId: string;
  isAnon: boolean;
  isAnonymousPlan?: boolean;
  expiresAt: number;
}

function getExportSecret(): string {
  const secret = process.env.CHATVAULT_EXPORT_SECRET?.trim() || process.env.API_KEY?.trim();
  if (!secret) {
    throw new Error("Server misconfigured: missing CHATVAULT_EXPORT_SECRET or API_KEY");
  }
  return secret;
}

function sign(encodedPayload: string): string {
  return createHmac("sha256", getExportSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function firstHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function createDataExportUrl(params: {
  userId: string;
  userContext?: UserContext;
  headers: Record<string, string | string[] | undefined>;
}): { downloadUrl: string; expiresAt: string } {
  const expiresAt = Date.now() + EXPORT_TTL_MS;
  const payload: DataExportTokenPayload = {
    userId: params.userId,
    isAnon: params.userContext?.isAnon ?? false,
    ...(params.userContext?.isAnonymousPlan !== undefined && {
      isAnonymousPlan: params.userContext.isAnonymousPlan,
    }),
    expiresAt,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const token = `${encodedPayload}.${sign(encodedPayload)}`;

  const configuredBaseUrl = process.env.CHATVAULT_PUBLIC_BASE_URL?.trim();
  const vercelProductionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const vercelDeploymentHost = process.env.VERCEL_URL?.trim();
  const forwardedHost = firstHeader(params.headers, "x-forwarded-host");
  const host = forwardedHost || firstHeader(params.headers, "host");
  const forwardedProto = firstHeader(params.headers, "x-forwarded-proto");
  const baseUrl = configuredBaseUrl ||
    (vercelProductionHost ? `https://${vercelProductionHost}` : null) ||
    (vercelDeploymentHost ? `https://${vercelDeploymentHost}` : null) ||
    (host ? `${forwardedProto || "https"}://${host}` : null);
  if (!baseUrl) {
    throw new Error("Unable to determine the public Chat Vault URL");
  }

  const url = new URL("/api/export", baseUrl);
  url.searchParams.set("token", token);
  return { downloadUrl: url.toString(), expiresAt: new Date(expiresAt).toISOString() };
}

export function verifyDataExportToken(token: string): DataExportTokenPayload | null {
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const encodedPayload = token.slice(0, separator);
  const suppliedSignature = token.slice(separator + 1);
  const expectedSignature = sign(encodedPayload);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as DataExportTokenPayload;
    if (!payload.userId || !payload.expiresAt || payload.expiresAt <= Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
