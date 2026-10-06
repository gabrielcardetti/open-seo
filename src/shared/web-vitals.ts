/** Web Vitals OpenSEO reports, from Umami's real-user data and Google's
 *  Chrome UX Report alike. */
export const WEB_VITALS = ["lcp", "inp", "cls", "fcp", "ttfb"] as const;
export type WebVital = (typeof WEB_VITALS)[number];

export type WebVitalRating = "good" | "needs_improvement" | "poor";

// Good up to the first number, poor above the second, as Google's Core Web
// Vitals and Lighthouse define them. Times in ms; CLS is unitless.
export const WEB_VITAL_THRESHOLDS = {
  lcp: [2500, 4000],
  inp: [200, 500],
  cls: [0.1, 0.25],
  fcp: [1800, 3000],
  ttfb: [800, 1800],
} as const satisfies Record<WebVital, readonly [number, number]>;

export function rateWebVital(
  metric: WebVital,
  value: number | null,
): WebVitalRating | null {
  if (value === null) return null;
  const [good, poor] = WEB_VITAL_THRESHOLDS[metric];
  return value <= good ? "good" : value <= poor ? "needs_improvement" : "poor";
}
