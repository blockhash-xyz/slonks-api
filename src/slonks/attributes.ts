// Mirrors SlonksRenderer._attributesJsonFromText. Comma-split, trim, first
// entry is "Type" (Male/Female/Zombie/Ape/Alien), the rest are "Attribute".

export type Attribute = { trait_type: string; value: string };

export function parseAttributesText(text: string | null | undefined): {
  attributes: Attribute[];
  punkType: string;
} {
  if (!text) return { attributes: [], punkType: "" };
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  const attributes: Attribute[] = parts.map((value, idx) => ({
    trait_type: idx === 0 ? "Type" : "Attribute",
    value,
  }));
  return { attributes, punkType: parts[0] ?? "" };
}
