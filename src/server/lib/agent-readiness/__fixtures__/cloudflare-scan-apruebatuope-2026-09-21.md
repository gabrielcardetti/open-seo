# Agent Readiness: https://apruebatuope.com

**Level 1/5 -- Basic Web Presence**

## Discoverability (2/4 passing)

- PASS robotsTxt: robots.txt exists with valid format
- PASS sitemap: sitemap.xml exists with valid structure (url: https://apruebatuope.com/sitemap.xml, from robots txt, format: xml)
- FAIL linkHeaders -- Include Link response headers for agent discovery (RFC 8288)
  No Link headers found on target page
  **Fix:** Add Link response headers to your homepage that point agents to useful resources. For example: Link: </.well-known/api-catalog>; rel="api-catalog" to advertise your API catalog, or Link: </docs/api>; rel="service-doc" for API documentation. See RFC 8288 for the Link header format and IANA Link Relations for registered relation types.
  **Skill:** https://isitagentready.com/.well-known/agent-skills/link-headers/SKILL.md
  **Spec:** https://www.rfc-editor.org/rfc/rfc8288, https://www.rfc-editor.org/rfc/rfc9727#section-3
- FAIL dnsAid -- Publish DNS for AI Discovery (DNS-AID) SVCB/HTTPS records for DNS-based agent discovery
  DNS for AI Discovery (DNS-AID) well-known entrypoint records not found
  **Fix:** Publish DNS for AI Discovery (DNS-AID) records under your domain, for example \_index.\_agents.example.com or \_a2a.\_agents.example.com, using ServiceMode SVCB/HTTPS records with alpn and endpoint parameters. Sign the public discovery zone with DNSSEC so validating resolvers return authenticated data.
  **Skill:** https://isitagentready.com/.well-known/agent-skills/dns-aid/SKILL.md
  **Spec:** https://datatracker.ietf.org/doc/draft-mozleywilliams-dnsop-dnsaid/, https://www.rfc-editor.org/rfc/rfc9460

## Content Accessibility (0/1 passing)

- FAIL markdownNegotiation -- Support Accept: text/markdown content negotiation for machine-readable content
  Site does not support Markdown for Agents
  **Fix:** Implement content negotiation so requests with Accept: text/markdown return a markdown representation while HTML remains the default for browsers.
  **Skill:** https://isitagentready.com/.well-known/agent-skills/markdown-negotiation/SKILL.md
  **Spec:** https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/

## Bot Access Control (1/2 passing)

- PASS robotsTxtAiRules: Found rules for AI bots: gptbot, chatgpt-user, oai-searchbot, google-extended, ccbot, anthropic-ai, claude-web, bytespider, perplexitybot, cohere-ai, applebot-extended, amazonbot, meta-externalagent, facebookbot, diffbot (targetPath: /, robotsStatus: ok, botPolicies: {"userAgent":"gptbot","effectiveAccess":"allowed","ruleSource":"explicit","rules":[{"directive":"allow","pa …
- FAIL contentSignals -- Declare AI content usage preferences with Content Signals in robots.txt
  No Content Signals found in robots.txt
  **Fix:** Add Content-Signal directives to your robots.txt declaring preferences for ai-train, search, and ai-input. For example:
  Content-Signal: ai-train=no, search=yes, ai-input=no
  **Skill:** https://isitagentready.com/.well-known/agent-skills/content-signals/SKILL.md
  **Spec:** https://contentsignals.org/, https://datatracker.ietf.org/doc/draft-romm-aipref-contentsignals/
- OK webBotAuth: Web Bot Auth directory returned HTML instead of JSON (informational only)

## API, Auth, MCP & A2A Discovery (0/9 passing)

- FAIL apiCatalog -- Publish an API catalog for automated API discovery (RFC 9727)
  API Catalog returned HTML instead of JSON
  **Fix:** Create /.well-known/api-catalog returning application/linkset+json with a "linkset" array. Each entry should include an "anchor" URL for the API and link relations for service-desc (OpenAPI spec), service-doc (documentation), and status (health endpoint). See RFC 9727 Appendix A for examples.
  **Skill:** https://isitagentready.com/.well-known/agent-skills/api-catalog/SKILL.md
  **Spec:** https://www.rfc-editor.org/rfc/rfc9727, https://www.rfc-editor.org/rfc/rfc9264
- FAIL oauthDiscovery -- Publish OAuth/OIDC discovery metadata so agents can authenticate with your APIs
  No OAuth/OIDC discovery metadata found
  **Fix:** If your site has protected APIs, publish /.well-known/openid-configuration (for OpenID Connect) or /.well-known/oauth-authorization-server (for pure OAuth 2.0) with your issuer, authorization_endpoint, token_endpoint, jwks_uri, and grant_types_supported. This allows AI agents to programmatically discover how to authenticate.
  **Skill:** https://isitagentready.com/.well-known/agent-skills/oauth-discovery/SKILL.md
  **Spec:** http://openid.net/specs/openid-connect-discovery-1_0.html, https://www.rfc-editor.org/rfc/rfc8414
- FAIL oauthProtectedResource -- Publish OAuth Protected Resource Metadata so agents can discover how to authenticate
  No OAuth Protected Resource Metadata found
  **Fix:** Publish /.well-known/oauth-protected-resource with your resource identifier, authorization_servers (list of OAuth/OIDC issuer URLs that can issue tokens for this resource), and scopes_supported. This tells agents how to obtain access tokens for your protected APIs. You can also return a WWW-Authenticate header with a resource_metadata parameter on 401 responses to enable dynamic discovery.
  **Skill:** https://isitagentready.com/.well-known/agent-skills/oauth-protected-resource/SKILL.md
  **Spec:** https://www.rfc-editor.org/rfc/rfc9728
- FAIL authMd -- Publish Auth.md metadata for agent registration
  auth.md returned HTML instead of Markdown
  **Fix:** Serve /auth.md at the site root with agent registration instructions, publish /.well-known/oauth-protected-resource, and include an agent_auth block in /.well-known/oauth-authorization-server with register_uri, supported identity types, credential types, and claim/revocation URLs where applicable.
  **Skill:** https://isitagentready.com/.well-known/agent-skills/auth-md/SKILL.md
  **Spec:** https://workos.com/auth-md, https://github.com/workos/auth.md
- FAIL mcpServerCard -- Publish an MCP Server Card for agent discovery
  MCP Server Card not found
  **Fix:** Serve an MCP Server Card (SEP-1649) at /.well-known/mcp/server-card.json with serverInfo (name, version), transport endpoint, and capabilities. The schema is being standardized at https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2127
  **Skill:** https://isitagentready.com/.well-known/agent-skills/mcp-server-card/SKILL.md
  **Spec:** https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2127
- FAIL a2aAgentCard -- Publish an A2A Agent Card for agent-to-agent discovery
  A2A Agent Card returned HTML instead of JSON
  **Fix:** Serve an A2A Agent Card (JSON) at /.well-known/agent-card.json describing your agent. Include name, version, description, supportedInterfaces (with service URL and transport protocol), capabilities, and skills (each with id, name, description). This enables other AI agents to discover and interact with your agent via the A2A protocol.
  **Skill:** https://isitagentready.com/.well-known/agent-skills/a2a-agent-card/SKILL.md
  **Spec:** https://a2a-protocol.org/latest/specification/, https://a2a-protocol.org/latest/topics/agent-discovery/
- FAIL agentSkills -- Publish an agent skills discovery index
  Agent Skills index returned HTML instead of JSON
  **Fix:** Publish a skills discovery index at /.well-known/agent-skills/index.json (per the Agent Skills Discovery RFC v0.2.0). Include a $schema field, and a skills array where each entry has name, type ("skill-md" or "archive"), description, url, and a sha256 digest for integrity verification.
  **Skill:** https://isitagentready.com/.well-known/agent-skills/agent-skills/SKILL.md
  **Spec:** https://github.com/cloudflare/agent-skills-discovery-rfc, https://agentskills.io/
- FAIL webMcp -- Support WebMCP to expose site tools to AI agents via the browser
  No WebMCP tools detected on page load
  **Fix:** Implement the WebMCP API by calling navigator.modelContext.registerTool() for each tool that exposes your site's key actions to AI agents. Each tool needs a name, description, inputSchema (JSON Schema), and an execute callback function. Use an AbortController signal to unregister tools when no longer needed.
  **Skill:** https://isitagentready.com/.well-known/agent-skills/webmcp/SKILL.md
  **Spec:** https://webmachinelearning.github.io/webmcp/, https://developer.chrome.com/blog/webmcp-epp
- FAIL ard -- Publish an ARD (Agentic Resource Discovery) manifest so agents can discover your site's capabilities (MCP servers, A2A agents, OpenAPI schemas, and more)
  ARD capability manifest returned HTML instead of JSON
  **Fix:** Serve /.well-known/ai-catalog.json at the origin root with Content-Type: application/json and Access-Control-Allow-Origin: \*. Include specVersion, a host object, and an entries array. Give each entry a urn:air:<your-domain>:<namespace>:<name> identifier, a displayName, an IANA media type in "type", and exactly one of url or data. Add 2-5 representativeQueries per entry so registries can build semantic embeddings, and a trustManifest when you need verifiable publisher identity.
  **Skill:** https://isitagentready.com/.well-known/agent-skills/ard/SKILL.md
  **Spec:** https://agenticresourcediscovery.org/, https://github.com/ards-project/ard-spec, https://github.com/Agent-Card/ai-catalog

## Commerce (0/0 passing)

- OK x402: x402 payment protocol not detected (not a commerce site)
- OK mpp: MPP payment discovery not detected (not a commerce site)
- OK ucp: UCP profile returned HTML instead of expected format (not a commerce site)
- OK acp: ACP discovery document returned HTML instead of JSON (not a commerce site)
- OK ap2: AP2 not detected (no A2A Agent Card) (not a commerce site)
