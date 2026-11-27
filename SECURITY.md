# Security Policy

## Supported Versions

Security updates are provided for the latest `1.x` release line on `main`:

| Version | Supported |
| ------- | --------- |
| `1.x`   | Yes       |
| `< 1.0` | No        |

## Reporting a Vulnerability

Please **do not** report security vulnerabilities through public GitHub issues or pull requests.

Instead, report them privately using GitHub Security Advisories:

- **Private report:** https://github.com/404kidwiz/antigravity-action-launchpad/security/advisories/new

Include:
1. A clear description of the vulnerability and affected file(s) or workflow(s).
2. Minimal reproduction steps or a proof-of-concept payload.
3. Expected impact (for example, XSS inside the `ui://` iframe, MCP schema bypass, or unsafe host message injection).

### Response Expectations

- **Initial acknowledgment:** within 72 hours.
- **Triage & fix target:** critical/high issues are prioritized for the next patch release and published with a security advisory once fixed.

## Security Model Notes

- **Local-only stdio MCP server:** `antigravity-action-launchpad` runs locally over stdio and makes no outbound network requests at runtime.
- **Zero-framework single-file UI:** `dist/actions.html` renders strictly validated tool arguments using safe DOM APIs (no `innerHTML` on untrusted strings and no remote CDN assets).
- **No secret collection:** Text input fields (`inputs`) are intended strictly for non-sensitive short parameters (such as branch names or tags), never passwords, API keys, or credentials.
- **Automated scanning:** `main` is checked on every push and pull request with GitHub Actions CI, CodeQL (`javascript-typescript`), and Dependabot security updates.
