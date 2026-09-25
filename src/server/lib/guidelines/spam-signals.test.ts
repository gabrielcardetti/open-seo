import { describe, expect, it } from "vitest";
import { detectSpamSignals } from "./spam-signals";

const PAGE = "https://example.com/article/";

function signals(
  html: string,
  { finalUrl = PAGE, refreshHeader = null as string | null } = {},
) {
  return detectSpamSignals({
    html,
    finalUrl,
    // Close enough to page-analyzer's visible text for these fixtures.
    bodyText: html.replace(/<[^>]+>/g, " "),
    refreshHeader,
  });
}

const script = (code: string) => `<script>${code}</script>`;

describe("back button traps", () => {
  it.each([
    [
      "a popstate handler that redirects to a feed",
      `history.pushState(null, document.title, location.href);
       window.addEventListener('popstate', function () { window.location.href = '/recommended/?src=back'; });`,
    ],
    [
      "a disable-back trap",
      `window.history.pushState(null, "", window.location.href);
       window.onpopstate = function () { history.go(1); };`,
    ],
    [
      "history stuffed in a loop",
      `for (var i = 0; i < 10; i++) { history.pushState({n:i}, '', '#p' + i); }`,
    ],
    [
      "a hash seed with a hashchange redirect",
      `location.hash = '#!';
       window.onhashchange = function(){ if (!location.hash) location.replace('https://ads.example.net/lp'); };`,
    ],
  ])("flags %s", (_, code) => {
    expect(signals(script(code)).historyTraps).toHaveLength(1);
  });

  it.each([
    [
      "Next.js: router in external chunks, flight data inline",
      `<script src="/_next/static/chunks/main-app-123.js" async></script>
       <script>self.__next_f.push([1,"1:I[\\"123\\",[],\\"\\"]\\n"])</script>`,
    ],
    [
      "a UTM stripper using replaceState",
      script(
        `if (location.search.indexOf('utm_') > -1) { history.replaceState(null, '', location.pathname); }`,
      ),
    ],
    [
      "an inline tab router whose popstate re-renders",
      script(`document.addEventListener('click', function (e) { history.pushState({tab: 1}, '', e.target.href); render(1); });
        window.addEventListener('popstate', function (e) { render(e.state && e.state.tab); });`),
    ],
    [
      "analytics wrapping pushState",
      script(`const original = history.pushState;
        history.pushState = function (...args) { original.apply(this, args); track(location.href); };
        window.addEventListener('popstate', () => track(location.href));`),
    ],
    [
      "a popstate re-render next to an unrelated outbound click handler",
      script(`history.pushState({v: 1}, '', location.href);
        window.addEventListener('popstate', function (e) { renderView(e.state); });
        document.querySelector('#partner').addEventListener('click', function(){ location.href = 'https://partner.example.org/'; });`),
    ],
    [
      "a gallery modal that closes on Back",
      script(`function openGallery(){ history.pushState({modal:true}, ''); modal.show(); }
        window.addEventListener('popstate', function(){ modal.hide(); });`),
    ],
  ])("ignores %s", (_, html) => {
    expect(signals(html).historyTraps).toEqual([]);
  });
});

describe("sneaky redirects", () => {
  it.each([
    [
      "an instant meta refresh to another site",
      `<meta http-equiv="refresh" content="0; url=https://spam-pharma.example.org/buy">`,
    ],
    [
      "a redirect for search visitors (hacked-site pattern)",
      script(`var r = document.referrer;
        if (r.indexOf('google.') > -1) { window.location.href = "https://casino-lp.example.xyz/?id=77"; }`),
    ],
    [
      "a redirect for phones to another site",
      script(
        `if (/Android|iPhone/i.test(navigator.userAgent)) { location.replace('https://m-offers.example.top/'); }`,
      ),
    ],
    [
      "a tiny unconditional redirect",
      script(`window.location = "https://other-brand.example.net/landing";`),
    ],
  ])("flags %s", (_, html) => {
    expect(signals(html).sneakyRedirects).toHaveLength(1);
  });

  it("reads the Refresh response header", () => {
    expect(
      signals("<p>Hi</p>", { refreshHeader: "0;url=https://elsewhere.org/" })
        .sneakyRedirects,
    ).toHaveLength(1);
  });

  it.each([
    [
      "same-site and auto-reload refreshes",
      `<meta http-equiv="refresh" content="300"><meta http-equiv="refresh" content="0;url=https://m.example.com/en/">`,
    ],
    [
      "a click handler to a checkout",
      script(
        `document.getElementById('buy').addEventListener('click', function(){ window.location.href = 'https://checkout.stripe.com/c/pay/x'; });`,
      ),
    ],
    [
      "a smart-app redirect to the App Store",
      script(
        `if (/iPhone|iPad/.test(navigator.userAgent)) { location.href = 'https://apps.apple.com/app/id123456'; }`,
      ),
    ],
    [
      "a noscript refresh fallback and a frame-buster",
      `<noscript><meta http-equiv="refresh" content="0; url=https://legacy.example-cdn.net/nojs"></noscript>${script("if (top !== self) { top.location = self.location; }")}`,
    ],
  ])("ignores %s", (_, html) => {
    expect(signals(html).sneakyRedirects).toEqual([]);
  });
});

