export function safeFilename(label: string): string {
  return label.replace(/\//g, '-').replace(/ /g, '_').replace(/:/g, '-');
}

export function uniqueSlug(slug: string, existingSlugs: Set<string>): string {
  if (!existingSlugs.has(slug)) {
    return slug;
  }

  let index = 2;
  while (existingSlugs.has(`${slug}_${index}`)) {
    index += 1;
  }

  return `${slug}_${index}`;
}
