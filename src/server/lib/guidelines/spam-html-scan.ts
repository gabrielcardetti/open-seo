/**
 * The one streaming pass over raw HTML that spam-signals.ts reads from.
 *
 * It keeps only what the detectors need: inline script text (capped), refresh
 * directives, inline-style hidden blocks with their text and links, and the
 * targets of password forms. Streaming, like page-analyzer, because a DOM of a
 * 1 MB page is what used to push the audit worker out of memory.
 */
import { Parser } from "htmlparser2";
import { getDomain } from "tldts";

/** Inline script kept in total. Past this it is a bundle, not a snippet. */
const MAX_INLINE_SCRIPT_CHARS = 200_000;
/** Text kept per hidden block; every detector threshold is far under it. */
const MAX_HIDDEN_TEXT_CHARS = 20_000;

/** Registrable domain (example.co.uk for a.b.example.co.uk), or null for non-web URLs. */
export function registrableDomain(url: string, base?: string): string | null {
  try {
    const parsed = new URL(url, base);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return getDomain(parsed.hostname) ?? parsed.hostname;
  } catch {
    return null;
  }
}

export interface Refresh {
  delay: number;
  url: string;
  source: "meta" | "header";
  inNoscript: boolean;
}

export interface HiddenBlock {
  tag: string;
  technique: string;
  text: string;
  links: Array<{ domain: string | null; text: string }>;
}

export interface Scan {
  pageUrl: string;
  siteDomain: string | null;
  inlineScripts: string[];
  metaRefreshes: Refresh[];
  hiddenBlocks: HiddenBlock[];
  /** `action` of every form holding a password field. */
  credentialFormActions: string[];
}

const JS_TYPES =
  /^(?:|text\/javascript|application\/javascript|module|text\/ecmascript)$/i;

/**
 * Subtrees that are never page content: GTM's `<noscript><iframe
 * style="display:none">`, templates and closed dialogs are hidden by design.
 */
const SKIPPED_SUBTREES = new Set([
  "script",
  "style",
  "noscript",
  "svg",
  "template",
  "dialog",
  "select",
  "iframe",
  "object",
]);

/**
 * Interface widgets hide content legitimately (the policy names accordions,
 * tabs and tooltips), so a hidden block inside one is not a candidate.
 */
const WIDGET_HINT =
  /(?:^|[\s_-])(?:menu|nav|navbar|modal|popup|pop-up|dropdown|tab|tabs|tabpanel|accordion|collapse|tooltip|cookie|consent|gdpr|slide|slider|carousel|drawer|overlay|lightbox|mobile|offcanvas|search|mega|submenu|faq|toggle|dialog|lang|language|currency)(?:$|[\s_-])/i;
const WIDGET_ROLES =
  /^(?:dialog|alertdialog|menu|menubar|tabpanel|tooltip|listbox|navigation)$/i;
const WIDGET_TAGS = new Set(["nav", "details", "header"]);

function isWidget(name: string, attrs: Record<string, string>): boolean {
  return (
    WIDGET_TAGS.has(name) ||
    WIDGET_HINT.test(`${attrs.class ?? ""} ${attrs.id ?? ""}`) ||
    WIDGET_ROLES.test(attrs.role ?? "") ||
    "aria-modal" in attrs ||
    "aria-labelledby" in attrs
  );
}

/**
 * How an inline style hides its element, or null.
 *
 * Only inline styles are visible without CSS, which is also what keeps this
 * precise: class-based hiding (`.hidden`, Tailwind, `.sr-only`) is where most
 * legitimate hiding lives. The `hidden` attribute is ignored on purpose, since
 * React and Next.js stream whole pages through `<div hidden>`. `opacity:0` is
 * not hiding either: Webflow, Framer and AOS set it on content that fades in.
 */
function hidingTechnique(style: string | undefined): string | null {
  if (!style) return null;
  const s = style
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/!important/g, "");
  // Screen-reader-only text is explicitly allowed by the policy.
  if (
    /clip:rect\(|clip-path:inset\(50%\)|(?:^|;)width:1px;?.*height:1px|(?:^|;)height:1px;?.*width:1px/.test(
      s,
    )
  ) {
    return null;
  }
  if (/(?:^|;)display:none(?:;|$)/.test(s)) return "display:none";
  if (/(?:^|;)visibility:hidden(?:;|$)/.test(s)) return "visibility:hidden";
  if (/(?:^|;)font-size:0(?:\.0+)?(?:px|em|rem|pt|%)?(?:;|$)/.test(s)) {
    return "font-size:0";
  }
  if (
    /(?:^|;)(?:left|top|right|text-indent|margin-left|margin-top):-(?:9{3,}|\d{4,})(?:\.\d+)?(?:px|em|rem|pt)?(?:;|$)/.test(
      s,
    )
  ) {
    return "off-screen";
  }
  if (
    /(?:^|;)(?:height|max-height):0(?:px)?(?:;|$)/.test(s) &&
    s.includes("overflow:hidden")
  ) {
    return "height:0";
  }
  return null;
}

