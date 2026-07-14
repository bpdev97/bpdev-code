export function sortEnvironmentsByLabel<T extends { readonly label: string }>(
  environments: readonly T[],
): T[] {
  return [...environments].sort((left, right) => left.label.localeCompare(right.label));
}
