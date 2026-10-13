# Contributing

OPVARYN is proprietary software (see [LICENSE.md](LICENSE.md)). External contributions are **not**
accepted: unsolicited pull requests are closed without review, and submitting one grants no
license, copyright or commercial right.

## Who may commit

Only the repository owner and people explicitly authorised in writing. If you are unsure whether
that includes you, it does not — ask first.

## Reporting bugs and requesting features

- Use the issue templates in `.github/ISSUE_TEMPLATE/`. Include a reproduction: steps, expected
  and actual behaviour, commit SHA, environment.
- Security problems must never be reported publicly — follow [SECURITY.md](SECURITY.md).

## Local development (authorised contributors)

```bash
mise install                 # pinned go/node/pnpm + Go tools + actionlint
pnpm install                 # workspace dependencies
cp .env.example .env         # optional: code ships matching defaults
make docker-up               # PostgreSQL 18 on localhost:21532
cd apps/api && go run ./cmd/migrate && cd ../..
make dev                     # API :21501 + web :21500
```

## Before opening a pull request (authorised contributors)

- `make quality-check` must pass — it is the same gate CI runs (`make smoke-api` additionally
  exercises the API against PostgreSQL and runs in CI's integration job).
- Behaviour changes keep the OpenAPI document, the generated contract types and the docs in sync
  (`make contract-generate`).
- Add or update tests for behaviour changes.
- One change per pull request; keep unrelated refactoring out.
- Every screen or feature keeps an honest `live` / `mock` / `concept` label (ADR 0002).
- New dependencies must be permissively licensed (MIT, BSD, Apache-2.0, ISC). Copyleft
  (GPL, LGPL, AGPL, SSPL) and source-available licences are not accepted — this is a proprietary
  product and cannot absorb them. The dependency-review workflow enforces this on pull requests.
- Never weaken the quality gate, the security controls or the CI configuration to make a change
  pass. If a gate is wrong, fix the gate deliberately in its own change with a reason.
- No secrets, tokens or personal data in the diff.

## Commit and pull request conventions

- Imperative commit subjects, Vietnamese or English both fine ("Add business object list
  endpoint"); explain *why* in the body when it is not obvious.
- Reference the playbook decision or the ADR when a change implements — or deliberately deviates
  from — one.
- Pull requests use the repository template; fill in the checklist truthfully and state any check
  you could not run.
