import { afterEach, describe, expect, it } from "@jest/globals";
import {
  createDataExportUrl,
  verifyDataExportToken,
} from "../src/utils/dataExport.js";

describe("data export links", () => {
  const originalApiKey = process.env.API_KEY;
  const originalExportSecret = process.env.CHATVAULT_EXPORT_SECRET;
  const originalPublicBaseUrl = process.env.CHATVAULT_PUBLIC_BASE_URL;

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.API_KEY;
    else process.env.API_KEY = originalApiKey;
    if (originalExportSecret === undefined) delete process.env.CHATVAULT_EXPORT_SECRET;
    else process.env.CHATVAULT_EXPORT_SECRET = originalExportSecret;
    if (originalPublicBaseUrl === undefined) delete process.env.CHATVAULT_PUBLIC_BASE_URL;
    else process.env.CHATVAULT_PUBLIC_BASE_URL = originalPublicBaseUrl;
  });

  it("creates a short-lived signed URL for the current user", () => {
    process.env.CHATVAULT_EXPORT_SECRET = "test-export-secret";
    process.env.CHATVAULT_PUBLIC_BASE_URL = "https://vault.example.com";

    const result = createDataExportUrl({
      userId: "user-123",
      userContext: { isAnon: true, isAnonymousPlan: true },
      headers: {},
    });
    const url = new URL(result.downloadUrl);
    const payload = verifyDataExportToken(url.searchParams.get("token") || "");

    expect(url.origin).toBe("https://vault.example.com");
    expect(url.pathname).toBe("/api/export");
    expect(payload).toMatchObject({
      userId: "user-123",
      isAnon: true,
      isAnonymousPlan: true,
    });
    expect(payload?.expiresAt).toBeGreaterThan(Date.now());
  });

  it("rejects a tampered token", () => {
    process.env.CHATVAULT_EXPORT_SECRET = "test-export-secret";
    const result = createDataExportUrl({
      userId: "user-123",
      headers: { host: "vault.example.com" },
    });
    const url = new URL(result.downloadUrl);
    const token = url.searchParams.get("token") || "";

    expect(verifyDataExportToken(`${token}tampered`)).toBeNull();
  });
});
