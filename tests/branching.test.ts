// Tests for branching.test; add or update cases here to match observable behavior.
import { describe, expect, it } from "vitest";
import {
  branchInfo,
  buildThread,
  childrenOf,
  deepestLeaf,
  groupChildren,
  lastLeaf,
} from "@/lib/branching";
import type { Message, Role } from "@/lib/types";

function message(id: string, parentId: string | null, createdAt: number, role: Role = "user"): Message {
  return {
    id,
    chatId: "chat-1",
    role,
    content: id,
    parentId,
    attachments: [],
    createdAt,
  };
}

// root -> answer -> follow-up -> final answer
const root = message("m1", null, 1, "user");
const answer = message("m2", "m1", 2, "assistant");
const followUp = message("m3", "m2", 3, "user");
const final = message("m4", "m3", 4, "assistant");
// second user branch under the same assistant answer
const followUpBranch = message("m5", "m2", 5, "user");
const branchAnswer = message("m6", "m5", 6, "assistant");

const messages = [root, answer, followUp, final, followUpBranch, branchAnswer];

describe("buildThread", () => {
  it("walks parent pointers from a leaf to the root", () => {
    expect(buildThread(messages, "m4").map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(buildThread(messages, "m6").map((m) => m.id)).toEqual(["m1", "m2", "m5", "m6"]);
  });

  it("returns an empty thread for an unknown or missing leaf", () => {
    expect(buildThread(messages, null)).toEqual([]);
    expect(buildThread(messages, "missing")).toEqual([]);
  });

  it("is cycle-safe", () => {
    const a = message("a", "b", 1);
    const b = message("b", "a", 2);
    expect(buildThread([a, b], "a").length).toBe(2);
  });
});

describe("groupChildren", () => {
  it("groups by parent id in creation order", () => {
    const groups = groupChildren(messages);
    expect((groups.get(null) ?? []).map((m) => m.id)).toEqual(["m1"]);
    expect((groups.get("m2") ?? []).map((m) => m.id)).toEqual(["m3", "m5"]);
  });
});

describe("childrenOf", () => {
  it("returns siblings with the same parent and role, excluding itself", () => {
    expect(childrenOf(messages, followUp).map((m) => m.id)).toEqual(["m5"]);
    expect(childrenOf(messages, followUpBranch).map((m) => m.id)).toEqual(["m3"]);
  });
});

describe("branchInfo", () => {
  it("reports a 1-based visual position", () => {
    const first = branchInfo(messages, followUp);
    expect(first.total).toBe(2);
    expect(first.index).toBe(0);

    const second = branchInfo(messages, followUpBranch);
    expect(second.total).toBe(2);
    expect(second.index).toBe(1);
  });

  it("handles a message with no siblings", () => {
    const info = branchInfo(messages, root);
    expect(info.total).toBe(1);
    expect(info.index).toBe(0);
  });
});

describe("deepestLeaf and lastLeaf", () => {
  it("follows the most recent descendant", () => {
    expect(deepestLeaf(messages, "m1")).toBe("m6");
    expect(deepestLeaf(messages, "m4")).toBe("m4");
  });

  it("finds the last visible branch tip", () => {
    expect(lastLeaf(messages)).toBe("m6");
    expect(lastLeaf([])).toBeNull();
  });
});
