export function generateSlug(label: string, existingSlugs: readonly string[] = []): string {
  const baseSlug = label.replace(/\//g, '-').replace(/ /g, '_').replace(/:/g, '-');
  const taken = new Set(existingSlugs);

  if (!taken.has(baseSlug)) {
    return baseSlug;
  }

  let index = 2;
  let slug = `${baseSlug}_${index}`;
  while (taken.has(slug)) {
    index += 1;
    slug = `${baseSlug}_${index}`;
  }

  return slug;
}
