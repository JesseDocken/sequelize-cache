# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in `sequelize-model-cache`, **DO NOT OPEN A PUBLIC ISSUE.** Instead, report it privately through GitHub's security advisory feature:

1. Navigate to the [Security Advisories](https://github.com/JesseDocken/sequelize-model-cache/security/advisories) page for this repository.
2. Click **"Report a vulnerability"**.
3. Provide as much detail as possible, including steps to reproduce, the potential impact, and any suggested fixes.

You should receive an initial response within 72 hours acknowledging receipt of the report. From there, we will work with you to understand the issue, determine a fix, and coordinate disclosure.

## Scope

This library interacts with external caching datastores (Redis) and application databases (via Sequelize). Vulnerabilities of particular concern include, but are not limited to:

- Cache poisoning or injection via crafted model data or key manipulation
- Unintended data exposure through cache key collisions or namespace leaks
- Denial of service through cache operations (e.g., unbounded key iteration)
- Deserialization vulnerabilities in cached values

Not in scope are issues such as:

- Issues related to an application that uses the library but unrelated to the caching layer
- Issues caused by misconfiguration of external servers (i.e., Redis or the database)
- Information disclosure due to the misuse of the cache on an otherwise secure codepath

## Supported Versions

Security fixes will be applied to the latest released major version. Previous major versions will only receive backported patches for severe vulnerabilities that are applicable.

## Disclosure

We follow coordinated disclosure. Once a fix is available and published, the advisory will be made public with full credit given to the reporter (unless anonymity is requested).
