## What and why

<!-- One short paragraph: what changes, and why. Link the playbook decision or ADR when relevant. -->

## Checklist

- [ ] `make quality-check` passes locally (state any check you could not run)
- [ ] Contract changes: `apps/api/openapi/openapi.yaml` updated and `make contract-generate` run
- [ ] Tests added or updated for behaviour changes
- [ ] Docs updated when behaviour, configuration or commands changed
- [ ] Screens/features keep an honest `live` / `mock` / `concept` label (ADR 0002)
- [ ] No secrets, tokens or personal data in the diff
- [ ] New dependencies are permissively licensed (no copyleft)

## Evidence

<!-- Commands run and their outcome; screenshots for UI changes. -->
