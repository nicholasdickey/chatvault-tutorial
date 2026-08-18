import { describe, expect, test } from "@jest/globals";
import { isNeonConnectionString } from "../src/db/connectionType.js";
import { chatListSelection } from "../src/tools/chatListSelection.js";

describe("optimized saved-entry list path", () => {
  test("selects response fields without loading embeddings", () => {
    expect(Object.keys(chatListSelection)).toEqual([
      "id",
      "userId",
      "title",
      "timestamp",
      "turns",
    ]);
    expect(chatListSelection).not.toHaveProperty("embedding");
  });

  test.each([
    "postgresql://user:pass@ep-example.us-west-2.aws.neon.tech/db",
    "postgres://user:pass@neon.tech/db",
  ])("uses Neon HTTP only for Neon database hosts: %s", (url) => {
    expect(isNeonConnectionString(url)).toBe(true);
  });

  test.each([
    "postgresql://user:pass@localhost:5432/db",
    "postgresql://user:pass@pgbouncer.example.com/db",
    "not-a-url",
  ])("keeps non-Neon and test databases on postgres.js: %s", (url) => {
    expect(isNeonConnectionString(url)).toBe(false);
  });

  test("topic list helpers do not select embedding columns", async () => {
    const source = await import("fs/promises").then((fs) =>
      fs.readFile(
        new URL("../src/tools/topicQueries.ts", import.meta.url),
        "utf8"
      )
    );
    expect(source).not.toMatch(/topics\.embedding/);
    expect(source).not.toMatch(/embedding:/);
  });
});
