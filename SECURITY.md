# Security Policy

## Supported versions

This repository currently supports the latest `main` branch.

## Reporting a vulnerability

Please do not open a public issue for security problems.

Instead, report privately with:

- a clear description of the issue
- reproduction steps or a proof of concept
- impact details
- any suggested remediation

If the issue involves secrets:

1. Revoke or rotate the affected key immediately.
2. Remove the secret from local files.
3. Confirm the secret was never committed.

## Secret-handling rules

- Never commit `.env` files or API keys.
- Keep `OPENAI_API_KEY` and `GITHUB_TOKEN` only in deployment environment variables.
- Use `server/.env.example` for placeholders only.
- Treat uploaded code and GitHub content as sensitive review input.

## Hardening checklist

- Keep dependencies updated.
- Review pull requests before merging to `main`.
- Enable branch protection on GitHub for public production branches.
- Rotate credentials if there is any doubt that a token was exposed.
