// The public pages Google's OAuth consent screen links to (homepage, privacy
// policy, terms) for this personal instance. Plain HTML with inline styles:
// Cloudflare Access bypasses /about, but not the app's /assets, so a page
// that loaded the app bundle would render unstyled for anyone signed out.

const OPERATOR = "Gabriel Cardetti";
const CONTACT = "gabicardetti@gmail.com";
const UPDATED = "October 12, 2026";

const pages: Record<string, { title: string; body: string }> = {
  home: {
    title: "OpenSEO (personal instance)",
    body: `
<p>This is a private, self-hosted copy of the open-source OpenSEO tool, run by
${OPERATOR} for his own websites. It is not a public service: only its operator
can sign in.</p>
<p>When the operator connects Google Search Console or Google Analytics,
OpenSEO reads that data to show SEO reports (search performance, indexing,
traffic) and submits sitemaps to Search Console when asked.</p>`,
  },
  privacy: {
    title: "Privacy policy",
    body: `
<p>This instance of OpenSEO is used only by its operator, ${OPERATOR}.</p>
<h2>Google data it accesses</h2>
<ul>
<li>Google Search Console: search performance, URL inspection and sitemaps, and
submitting sitemaps.</li>
<li>Google Analytics: read-only reports.</li>
<li>The Google account's email address and basic profile, to label the
connection.</li>
</ul>
<h2>How it is used and stored</h2>
<p>The data is used only to show reports and SEO tools to the operator. It is
not sold, not shared with third parties, and not used for advertising. OAuth
tokens are stored encrypted, along with the selected property and indexing
check results, in the app's database on Cloudflare. Other reports are read
from Google when they are opened. When the operator asks an AI assistant
connected to OpenSEO for this data, the requested data is sent to that
assistant.</p>
<p>OpenSEO's use and transfer of information received from Google APIs adheres
to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google
API Services User Data Policy</a>, including the Limited Use requirements.</p>
<h2>Removing access</h2>
<p>Disconnect the integration in OpenSEO's settings, or revoke access at
<a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.
To delete stored data, write to <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>`,
  },
  terms: {
    title: "Terms of service",
    body: `
<p>This instance of OpenSEO is a personal tool operated by ${OPERATOR}. Only
its operator may use it. It is provided as is, without warranty of any kind.
Data read from Google is also subject to Google's own terms.</p>`,
  },
};

const STYLE = `
:root { color-scheme: light dark; }
body { margin: 0 auto; max-width: 42rem; padding: 2rem 1rem; line-height: 1.6;
  font-family: system-ui, sans-serif; }
h1 { font-size: 1.6rem; } h2 { font-size: 1.1rem; margin-top: 1.5rem; }
nav, footer { font-size: .9rem; opacity: .75; }`;

export function aboutPageResponse(page: string): Response {
  const content = pages[page];
  if (!content) return new Response("Not found", { status: 404 });
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${content.title}</title>
<style>${STYLE}</style>
</head>
<body>
<nav><a href="/about">Home</a> · <a href="/about/privacy">Privacy policy</a> · <a href="/about/terms">Terms of service</a></nav>
<h1>${content.title}</h1>
${content.body}
<footer><p>Contact: <a href="mailto:${CONTACT}">${CONTACT}</a> · Last updated ${UPDATED}</p></footer>
</body>
</html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
