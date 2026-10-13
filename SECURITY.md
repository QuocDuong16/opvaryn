# Security Policy

OPVARYN is proprietary software in active development (interactive demo stage). Security
reports are taken seriously and are appreciated.

## Supported versions

Only the latest commit on the default branch (`main`) is supported. There are no released
versions yet, and pre-release demo builds are not patched individually.

## Reporting a vulnerability

**Do not open a public issue, pull request or discussion for a security problem.**

Use GitHub's private vulnerability reporting:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability** (Security advisories → Report a vulnerability).
3. Describe the problem with enough detail to reproduce it: affected component or path, commit
   SHA, impact, and a minimal proof of concept if it is safe to share.

If you cannot use GitHub advisories, open a public issue that contains no technical detail and
only asks for a private channel; a maintainer will follow up.

## What to expect

| Stage | Target |
| --- | --- |
| Acknowledge the report | within 5 working days |
| Initial assessment (severity, affected scope) | within 10 working days |
| Fix or mitigation plan for confirmed issues | communicated together with the assessment |

Please allow reasonable time for a fix before public disclosure. Disclosure timing is coordinated
with you, and we credit reporters who wish to be credited.

## Scope

In scope: everything in this repository — the Go API (`apps/api`), the Next.js web app
(`apps/web`), the contract package (`packages/contracts`), the CI workflows and the local Compose
setup.

Out of scope: findings that require a compromised developer machine or GitHub account; missing
security headers without demonstrated impact; scanner output without a working proof of concept;
social engineering; volumetric denial of service; and issues in third-party dependencies that are
already fixed upstream (report those upstream, or tell us if our pin has not been updated yet).

## Safe harbour

We will not pursue legal action against researchers acting in good faith who test only against
their own local deployment of this repository, avoid privacy violations and data destruction, and
report findings through the channel above. The repository's public visibility does not authorise
probing any deployed instance you do not own or operate.

## Supply chain notes

- No production environment is publicly hosted yet; local ports are isolated (21xxx range).
- Secrets never live in the repository: `.env` is ignored and `.env.example` contains placeholders
  only. CI uses GitHub-provided ephemeral credentials.
- Local toolchain and container images are pinned (`mise.lock`, image digests); CI actions are
  pinned by commit SHA.
