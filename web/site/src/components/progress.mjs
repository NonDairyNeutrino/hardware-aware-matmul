// A short "where am I" label: the page's place in the reading order.
export function progressLabel(chapters, index) {
  return `Page ${index + 1} of ${chapters.length}`;
}
