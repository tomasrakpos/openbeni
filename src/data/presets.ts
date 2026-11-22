// Catalog/default data presets; edit entries here and keep related types in sync.
import type { CustomTemplate, Provider } from "@/lib/types";

export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: Provider["apiFormat"];
  auth: Provider["auth"];
  icon: string;
  color: string;
  extraHeaders?: Record<string, string>;
  notes?: string;
  local?: boolean;
  /** Route this provider through /api/proxy by default (no browser CORS). */
  useProxy?: boolean;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiFormat: "openai",
    auth: { header: "Authorization", prefix: "Bearer " },
    icon: "openai",
    color: "#10a37f",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    apiFormat: "anthropic",
    auth: { header: "x-api-key", prefix: "" },
    icon: "anthropic",
    color: "#d97757",
    notes: "Browser access requires the anthropic-dangerous-direct-browser-access header, which OpenHarneks adds automatically.",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiFormat: "gemini",
    auth: { header: "x-goog-api-key", prefix: "" },
    icon: "google",
    color: "#4285f4",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiFormat: "openai",
    auth: { header: "Authorization", prefix: "Bearer " },
    icon: "openrouter",
    color: "#8b5cf6",
    useProxy: true,
  },
  {
    id: "pollinations",
    name: "Pollinations",
    baseUrl: "https://gen.pollinations.ai/v1",
    apiFormat: "openai",
    auth: { header: "Authorization", prefix: "Bearer " },
    icon: "pollinations",
    color: "#e0a82e",
  },
  {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiFormat: "openai",
    auth: { header: "Authorization", prefix: "Bearer " },
    icon: "groq",
    color: "#f55036",
  },
  {
    id: "mistral",
    name: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    apiFormat: "openai",
    auth: { header: "Authorization", prefix: "Bearer " },
    icon: "mistral",
    color: "#fa520f",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiFormat: "openai",
    auth: { header: "Authorization", prefix: "Bearer " },
    icon: "deepseek",
    color: "#4d6bfe",
  },
  {
    id: "xai",
    name: "xAI",
    baseUrl: "https://api.x.ai/v1",
    apiFormat: "openai",
    auth: { header: "Authorization", prefix: "Bearer " },
    icon: "xai",
    color: "#111827",
  },
  {
    id: "together",
    name: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    apiFormat: "openai",
    auth: { header: "Authorization", prefix: "Bearer " },
    icon: "together",
    color: "#0f6fff",
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    apiFormat: "openai",
    auth: { header: "", prefix: "" },
    icon: "ollama",
    color: "#4b5563",
    local: true,
  },
];

export interface CustomExample {
  id: string;
  name: string;
  description: string;
  template: CustomTemplate;
}

export const CUSTOM_EXAMPLES: CustomExample[] = [
  {
    id: "simple",
    name: "Simple JSON API",
    description: "POST /chat with a prompt field, reply at `reply` and deltas at `token`.",
    template: {
      endpoint: "/chat",
      headers: { "Content-Type": "application/json" },
      bodyTemplate:
        '{\n  "model": {{model}},\n  "messages": {{messages}},\n  "temperature": {{temperature}},\n  "max_tokens": {{max_tokens}},\n  "stream": {{stream}}\n}',
      textPath: "reply",
      deltaPath: "token",
      streamMode: "ndjson",
      modelsPath: "/models",
    },
  },
  {
    id: "openai-proxy",
    name: "OpenAI-shaped gateway",
    description: "A self-hosted gateway that mirrors the OpenAI schema but lives on a custom path.",
    template: {
      endpoint: "/v1/chat/completions",
      headers: { "Content-Type": "application/json" },
      bodyTemplate:
        '{\n  "model": {{model}},\n  "messages": {{messages}},\n  "temperature": {{temperature}},\n  "max_tokens": {{max_tokens}},\n  "stream": {{stream}}\n}',
      textPath: "choices[0].message.content",
      deltaPath: "choices[0].delta.content",
      streamMode: "sse",
      modelsPath: "/v1/models",
    },
  },
];

export function presetById(id: string | undefined): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}