const REFRESH_CONTENT =
  /^\s*(\d+(?:\.\d+)?)?\s*[;,]?\s*(?:url\s*=\s*)?['"]?([^'"]*)['"]?\s*$/i;

export function parseRefresh(
  content: string,
  source: Refresh["source"],
  inNoscript = false,
): Refresh {
  const match = REFRESH_CONTENT.exec(content);
  return {
    delay: Number(match?.[1] ?? 0),
    url: (match?.[2] ?? "").trim(),
    source,
    inNoscript,
  };
}

interface Frame {
  skipped: boolean;
  widget: boolean;
  /** This element opened the current hidden block. */
  opensBlock: boolean;
  isForm: boolean;
}

/**
 * htmlparser2 emits exactly one close for every open (void elements and
 * unclosed tags included), so a plain stack of frames stays balanced.
 */
export function scanHtml(html: string, pageUrl: string): Scan {
  const siteDomain = registrableDomain(pageUrl);
  const inlineScripts: string[] = [];
  let inlineScriptChars = 0;
  const metaRefreshes: Refresh[] = [];
  const hiddenBlocks: HiddenBlock[] = [];
  const credentialFormActions: string[] = [];

  const stack: Frame[] = [];
  const forms: Array<{ action: string; hasPassword: boolean }> = [];
  let skipDepth = 0;
  let widgetDepth = 0;
  let noscriptDepth = 0;
  let script: string[] | null = null;
  let block: HiddenBlock | null = null;
  let link: HiddenBlock["links"][number] | null = null;

  const addBlockText = (text: string) => {
    if (!block || block.text.length >= MAX_HIDDEN_TEXT_CHARS) return;
    block.text += text;
    if (link) link.text += text;
  };

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (
          name === "script" &&
          !attrs.src &&
          JS_TYPES.test((attrs.type ?? "").trim())
        ) {
          script = [];
        }
        if (name === "noscript") noscriptDepth += 1;
        if (name === "meta" && /^refresh$/i.test(attrs["http-equiv"] ?? "")) {
          metaRefreshes.push(
            parseRefresh(attrs.content ?? "", "meta", noscriptDepth > 0),
          );
        }
        if (name === "form") {
          forms.push({ action: attrs.action ?? "", hasPassword: false });
        }
        if (name === "input" && attrs.type?.toLowerCase() === "password") {
          const form = forms.at(-1);
          if (form) form.hasPassword = true;
        }

        const frame: Frame = {
          skipped: SKIPPED_SUBTREES.has(name),
          widget: isWidget(name, attrs),
          opensBlock: false,
          isForm: name === "form",
        };
        stack.push(frame);
        if (frame.skipped) skipDepth += 1;
        if (frame.widget) widgetDepth += 1;
        if (skipDepth > 0) return;

        addBlockText(" ");
        if (!block && widgetDepth === 0) {
          const technique = hidingTechnique(attrs.style);
          if (technique) {
            block = { tag: name, technique, text: "", links: [] };
            frame.opensBlock = true;
          }
        }
        if (block && name === "a" && attrs.href) {
          link = { domain: registrableDomain(attrs.href, pageUrl), text: "" };
          block.links.push(link);
        }
      },
      ontext(text) {
        if (script) {
          script.push(text);
          return;
        }
        if (skipDepth === 0) addBlockText(text);
      },
      onclosetag(name) {
        if (name === "script" && script) {
          const code = script.join("");
          if (inlineScriptChars < MAX_INLINE_SCRIPT_CHARS) {
            inlineScripts.push(
              code.slice(0, MAX_INLINE_SCRIPT_CHARS - inlineScriptChars),
            );
            inlineScriptChars += code.length;
          }
          script = null;
        }
        if (name === "noscript" && noscriptDepth > 0) noscriptDepth -= 1;
        if (name === "a") link = null;

        const frame = stack.pop();
        if (!frame) return;
        if (frame.skipped) skipDepth -= 1;
        if (frame.widget) widgetDepth -= 1;
        if (frame.isForm) {
          const form = forms.pop();
          if (form?.hasPassword) credentialFormActions.push(form.action);
        }
        addBlockText(" ");
        if (frame.opensBlock && block) {
          hiddenBlocks.push(block);
          block = null;
        }
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();

  return {
    pageUrl,
    siteDomain,
    inlineScripts,
    metaRefreshes,
    hiddenBlocks,
    credentialFormActions,
  };
}
