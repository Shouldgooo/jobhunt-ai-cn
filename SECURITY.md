# Security Policy

## Scope

jobhunt-ai is a local-only single-user tool. There is no authentication, no multi-tenancy, and no public deployment path. The intended threat model is:

- **In scope:** vulnerabilities that could affect users who run the tool locally (e.g. path traversal in file-reading endpoints, prompt injection that exfiltrates data from the LLM, insecure deserialization of DB records).
- **Out of scope:** issues that only apply to misconfigured public deployments — the README explicitly warns against deploying this to a public server.

## Supported Versions

Only the latest commit on `main` is supported. There are no versioned releases with security backports.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Use [GitHub Private Vulnerability Reporting](https://github.com/tristachou/jobhunt-ai/security/advisories/new) instead. This keeps the details confidential until a fix is available.

Include in your report:
- A description of the vulnerability and its impact
- Steps to reproduce (or a proof-of-concept)
- Any suggested fix, if you have one

You can expect an acknowledgement within a few days. Because this is a solo-maintainer project, response and fix timelines may vary.
