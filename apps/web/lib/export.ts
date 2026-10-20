/**
 * How many records one CSV download may contain. It mirrors `service.MaxExportRows` in the
 * Go API: the screen hides the download when the list is larger, and the API refuses it
 * anyway, so the two numbers must stay equal.
 */
export const MAX_EXPORT_ROWS = 10_000;
