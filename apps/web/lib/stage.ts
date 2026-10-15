/**
 * stageLabel turns the API's build stage into the label the interface shows. The stage
 * is part of the contract (`demo | mvp | production`); an unknown value is shown as it
 * arrives instead of being mapped onto a known one, so a new stage can never be
 * mistaken for a familiar one.
 */
export function stageLabel(stage: string): string {
  switch (stage) {
    case 'demo':
      return 'Demo build';
    case 'mvp':
      return 'MVP V1';
    case 'production':
      return 'Production';
    default:
      return stage;
  }
}
