import { describe, expect, test } from "bun:test";
import { parseTraitFilters, parseTraitFiltersFromUrl } from "./traitFilters.ts";

describe("trait filter parsing", () => {
  test("parses repeatable trait filters with colon or equals separators", () => {
    const params = new URLSearchParams([
      ["trait", "Type:Male"],
      ["trait", "Attribute=Hoodie"],
    ]);

    expect(parseTraitFilters(params)).toEqual([
      { traitType: "Type", value: "Male" },
      { traitType: "Attribute", value: "Hoodie" },
    ]);
  });

  test("parses traitType and traitValue together", () => {
    const params = new URLSearchParams([
      ["traitType", " Attribute "],
      ["traitValue", " Smile "],
    ]);

    expect(parseTraitFilters(params)).toEqual([{ traitType: "Attribute", value: "Smile" }]);
  });

  test("parses filters from request URLs", () => {
    expect(parseTraitFiltersFromUrl("https://api.slonks.xyz/tokens?trait=Type:Alien")).toEqual([
      { traitType: "Type", value: "Alien" },
    ]);
  });

  test("rejects incomplete trait params", () => {
    expect(parseTraitFilters(new URLSearchParams([["trait", "Hoodie"]]))).toBe(
      "trait must be formatted as trait:value or trait=value",
    );
    expect(parseTraitFilters(new URLSearchParams([["traitType", "Attribute"]]))).toBe(
      "traitType and traitValue must be provided together",
    );
  });
});
