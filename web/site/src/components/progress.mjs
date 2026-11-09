// A short "where am I" label for a chapter: the level chapters say which level of the six they
// are (levels are numbered from 0, in the order they appear in `chapters`), every other
// chapter says its place in the reading order.
export function progressLabel(chapters, index) {
  const chapter = chapters[index];
  if (chapter.id.startsWith('levels/')) {
    const levels = chapters.filter((c) => c.id.startsWith('levels/'));
    const level = levels.findIndex((c) => c.id === chapter.id);
    return `Level ${level}, of levels 0 to ${levels.length - 1}`;
  }
  return `Page ${index + 1} of ${chapters.length}`;
}
