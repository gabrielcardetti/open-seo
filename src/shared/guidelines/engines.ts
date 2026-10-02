/**
 * The search engines whose guidelines the catalog carries. A leaf module, so
 * the audit config can name engines without loading the catalog itself (which
 * must stay out of the worker's baseline heap).
 */
export const ENGINES = ["google", "bing"] as const;
export type Engine = (typeof ENGINES)[number];

/**
 * What an evaluation judges when nobody says otherwise. Google only, so that
 * adding Bing's rules changed no verdict an audit already produced.
 */
export const DEFAULT_ENGINES: readonly Engine[] = ["google"];
