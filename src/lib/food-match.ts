/** Strip portion suffix like " (40g)" or " (1 teaspoon · ~5g)" from a logged label. */
export function productNameFromLabel(label: string): string {
  const trimmed = label.trim();
  const portionSuffix =
    /^(.+)\s+\((?:\d+(?:\.\d+)?g|.+ · ~\d+(?:\.\d+)?g)\)$/i.exec(trimmed);
  if (portionSuffix) return portionSuffix[1].trim();

  const open = trimmed.lastIndexOf(" (");
  if (open > 0 && trimmed.endsWith(")")) {
    return trimmed.slice(0, open).trim();
  }
  return trimmed;
}

export function normalizeFoodName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function bigrams(text: string): string[] {
  if (text.length < 2) return text ? [text] : [];
  const grams: string[] = [];
  for (let i = 0; i < text.length - 1; i += 1) {
    grams.push(text.slice(i, i + 2));
  }
  return grams;
}

/**
 * Dice coefficient on character bigrams of normalized names.
 * 1 = identical, 0 = no overlap.
 */
export function nameSimilarity(a: string, b: string): number {
  const left = normalizeFoodName(a);
  const right = normalizeFoodName(b);
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  if (left === right) return 1;

  const aGrams = bigrams(left);
  const bGrams = bigrams(right);
  if (aGrams.length === 0 || bGrams.length === 0) {
    return left === right ? 1 : 0;
  }

  const counts = new Map<string, number>();
  for (const g of aGrams) {
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }

  let overlap = 0;
  for (const g of bGrams) {
    const n = counts.get(g) ?? 0;
    if (n > 0) {
      overlap += 1;
      counts.set(g, n - 1);
    }
  }

  return (2 * overlap) / (aGrams.length + bGrams.length);
}

export const NAME_DEDUP_THRESHOLD = 0.8;

export type NamedEntry = {
  id: string;
  createdAt: string;
  label: string;
};

/**
 * Keep newest-first unique products: if a name is ≥80% similar to one already
 * kept, drop the older duplicate.
 */
export function dedupeBySimilarName<T extends NamedEntry>(
  entries: T[],
  threshold = NAME_DEDUP_THRESHOLD,
): T[] {
  const sorted = [...entries].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const kept: T[] = [];

  for (const entry of sorted) {
    const name = productNameFromLabel(entry.label);
    const isDup = kept.some(
      (other) =>
        nameSimilarity(name, productNameFromLabel(other.label)) >= threshold,
    );
    if (!isDup) kept.push(entry);
  }

  return kept;
}

/** Filter entries whose product name matches the query (substring or fuzzy). */
export function filterByFoodQuery<T extends NamedEntry>(
  entries: T[],
  query: string,
  fuzzyThreshold = 0.45,
): T[] {
  const q = normalizeFoodName(query);
  if (!q) return entries;

  return entries.filter((entry) => {
    const name = normalizeFoodName(productNameFromLabel(entry.label));
    if (name.includes(q) || q.includes(name)) return true;
    return nameSimilarity(name, q) >= fuzzyThreshold;
  });
}
