// Who sent a visit: search engines and AI assistants, recognised from the
// referrer host Umami records and from a link's utm_source.

export const SEARCH_ENGINES = [
  "google",
  "bing",
  "yahoo",
  "duckduckgo",
  "ecosia",
  "yandex",
  "other",
] as const;
type SearchEngine = (typeof SEARCH_ENGINES)[number];

// Search engines' own hosts. Matched exactly (after dropping a leading
// `www.`), not as substrings: Google's other services (accounts.google.com
// after a sign-in, notebook.google.com, the Gmail app) refer visits too, and
// none of them is search.
const SEARCH_ENGINE_HOSTS: Array<[RegExp, SearchEngine]> = [
  [/^google\.[a-z]{2,3}(\.[a-z]{2})?$/, "google"],
  [/^com\.google\.android\.googlequicksearchbox$/, "google"],
  [/^(cn\.)?bing\.com$/, "bing"],
  [/^duckduckgo\.com$/, "duckduckgo"],
  [/^([a-z]{2}\.)?search\.yahoo\.com$/, "yahoo"],
  [/^r\.search\.yahoo\.com$/, "yahoo"],
  [/^yandex\.[a-z]{2,3}$/, "yandex"],
  [/^ecosia\.org$/, "ecosia"],
  [/^baidu\.com$/, "other"],
  [/^search\.brave\.com$/, "other"],
  [/^msn\.com$/, "other"],
];

function bareHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
}

/** The search engine a referrer host belongs to, or null when it isn't one. */
export function searchEngineOf(domain: string): SearchEngine | null {
  const host = bareHost(domain);
  return (
    SEARCH_ENGINE_HOSTS.find(([pattern]) => pattern.test(host))?.[1] ?? null
  );
}

export const AI_ASSISTANTS = [
  "chatgpt",
  "perplexity",
  "copilot",
  "gemini",
  "claude",
  "deepseek",
  "grok",
  "meta_ai",
  "mistral",
  "other",
] as const;
type AiAssistant = (typeof AI_ASSISTANTS)[number];

// AI assistants' own hosts, matched exactly like search engines.
const AI_ASSISTANT_HOSTS: Record<string, AiAssistant> = {
  "chatgpt.com": "chatgpt",
  "chat.openai.com": "chatgpt",
  "perplexity.ai": "perplexity",
  "copilot.microsoft.com": "copilot",
  "copilot.com": "copilot",
  "gemini.google.com": "gemini",
  "bard.google.com": "gemini",
  "claude.ai": "claude",
  "chat.deepseek.com": "deepseek",
  "grok.com": "grok",
  "meta.ai": "meta_ai",
  "chat.mistral.ai": "mistral",
  "you.com": "other",
  "poe.com": "other",
  "phind.com": "other",
};

// utm_source values assistants put on the links they cite. ChatGPT appends
// utm_source=chatgpt.com; sites tag their own shares with plain names.
const AI_ASSISTANT_UTM_SOURCES: Record<string, AiAssistant> = {
  ...AI_ASSISTANT_HOSTS,
  chatgpt: "chatgpt",
  openai: "chatgpt",
  perplexity: "perplexity",
  copilot: "copilot",
  gemini: "gemini",
  claude: "claude",
  deepseek: "deepseek",
  grok: "grok",
  "meta-ai": "meta_ai",
  mistral: "mistral",
};

/** The AI assistant a referrer host belongs to, or null. */
export function aiAssistantOfHost(domain: string): AiAssistant | null {
  return AI_ASSISTANT_HOSTS[bareHost(domain)] ?? null;
}

/** The AI assistant a utm_source value names, or null. */
export function aiAssistantOfUtmSource(source: string): AiAssistant | null {
  return AI_ASSISTANT_UTM_SOURCES[bareHost(source)] ?? null;
}
