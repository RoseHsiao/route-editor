# Security policy

## Supported versions

RouteEditor has not been released yet. Security fixes are applied to the `main` branch.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
("Report a vulnerability" on the repository's Security tab). Include:

- a description of the issue and its impact
- steps to reproduce, or a proof of concept
- the affected commit or version

We aim to acknowledge reports within 5 working days and will keep you updated
until the issue is resolved. We are happy to credit reporters who want to be credited.

## Scope notes

The areas below handle sensitive data or untrusted input and are especially in scope:

- **Uploaded files** (GPX, GeoJSON, CSV): parsing, size limits, storage keys, and path handling.
- **User data**: personal routes, trek plans, booking details, and notes are private to their owner.
- **Authentication**: the development stub user (`AUTH_DEV_STUB`) is refused at startup in
  production. Any way to activate it in a deployed environment is a vulnerability.
- **SQL**: geometry queries use parameterized statements. Report any injection vector.
