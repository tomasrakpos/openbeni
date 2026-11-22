// Shared logic types; change this helper here and update callers if its contract changes.
export type ApiFormat = "openai" | "anthropic" | "gemini" | "custom";

export type SkillId = "chat" | "web_builder" | "game_builder" | "deep_research";
export type SkillMode = "auto" | SkillId;
export type AuthStyle = "bearer" | "raw" | "query" | "none";
export type Capability = "text" | "vision" | "video" | "audio" | "tools" | "reasoning";
export type Tier = "free" | "paid" | "unknown";

export type PricingClass = "free" | "paid" | "unknown";

export interface AuthConfig {
  /** Header name. Empty string disables the auth header. */
  header: string;
  /** Prefix such as "Bearer " (keep the trailing space) or "". */
  prefix: string;
}

export interface CustomTemplate {
  /** Path appended to the base URL. Supports {{model}}. */
  endpoint: string;
  headers: Record<string, string>;
  /** JSON body template with {{model}}, {{messages}}, {{temperature}}, {{max_tokens}}, {{stream}} */
  bodyTemplate: string;
  /** JSON path for the reply text in a non-streamed response, e.g. "choices[0].message.content" */
  textPath: string;
  /** JSON path for streamed deltas, e.g. "choices[0].delta.content" */
  deltaPath: string;
  /** JSON path for the reasoning/thinking delta, optional */
  reasoningPath?: string;
  streamMode: "sse" | "ndjson" | "json";
  /** Path for the models endpoint, relative to the base URL. */
  modelsPath?: string;
}

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: ApiFormat;
  auth: AuthConfig;
  extraHeaders: Record<string, string>;
  timeoutMs: number;
  useProxy: boolean;
  enabled: boolean;
  favorite: boolean;
  order: number;
  icon?: string;
  color?: string;
  notes?: string;
  presetId?: string;
  /** True for providers that ship with the app and are hidden from the Providers page. */
  bundled?: boolean;
  /**
   * Server-managed provider: the browser never holds a key. Requests go to the
   * same-origin pool endpoint, which adds a rotated key on the server.
   */
  managed?: boolean;
  paths: { models?: string; chat?: string };
  custom?: CustomTemplate;
  hasKey: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ModelPricing {
  /** USD per 1M input tokens */
  prompt: number;
  /** USD per 1M output tokens */
  completion: number;
}

export interface AIModel {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  icon?: string;
  contextWindow?: number;
  capabilities: Capability[];
  /** tier suggested by the provider metadata or curated registry */
  tier: Tier;
  /** explicit user override, wins over everything */
  tierOverride?: Tier;
  /**
   * Site-owned model that is shown with a Paid badge but cannot be run with
   * the site's keys. Only set by the admin catalog.
   */
  locked?: boolean;
  pricing?: ModelPricing;
  /** Explicit pricing classification ('free' | 'paid' | 'unknown') from provider API metadata or official pricing list. */
  pricingTier?: PricingClass;
  enabled: boolean;
  favorite: boolean;
  order: number;
  source: "api" | "manual" | "preset";
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type ErrorKind =
  | "ok"
  | "auth"
  | "rate-limit"
  | "cors"
  | "network"
  | "timeout"
  | "not-found"
  | "server"
  | "http"
  | "unknown";

export interface PingResult {
  id: string;
  providerId: string;
  modelId?: string;
  at: number;
  latencyMs: number;
  ok: boolean;
  httpStatus?: number;
  kind: ErrorKind;
  message?: string;
}

export interface ProbeStep {
  id: string;
  label: string;
  method: "GET" | "POST";
  url: string;
  status?: number;
  ok: boolean;
  note?: string;
  detail?: string;
  models?: string[];
}

export interface DetectionResult {
  format: ApiFormat | null;
  steps: ProbeStep[];
  baseUrl: string;
  models: string[];
  error?: string;
}

export type Role = "system" | "user" | "assistant";

export interface ChatParams {
  temperature: number;
  topP: number;
  maxTokens: number;
  reasoningEffort?: "low" | "medium" | "high";
}

export interface Chat {
  id: string;
  title: string;
  systemPrompt: string;
  pinned: boolean;
  /** Enabled when the backend classifier determines this chat is building a previewable project (website, game, app, UI). */
  previewEnabled?: boolean;
  folderId?: string;
  providerId?: string;
  modelId?: string;
  params: ChatParams;
  currentLeafId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface MessageStats {
  latencyMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  finishReason?: string;
}

export interface Message {
  id: string;
  chatId: string;
  role: Role;
  content: string;
  reasoning?: string;
  parentId: string | null;
  attachments: string[];
  providerId?: string;
  modelId?: string;
  /** Backend skill that handled this assistant turn. */
  skillId?: SkillId;
  /** Number of live web/image sources fetched by the backend skill. */
  skillSourcesCount?: number;
  error?: { kind: ErrorKind; message: string };
  stats?: MessageStats;
  createdAt: number;
}

export type AttachmentKind = "image" | "video" | "file" | "audio";

export interface Attachment {
  id: string;
  chatId: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
  width?: number;
  height?: number;
  durationSec?: number;
  blob?: Blob;
  text?: string;
  /** extracted video frames as data URLs */
  frames?: string[];
  createdAt: number;
}

export interface Folder {
  id: string;
  name: string;
  order: number;
}

export interface ChatMessageInput {
  role: Role;
  content: string;
  images?: { mimeType: string; data: string }[];
  /** native video parts (Gemini) */
  videos?: { mimeType: string; data: string }[];
}

export interface StreamUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface StreamDelta {
  text?: string;
  reasoning?: string;
  usage?: StreamUsage;
  finish?: string;
  error?: string;
}

export interface Settings {
  theme: "dark" | "light" | "system";
  lang: "en" | "fa";
  showBackground: boolean;
  proxyUrl: string;
  autoPingMinutes: number;
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  temperature: number;
  topP: number;
  maxTokens: number;
  systemPresets: { id: string; name: string; prompt: string }[];
  encryption: "device" | "passphrase";
  kdfSalt?: string;
  onboardingDone: boolean;
  showReasoning: boolean;
}

export interface ProjectVersion {
  id: string;
  chatId: string;
  messageId: string;
  label: string;
  files: VirtualFile[];
  createdAt: number;
}

export interface VirtualFile {
  path: string;
  language: string;
  content: string;
}
