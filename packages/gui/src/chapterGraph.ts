/**
 * v4.6：从内联世界源码里抽取章节图。
 * 只做轻量正则，不重新编译；足够描述 examples 里的章/下一章/上一章关系。
 */
export interface ChapterGraphNode {
  file: string;
  name: string;
  title: string;
  next: string[];
  prev: string[];
}

export function buildChapterGraph(worlds: Record<string, string>): ChapterGraphNode[] {
  const files = Object.keys(worlds).sort();
  const nodes: ChapterGraphNode[] = [];
  for (const file of files) {
    const text = worlds[file] ?? '';
    const name = /^\s*世界\s+(\S+)/m.exec(text)?.[1] ?? file;
    const title = /^\s*章节\s+"([^"]*)"/m.exec(text)?.[1] ?? '';
    const next = [...text.matchAll(/^\s*下一章\s+"([^"]+)"/gm)]
      .map((match) => match[1] ?? '')
      .filter(Boolean);
    const prev = [...text.matchAll(/^\s*上一章\s+"([^"]+)"/gm)]
      .map((match) => match[1] ?? '')
      .filter(Boolean);
    nodes.push({ file, name, title, next, prev });
  }
  const known = new Set(nodes.map((node) => node.file));
  for (const node of nodes) {
    node.next = [...new Set(node.next.filter((file) => known.has(file)))];
    node.prev = [...new Set(node.prev.filter((file) => known.has(file)))];
  }
  return nodes;
}
