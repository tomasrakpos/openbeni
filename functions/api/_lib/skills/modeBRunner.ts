// Mode B execution helper: runs optional `read_skill(name, reference?)` tool-calling loop
// across OpenAI, Anthropic, and Gemini formats with strict token budget enforcement and
// automatic fallback to Mode A (direct injection) if a provider/model rejects tools.

import type { ApiFormat, ProviderRow } from "../providerKeys";
import {
  buildUpstreamRequest,
  normalizeJson,
  type ChatBody,
  type ChatMessageParam,
  type NormalizedJson,
} from "../upstream";
import { executeReadSkillTool, injectSkillSystemPrompt } from "./injection";
import type { ResolvedSkillExecution } from "./index";
import type { SkillContentReader, SkillInjectionMode } from "./types";

export interface ModeBResult {
  usedMode: SkillInjectionMode;
  fallbackReason?: string;
  /** Final normalized JSON answer when Mode B succeeded without falling back. */
  normalized?: NormalizedJson;
  /** Skills actually read via read_skill during the tool loop. */
  loadedViaTool: string[];
}

export interface ExecuteModeBOptions {
  provider: ProviderRow;
  apiKey: string;
  baseBody: ChatBody;
  resolved: ResolvedSkillExecution;
  reader: SkillContentReader;
  fetcher?: typeof fetch;
  maxRounds?: number;
}

/**
 * Attempts Mode B (`read_skill` tool calling).
 * Returns `{ usedMode: "direct", fallbackReason }` if the provider rejects tools or
 * fails so the caller seamlessly falls back to Mode A (direct system-prompt injection).
 */
export async function tryExecuteSkillModeB(
  options: ExecuteModeBOptions
): Promise<ModeBResult> {
  const { provider, apiKey, baseBody, resolved, reader } = options;
  const doFetch = options.fetcher || fetch;
  const maxRounds = Math.max(1, Math.min(4, options.maxRounds ?? 3));
  const format: ApiFormat = provider.api_format ?? "openai";

  if (
    resolved.selection.mode !== "tool" ||
    !resolved.readSkillTool ||
    format === "custom"
  ) {
    return {
      usedMode: "direct",
      fallbackReason: "mode_a_selected",
      loadedViaTool: [],
    };
  }

  let messages: ChatMessageParam[] = injectSkillSystemPrompt(
    baseBody.messages as ChatMessageParam[],
    resolved.modeBSystemPrompt
  );

  let remainingBudget = resolved.selection.maxTokens;
  const loadedViaTool: string[] = [];

  for (let round = 0; round < maxRounds; round++) {
    const isLastRound = round === maxRounds - 1;
    const reqBody: ChatBody = {
      ...baseBody,
      messages,
      stream: false,
      ...(isLastRound ? {} : { tools: [resolved.readSkillTool] }),
    };

    const { url, init } = buildUpstreamRequest(provider, apiKey, reqBody, false);
    let res: Response;
    try {
      res = await doFetch(url, init);
    } catch {
      return {
        usedMode: "direct",
        fallbackReason: "tool_network_error",
        loadedViaTool,
      };
    }

    if (!res.ok) {
      // Any 4xx (e.g. model/provider does not support function calling) cleanly falls back to Mode A
      if (res.status === 400 || res.status === 404 || res.status === 422 || res.status === 501) {
        return {
          usedMode: "direct",
          fallbackReason: `tool_unsupported_http_${res.status}`,
          loadedViaTool,
        };
      }
      return {
        usedMode: "direct",
        fallbackReason: `tool_upstream_http_${res.status}`,
        loadedViaTool,
      };
    }

    let rawJson: unknown;
    try {
      rawJson = await res.json();
    } catch {
      return {
        usedMode: "direct",
        fallbackReason: "tool_invalid_json",
        loadedViaTool,
      };
    }

    const normalized = normalizeJson(format, rawJson);
    const firstChoice = normalized.choices[0];
    const toolCalls = firstChoice?.message?.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      return {
        usedMode: "tool",
        normalized,
        loadedViaTool,
      };
    }

    // Append assistant tool-call turn
    messages = [
      ...messages,
      {
        role: "assistant",
        content: firstChoice.message.content || "",
        tool_calls: toolCalls,
      },
    ];

    // Execute ONLY `read_skill` safely (never any arbitrary/host command!)
    for (const tc of toolCalls) {
      if (tc.name !== "read_skill") {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          name: tc.name,
          content: `Tool '${tc.name}' is not available. Only 'read_skill' is permitted.`,
        });
        continue;
      }

      const skillName =
        typeof tc.arguments.name === "string" ? tc.arguments.name : "";
      const reference =
        typeof tc.arguments.reference === "string"
          ? tc.arguments.reference
          : undefined;

      const toolOut = await executeReadSkillTool({
        name: skillName,
        reference,
        reader,
        remainingTokenBudget: remainingBudget,
      });

      if (toolOut.ok) {
        remainingBudget = Math.max(0, remainingBudget - toolOut.tokensUsed);
        loadedViaTool.push(reference ? `${skillName}:${reference}` : skillName);
      }

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        name: "read_skill",
        content: toolOut.content,
      });
    }
  }

  return {
    usedMode: "direct",
    fallbackReason: "tool_max_rounds_exceeded",
    loadedViaTool,
  };
}
