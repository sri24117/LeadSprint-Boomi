/**
 * RFC 4180 CSV parsing.
 *
 * The previous importer did `line.split(',')`, which silently corrupts any
 * real-world lead list: an address like "123 Main St, Apt 4" shifts every
 * subsequent column by one, so a phone number ends up in the email field
 * and LeadSprint calls the wrong number — or no number at all. Quoted
 * fields, escaped quotes and embedded newlines all have to be handled.
 */

export type CsvRow = Record<string, string>;

/** Splits raw CSV text into rows of raw cell values. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  // Strip a UTF-8 BOM; Excel writes one and it would otherwise become part
  // of the first header name.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // Skip entirely blank lines (trailing newline at end of file).
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"'; // escaped quote
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      endField();
      i += 1;
      continue;
    }
    if (char === "\r") {
      // Handles CRLF and a lone CR.
      if (input[i + 1] === "\n") i += 1;
      endRow();
      i += 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  if (field !== "" || row.length > 0) endRow();
  return rows;
}

const HEADER_ALIASES: Record<string, string> = {
  "full name": "name",
  "lead name": "name",
  "contact name": "name",
  "first name": "name",
  "phone number": "phone",
  mobile: "phone",
  "mobile number": "phone",
  telephone: "phone",
  tel: "phone",
  "email address": "email",
  "e-mail": "email",
  area: "location",
  city: "location",
  neighbourhood: "location",
  neighborhood: "location",
  budget: "budget_label",
  "budget range": "budget_label",
  "property type": "property_type",
  type: "property_type",
  "move timeline": "timeline",
  "when": "timeline",
};

function normalizeHeader(header: string): string {
  const key = header.trim().toLowerCase();
  return HEADER_ALIASES[key] ?? key.replace(/\s+/g, "_");
}

export interface CsvImportParse {
  rows: CsvRow[];
  /** Rows dropped because they had no name or no phone. */
  skipped: number;
  /** Headers we recognised, for showing the operator what was mapped. */
  headers: string[];
  error?: string;
}

/**
 * Parses a lead CSV into import rows. Rows missing a name or a phone are
 * dropped here rather than sent to the API, because a lead with no phone
 * number can never be called and would just sit in the pipeline forever.
 */
export function parseLeadCsv(text: string): CsvImportParse {
  const table = parseCsv(text);
  if (!table.length) return { rows: [], skipped: 0, headers: [], error: "That file is empty." };

  const headers = (table[0] ?? []).map(normalizeHeader);
  if (!headers.includes("name") || !headers.includes("phone")) {
    return {
      rows: [],
      skipped: 0,
      headers,
      error: `The file needs "name" and "phone" columns. Found: ${headers.join(", ") || "nothing"}.`,
    };
  }

  const rows: CsvRow[] = [];
  let skipped = 0;

  for (const cells of table.slice(1)) {
    const record: CsvRow = {};
    headers.forEach((header, index) => {
      const value = (cells[index] ?? "").trim();
      if (value) record[header] = value;
    });
    if (!record.name || !record.phone) {
      skipped += 1;
      continue;
    }
    rows.push(record);
  }

  return { rows, skipped, headers };
}
