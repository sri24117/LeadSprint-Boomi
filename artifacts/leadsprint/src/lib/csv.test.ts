import { describe, expect, it } from "vitest";
import { parseCsv, parseLeadCsv } from "./csv";

describe("parseCsv", () => {
  it("keeps commas that are inside quoted fields", () => {
    const rows = parseCsv('name,address\n"Williams, Ava","123 Main St, Apt 4"');
    expect(rows[1]).toEqual(["Williams, Ava", "123 Main St, Apt 4"]);
  });

  it("handles escaped quotes", () => {
    const rows = parseCsv('note\n"She said ""call me back"""');
    expect(rows[1]).toEqual(['She said "call me back"']);
  });

  it("handles newlines inside quoted fields", () => {
    const rows = parseCsv('name,note\nAva,"line one\nline two"');
    expect(rows).toHaveLength(2);
    expect(rows[1]?.[1]).toBe("line one\nline two");
  });

  it("handles CRLF line endings", () => {
    const rows = parseCsv("name,phone\r\nAva,+19175550184\r\n");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(["Ava", "+19175550184"]);
  });

  it("strips a UTF-8 BOM so the first header is usable", () => {
    const rows = parseCsv("\uFEFFname,phone\nAva,+19175550184");
    expect(rows[0]?.[0]).toBe("name");
  });

  it("ignores a trailing blank line", () => {
    expect(parseCsv("name\nAva\n")).toHaveLength(2);
  });
});

describe("parseLeadCsv", () => {
  it("maps rows by header name, not by position", () => {
    const result = parseLeadCsv("phone,name\n+19175550184,Ava Williams");
    expect(result.rows[0]).toEqual({ phone: "+19175550184", name: "Ava Williams" });
  });

  it("does not shift columns when a field contains a comma", () => {
    const result = parseLeadCsv(
      'name,location,phone\nAva Williams,"Brooklyn, NY",+19175550184',
    );
    // The naive split(',') importer produced phone: "NY" here — i.e. a
    // lead the system could never call.
    expect(result.rows[0]?.phone).toBe("+19175550184");
    expect(result.rows[0]?.location).toBe("Brooklyn, NY");
  });

  it("recognises common header spellings", () => {
    const result = parseLeadCsv("Full Name,Mobile Number,Budget Range\nAva,+19175550184,$900k");
    expect(result.rows[0]).toEqual({
      name: "Ava",
      phone: "+19175550184",
      budget_label: "$900k",
    });
  });

  it("drops rows with no phone number instead of importing an uncallable lead", () => {
    const result = parseLeadCsv("name,phone\nAva,+19175550184\nNoPhone,\n");
    expect(result.rows).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });

  it("explains what is wrong when the required columns are missing", () => {
    const result = parseLeadCsv("firstname,mobilephone\nAva,123");
    expect(result.error).toMatch(/needs "name" and "phone"/);
    expect(result.rows).toHaveLength(0);
  });

  it("reports an empty file rather than importing nothing silently", () => {
    expect(parseLeadCsv("").error).toBeTruthy();
  });
});
