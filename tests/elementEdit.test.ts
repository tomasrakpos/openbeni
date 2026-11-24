import { describe, expect, it } from "vitest";
import {
  ELEMENT_EDIT_MARKER,
  isSurgicalElementEditRequest,
  resolveSkillExecution,
  SURGICAL_ELEMENT_EDIT_SYSTEM_PROMPT,
} from "../functions/api/_lib/skills";
import { handlePreviewIntent } from "../functions/api/preview-intent";
import {
  buildApiInputs,
  formatElementEditApiContent,
} from "../src/stores/chats";
import type { AIModel, Message, Provider } from "../src/lib/types";

const MOCK_PROVIDER: Provider = {
  id: "server",
  name: "Site",
  baseUrl: "https://api.example.com/v1",
  apiFormat: "openai",
  authHeader: "Authorization",
  authPrefix: "Bearer ",
  extraHeaders: {},
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
};

const MOCK_MODEL: AIModel = {
  id: "m1",
  providerId: "server",
  modelId: "gpt-4o-mini",
  displayName: "GPT-4o Mini",
  capabilities: ["text"],
  tier: "free",
  enabled: true,
  favorite: false,
  order: 0,
  source: "api",
  createdAt: 1,
  updatedAt: 1,
};

const PURPLE_LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head><title>Purple Login</title><style>body { background: #2e1065; } #signin-btn { background: #7c3aed; color: white; }</style></head>
<body><main><form><h1>Sign In</h1><button id="signin-btn" type="submit">Sign In</button></form></main></body>
</html>`;

describe("AI Preview Element Edit — clean chat + full in-place context", () => {
  it("keeps raw HTML out of user message.content while sending full project files and target element to the API", async () => {
    const assistantBuild: Message = {
      id: "m-build",
      chatId: "c1",
      role: "assistant",
      content: `Here is your purple login form:\n\n\`\`\`html index.html\n${PURPLE_LOGIN_HTML}\n\`\`\``,
      parentId: null,
      attachments: [],
      createdAt: 100,
    };

    const userEdit: Message = {
      id: "m-edit",
      chatId: "c1",
      role: "user",
      content: "رنگش رو قرمز کن",
      parentId: "m-build",
      attachments: [],
      editContext: {
        label: "button#signin-btn",
        selector: "main > form > button#signin-btn",
        tag: "button",
        text: "Sign In",
        outerHtml: `<button id="signin-btn" type="submit">Sign In</button>`,
        projectFiles: [{ path: "index.html", language: "html", content: PURPLE_LOGIN_HTML }],
      },
      createdAt: 200,
    };

    // UI chat message contains ONLY the user's prompt — zero HTML code.
    expect(userEdit.content).toBe("رنگش رو قرمز کن");
    expect(userEdit.content).not.toContain("<button");
    expect(userEdit.content).not.toContain("```");

    // Backend API payload receives the marker, target element, full existing project, and strict in-place edit rules.
    const inputs = await buildApiInputs(
      [assistantBuild, userEdit],
      new Map(),
      MOCK_PROVIDER,
      MOCK_MODEL,
    );
    expect(inputs).toHaveLength(2);
    const apiUserContent = inputs[1]!.content;
    expect(apiUserContent).toContain(ELEMENT_EDIT_MARKER);
    expect(apiUserContent).toContain("SURGICAL IN-PLACE ELEMENT EDIT");
    expect(apiUserContent).toContain("main > form > button#signin-btn");
    expect(apiUserContent).toContain(`<button id="signin-btn" type="submit">Sign In</button>`);
    expect(apiUserContent).toContain("#2e1065");
    expect(apiUserContent).toContain("```html index.html");
    expect(apiUserContent).toContain("رنگش رو قرمز کن");
  });

  it("compacts older element edits in thread history while keeping full context on the latest edit", async () => {
    const firstEdit: Message = {
      id: "m-edit-1",
      chatId: "c1",
      role: "user",
      content: "Make it red",
      parentId: null,
      attachments: [],
      editContext: {
        label: "button#signin-btn",
        selector: "#signin-btn",
        outerHtml: `<button id="signin-btn">Sign In</button>`,
        projectFiles: [{ path: "index.html", language: "html", content: PURPLE_LOGIN_HTML }],
      },
      createdAt: 100,
    };
    const latestEdit: Message = {
      id: "m-edit-2",
      chatId: "c1",
      role: "user",
      content: "Make the text larger",
      parentId: "m-edit-1",
      attachments: [],
      editContext: {
        label: "h1",
        selector: "main > form > h1",
        outerHtml: `<h1>Sign In</h1>`,
        projectFiles: [{ path: "index.html", language: "html", content: PURPLE_LOGIN_HTML }],
      },
      createdAt: 200,
    };

    const olderText = formatElementEditApiContent(firstEdit, false, []);
    expect(olderText).toBe("[Edited preview element button#signin-btn (#signin-btn)]: Make it red");
    expect(olderText).not.toContain(ELEMENT_EDIT_MARKER);

    const inputs = await buildApiInputs(
      [firstEdit, latestEdit],
      new Map(),
      MOCK_PROVIDER,
      MOCK_MODEL,
    );
    expect(inputs[0]!.content).not.toContain(ELEMENT_EDIT_MARKER);
    expect(inputs[1]!.content).toContain(ELEMENT_EDIT_MARKER);
    expect(inputs[1]!.content).toContain("main > form > h1");
  });

  it("skips greenfield redesign skills (taste-skill / impeccable) and injects surgical edit prompt on server", async () => {
    const messages = [
      {
        role: "assistant" as const,
        content: `\`\`\`html index.html\n${PURPLE_LOGIN_HTML}\n\`\`\``,
      },
      {
        role: "user" as const,
        content: `${ELEMENT_EDIT_MARKER}\nChange #signin-btn background to red`,
      },
    ];

    expect(isSurgicalElementEditRequest(messages)).toBe(true);

    const resolved = await resolveSkillExecution({
      messages,
      skillMode: "website",
    });

    expect(resolved.needsPreview).toBe(true);
    expect(resolved.classification.category).toBe("website");
    expect(resolved.selection.selected).toHaveLength(0);
    expect(resolved.selection.mode).toBe("direct");
    expect(resolved.readSkillTool).toBeNull();
    expect(resolved.modeASystemPrompt).toBe(SURGICAL_ELEMENT_EDIT_SYSTEM_PROMPT);
    expect(resolved.modeASystemPrompt).toContain("DO NOT rebuild, redesign, or replace");

    // Also verify /api/preview-intent returns the surgical prompt without greenfield redesign skills.
    const res = await handlePreviewIntent(
      new Request("https://app.example.com/api/preview-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, skillMode: "auto" }),
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      needsPreview: boolean;
      selectedSkills: string[];
      systemPrompt: string;
    };
    expect(json.needsPreview).toBe(true);
    expect(json.selectedSkills).toEqual([]);
    expect(json.systemPrompt).toContain("SURGICAL IN-PLACE ELEMENT EDIT");
  });
});
