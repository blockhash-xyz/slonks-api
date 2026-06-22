export type TraitFilter = { traitType: string; value: string };

export function parseTraitFiltersFromUrl(url: string): TraitFilter[] | string {
  return parseTraitFilters(new URL(url).searchParams);
}

export function parseTraitFilters(params: URLSearchParams): TraitFilter[] | string {
  const filters: TraitFilter[] = [];

  for (const raw of params.getAll("trait")) {
    const parsed = parseTraitFilter(raw);
    if (typeof parsed === "string") return parsed;
    filters.push(parsed);
  }

  const traitType = params.get("traitType")?.trim();
  const traitValue = params.get("traitValue")?.trim();
  if (traitType || traitValue) {
    if (!traitType || !traitValue) return "traitType and traitValue must be provided together";
    filters.push({ traitType, value: traitValue });
  }

  return filters;
}

function parseTraitFilter(raw: string): TraitFilter | string {
  const separator = raw.includes("=") ? "=" : raw.includes(":") ? ":" : null;
  if (!separator) return "trait must be formatted as trait:value or trait=value";
  const index = raw.indexOf(separator);
  const traitType = raw.slice(0, index).trim();
  const value = raw.slice(index + 1).trim();
  if (!traitType || !value) return "trait must include both trait type and value";
  return { traitType, value };
}
