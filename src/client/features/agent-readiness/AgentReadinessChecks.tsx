import { useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";

interface CheckView {
  status: string;
  message: string;
  evidence: string | null;
  fixUrl: string | null;
}

interface ComparedCheckRow {
  checkId: string;
  category: string;
  openseo: CheckView | null;
  cloudflare: CheckView | null;
  agree: boolean | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  discoverability: "Discoverability",
  content: "Content",
  botAccess: "Bot access",
  capabilities: "APIs, auth & agent protocols",
};

const CATEGORY_ORDER = [
  "discoverability",
  "content",
  "botAccess",
  "capabilities",
];

/** Human names for the checks; unknown ids (new Cloudflare checks) show raw. */
const CHECK_LABELS: Record<string, string> = {
  robotsTxt: "robots.txt",
  sitemap: "XML sitemap",
  linkHeaders: "Link headers",
  dnsAid: "DNS agent discovery",
  markdownNegotiation: "Markdown for agents",
  llmsTxt: "llms.txt",
  soft404: "Missing pages return 404",
  contentWithoutJs: "Content without JavaScript",
  robotsTxtAiRules: "AI crawler rules",
  contentSignals: "Content Signals",
  aiBotAccess: "AI crawlers are served",
  apiCatalog: "API catalog",
  oauthDiscovery: "OAuth discovery",
  oauthProtectedResource: "OAuth protected resource",
  authMd: "Auth.md",
  mcpServerCard: "MCP server card",
  a2aAgentCard: "A2A agent card",
  agentSkills: "Agent skills index",
  webMcp: "WebMCP",
  ard: "Agentic resource discovery",
};

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  pass: { label: "Pass", className: "badge-success" },
  fail: { label: "Fail", className: "badge-error" },
  not_applicable: { label: "N/A", className: "badge-ghost" },
  info: { label: "Info", className: "badge-info" },
  error: { label: "Not evaluated", className: "badge-warning" },
};

function StatusBadge({ check }: { check: CheckView | null }) {
  if (!check) return <span className="text-xs text-base-content/40">—</span>;
  const style = STATUS_STYLE[check.status] ?? {
    label: check.status,
    className: "badge-ghost",
  };
  return (
    <span className={`badge badge-sm ${style.className}`}>{style.label}</span>
  );
}

function Detail({ engine, check }: { engine: string; check: CheckView }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase text-base-content/50">
        {engine}
      </p>
      <p className="text-sm">{check.message}</p>
      {check.evidence && (
        <p className="text-xs font-mono text-base-content/60 break-all">
          {check.evidence}
        </p>
      )}
      {check.fixUrl && (
        <a
          href={check.fixUrl}
          target="_blank"
          rel="noreferrer"
          className="link link-hover text-xs inline-flex items-center gap-1"
        >
          How to fix <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}

export function AgentReadinessChecks({
  checks,
}: {
  checks: ComparedCheckRow[];
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {CATEGORY_ORDER.map((category) => {
        const rows = checks.filter((check) => check.category === category);
        if (rows.length === 0) return null;
        return (
          <section key={category} className="space-y-2">
            <h3 className="font-semibold">
              {CATEGORY_LABELS[category] ?? category}
            </h3>
            <div className="overflow-x-auto rounded-lg border border-base-300">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Check</th>
                    <th>OpenSEO</th>
                    <th>Cloudflare</th>
                    <th title="Whether both engines reached the same verdict">
                      Agree
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isOpen = open === row.checkId;
                    return [
                      <tr
                        key={row.checkId}
                        className="cursor-pointer hover"
                        onClick={() => setOpen(isOpen ? null : row.checkId)}
                      >
                        <td className="flex items-center gap-2">
                          <ChevronDown
                            className={`w-3 h-3 transition-transform ${isOpen ? "" : "-rotate-90"}`}
                          />
                          {CHECK_LABELS[row.checkId] ?? row.checkId}
                        </td>
                        <td>
                          <StatusBadge check={row.openseo} />
                        </td>
                        <td>
                          <StatusBadge check={row.cloudflare} />
                        </td>
                        <td>
                          {row.agree === null ? (
                            <span className="text-base-content/40">—</span>
                          ) : row.agree ? (
                            <span className="text-success">✓</span>
                          ) : (
                            <span
                              className="text-warning"
                              title="The engines disagree"
                            >
                              ≠
                            </span>
                          )}
                        </td>
                      </tr>,
                      isOpen && (
                        <tr key={`${row.checkId}-detail`}>
                          <td colSpan={4} className="bg-base-200/40">
                            <div className="grid gap-4 md:grid-cols-2 py-2">
                              {row.openseo && (
                                <Detail engine="OpenSEO" check={row.openseo} />
                              )}
                              {row.cloudflare && (
                                <Detail
                                  engine="Cloudflare"
                                  check={row.cloudflare}
                                />
                              )}
                            </div>
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
