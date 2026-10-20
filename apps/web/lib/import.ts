/**
 * Mirrors `service.MaxImportRows` / `MaxImportBytes` in the Go API. The browser check gives a
 * fast answer; the API refuses a larger file anyway.
 */
export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** One row the import refused; `row` is the spreadsheet line (the header is line 1). */
export interface ImportRowError {
  row: number;
  message: string;
}

/** What the API answers for a dry run or a real import. */
export interface RecordImportResult {
  dryRun: boolean;
  rows: number;
  valid: number;
  created: number;
  errors: ImportRowError[];
}
