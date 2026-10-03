/** How a project reaches Umami: Umami Cloud (API key) or a self-hosted
 *  instance (username and password). */
export const UMAMI_MODES = ["cloud", "self_hosted"] as const;
export type UmamiMode = (typeof UMAMI_MODES)[number];
