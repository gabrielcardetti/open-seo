import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "cn";
import { SectionHeader } from "@/client/components/PageHeader";
import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import { Badge } from "@/client/components/ui/badge";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";

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

type BadgeVariant =
  | "success"
  | "destructive"
  | "secondary"
  | "info"
  | "warning";

const STATUS_STYLE: Record<string, { label: string; variant: BadgeVariant }> = {
  pass: { label: "Pass", variant: "success" },
  fail: { label: "Fail", variant: "destructive" },
  not_applicable: { label: "N/A", variant: "secondary" },
  info: { label: "Info", variant: "info" },
  error: { label: "Not evaluated", variant: "warning" },
};

function StatusBadge({ check }: { check: CheckView | null }) {
  if (!check) return <span className="text-xs text-muted-foreground">—</span>;
  const style = STATUS_STYLE[check.status] ?? {
    label: check.status,
    variant: "secondary",
  };
  return <Badge variant={style.variant}>{style.label}</Badge>;
}

function Detail({ engine, check }: { engine: string; check: CheckView }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {engine}
      </p>
      <p className="text-sm">{check.message}</p>
      {check.evidence && (
        <p className="font-mono text-xs break-all text-muted-foreground">
          {check.evidence}
        </p>
      )}
      {check.fixUrl && (
        <SafeExternalLink
          url={check.fixUrl}
          label="How to fix"
          className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
        />
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
          <section key={category} className="space-y-3">
            <SectionHeader title={CATEGORY_LABELS[category] ?? category} />
            <TableCard>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Check</TableHead>
                    <TableHead>OpenSEO</TableHead>
                    <TableHead>Cloudflare</TableHead>
                    <TableHead title="Whether both engines reached the same verdict">
                      Agree
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const isOpen = open === row.checkId;
                    return (
                      <Fragment key={row.checkId}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => setOpen(isOpen ? null : row.checkId)}
                        >
                          <TableCell>
                            {/* The row handles the click; the button gives keyboard access and the expanded state. */}
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              className="flex items-center gap-2 text-left font-medium"
                            >
                              <ChevronRight
                                aria-hidden
                                className={cn(
                                  "size-3.5 shrink-0 text-muted-foreground transition-transform",
                                  isOpen && "rotate-90",
                                )}
                              />
                              {CHECK_LABELS[row.checkId] ?? row.checkId}
                            </button>
                          </TableCell>
                          <TableCell>
                            <StatusBadge check={row.openseo} />
                          </TableCell>
                          <TableCell>
                            <StatusBadge check={row.cloudflare} />
                          </TableCell>
                          <TableCell>
                            {row.agree === null ? (
                              <span className="text-muted-foreground">—</span>
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
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow className="bg-foreground/[0.02] hover:bg-foreground/[0.02]">
                            <TableCell colSpan={4}>
                              <div className="grid gap-4 py-2 md:grid-cols-2">
                                {row.openseo && (
                                  <Detail
                                    engine="OpenSEO"
                                    check={row.openseo}
                                  />
                                )}
                                {row.cloudflare && (
                                  <Detail
                                    engine="Cloudflare"
                                    check={row.cloudflare}
                                  />
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </TableCard>
          </section>
        );
      })}
    </div>
  );
}