const spamLinks = (count: number) =>
  Array.from(
    { length: count },
    (_, i) => `<a href="https://spam.example${i}.com/">cheap viagra ${i}</a>`,
  ).join(" ");

/** Real prose: long, varied, with sentences. */
const PRODUCT_DESCRIPTION = `The frame is cut from recycled aluminium and welded by hand in our
workshop, then powder-coated in one of six colours. Every bike ships with a steel
fork, hydraulic disc brakes and a twelve-speed drivetrain tuned for city hills.
The saddle, grips and pedals are standard sizes, so you can swap them for parts
you already own. We include a torque wrench, spare derailleur hanger and printed
setup guide in the box. Assembly takes about twenty minutes: fit the handlebar,
attach the pedals, check tyre pressure and you are ready to ride. Our warranty
covers the frame for ten years and components for two. If something breaks,
send us a photo and we will post a replacement part within three working days.
Returns are free for thirty days, even if the bike has been ridden, as long as it
comes back without damage. Colours on screen may differ slightly from the paint.
Weight is fourteen kilograms with pedals, and the maximum rider load is one
hundred and twenty kilograms including luggage carried on the optional rear rack.`;

describe("hidden text and links", () => {
  it.each([
    [
      "an injected link farm",
      `<p>Real content.</p><div style="display:none">${spamLinks(8)}</div>`,
    ],
    [
      "an off-screen keyword block",
      `<div style="position:absolute; left:-9999px">${"cheap flights madrid cheap flights barcelona best airline tickets ".repeat(6)}</div>`,
    ],
    [
      "keywords stuffed at font-size 0",
      `<span style="font-size:0px">${"plumber boston emergency plumber cambridge ".repeat(40)}</span>`,
    ],
  ])("flags %s", (_, html) => {
    expect(signals(html).hiddenContent).toHaveLength(1);
  });

  it.each([
    [
      "a screen-reader skip link and logo image replacement",
      `<a href="#main" style="position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Skip to main content</a>
       <h1 style="text-indent:-9999px;background:url(logo.png)">Acme</h1>`,
    ],
    [
      "a hidden FAQ answer",
      `<div class="faq-item"><div style="display:none">${"cheap viagra casino ".repeat(80)}${spamLinks(6)}</div></div>`,
    ],
    [
      "a React streaming segment behind the hidden attribute",
      `<template id="B:0"></template><div hidden id="S:0"><article>${spamLinks(6)}</article></div>`,
    ],
    [
      "hidden sister-site and social links",
      `<div style="display:none"><a href="https://example.de/">DE</a><a href="https://example.fr/">FR</a><a href="https://example.it/">IT</a>
       <a href="https://twitter.com/ex">X</a><a href="https://facebook.com/ex">FB</a><a href="https://instagram.com/ex">IG</a></div>`,
    ],
    [
      "a long product tab hidden without a widget class",
      `<div id="p2" style="display:none"><p>${PRODUCT_DESCRIPTION}</p></div>`,
    ],
    [
      "a GTM noscript iframe and an opacity:0 entrance animation",
      `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-X" style="display:none"></iframe></noscript>
       <div style="opacity:0;transform:translate3d(0,40px,0)">${"cheap flights madrid ".repeat(60)}</div>`,
    ],
  ])("ignores %s", (_, html) => {
    expect(signals(html).hiddenContent).toEqual([]);
  });
});

describe("scam facts", () => {
  it.each([
    [
      "a third-party brand's support line",
      `<h1>Microsoft Windows Support</h1><p>Call Microsoft technical support now at +1 (888) 555-0199.</p>`,
      "https://win-helpdesk-fix.example.com/",
    ],
    [
      "alarm language",
      `<p>Your computer has been infected. Do not restart your PC. Call now to unlock.</p>`,
      "https://security-alert.example.net/",
    ],
    [
      "a password form posting to another site",
      `<form action="https://collect.example-login.ru/p.php"><input type="password" name="pw"></form>`,
      "https://paypal-verify.example.com/",
    ],
  ])("collects %s", (_, html, finalUrl) => {
    expect(signals(html, { finalUrl }).scamFacts).toHaveLength(1);
  });

  it.each([
    [
      "a brand's support line on its own domain",
      `<h1>Windows Support</h1><p>Call Microsoft technical support at +1 (800) 642-7676.</p>`,
      "https://support.microsoft.com/contact",
    ],
    [
      "a comparison that names brands",
      `<p>We compared how Microsoft and Apple handle warranty claims.</p>`,
      "https://reviews.example.com/",
    ],
    [
      "an on-site login form",
      `<form action="/login"><input type="password" name="pw"></form>`,
      "https://acme.com/login",
    ],
  ])("finds nothing in %s", (_, html, finalUrl) => {
    expect(signals(html, { finalUrl }).scamFacts).toEqual([]);
  });
});
