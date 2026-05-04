import { describe, expect, test } from "bun:test";
import { parseAttributesText } from "./attributes.ts";

describe("parseAttributesText", () => {
  test("returns an empty type and list for empty input", () => {
    expect(parseAttributesText(null)).toEqual({ attributes: [], punkType: "" });
    expect(parseAttributesText(undefined)).toEqual({ attributes: [], punkType: "" });
    expect(parseAttributesText("")).toEqual({ attributes: [], punkType: "" });
  });

  test("turns comma-separated text into type and attribute traits", () => {
    expect(parseAttributesText("Male,  Hoodie, Smile,,")).toEqual({
      punkType: "Male",
      attributes: [
        { trait_type: "Type", value: "Male" },
        { trait_type: "Attribute", value: "Hoodie" },
        { trait_type: "Attribute", value: "Smile" },
      ],
    });
  });
});
