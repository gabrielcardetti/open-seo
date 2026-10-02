import {
  DEFAULT_AUDIT_PAGES,
  FREE_MAX_AUDIT_PAGES,
  MIN_AUDIT_PAGES,
  PAID_MAX_AUDIT_PAGES,
} from "@/shared/audit-limits";

export const MIN_PAGES = MIN_AUDIT_PAGES;

export function getMaxPagesLimit(isFreePlan: boolean) {
  return isFreePlan ? FREE_MAX_AUDIT_PAGES : PAID_MAX_AUDIT_PAGES;
}

export type LaunchFormValues = {
  url: string;
  maxPagesInput: string;
  runLighthouse: boolean;
  evaluateContent: boolean;
  /** Also judge the content against Bing's Webmaster Guidelines. */
  includeBing: boolean;
  /** Sections to leave out, one path per line or separated by commas. */
  excludedPathsInput: string;
};

/** The launch form's excluded-paths text as the list the server takes. */
export function parseExcludedPathsInput(input: string): string[] {
  return input
    .split(/[\n,]/)
    .map((path) => path.trim())
    .filter(Boolean);
}

export const DEFAULT_LAUNCH_FORM_VALUES: LaunchFormValues = {
  url: "",
  maxPagesInput: String(DEFAULT_AUDIT_PAGES),
  runLighthouse: false,
  evaluateContent: false,
  includeBing: false,
  excludedPathsInput: "",
};
