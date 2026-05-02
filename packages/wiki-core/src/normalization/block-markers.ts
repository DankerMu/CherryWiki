export interface BlockMarker {
  blockId: string;
  owner: 'graphify' | 'human';
  runId: string;
}

interface HeadingBlock {
  blockId: string;
  start: number;
  end: number;
  content: string;
}

const h2Pattern = /^##(?!#)[ \t]+(.+?)\s*#*\s*$/gm;

export function injectBlockMarkers(content: string, runId: string): string {
  const blocks = extractH2Blocks(content);
  if (blocks.length === 0) {
    return content;
  }

  let result = content.slice(0, blocks[0]?.start ?? 0);

  for (const block of blocks) {
    result += wrapGraphifyBlock(block.content, block.blockId, runId);
  }

  return result;
}

export function parseBlockMarkers(content: string): BlockMarker[] {
  const markers: BlockMarker[] = [];
  const pattern =
    /<!--\s*(?:(graphify):(managed|human)|(human):curated):start\s+id="([^"]+)"(?:\s+run="([^"]*)")?\s*-->/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    markers.push({
      blockId: match[4] ?? '',
      owner: match[2] === 'managed' ? 'graphify' : 'human',
      runId: match[5] ?? '',
    });
  }

  return markers;
}

export function blockIdFromHeading(heading: string, fallbackIndex = 0): string {
  return slugifyHeading(heading) || `section-${fallbackIndex}`;
}

export function wrapGraphifyBlock(content: string, blockId: string, runId: string): string {
  return `<!-- graphify:managed:start id="${escapeMarkerAttribute(blockId)}" run="${escapeMarkerAttribute(runId)}" -->\n${content.trimEnd()}\n<!-- graphify:managed:end -->\n`;
}

export function wrapHumanBlock(content: string, blockId: string, runId: string): string {
  return `<!-- graphify:human:start id="${escapeMarkerAttribute(blockId)}" run="${escapeMarkerAttribute(runId)}" -->\n${content.trimEnd()}\n<!-- graphify:human:end -->\n`;
}

export function extractMarkedBlocks(content: string): Map<string, string> {
  const blocks = new Map<string, string>();
  const pattern =
    /<!--\s*(?:(?:graphify):(managed|human)|(?:human):curated):start\s+id="([^"]+)"(?:\s+run="[^"]*")?\s*-->([\s\S]*?)<!--\s*(?:(?:graphify):(managed|human)|(?:human):curated):end\s*-->/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const blockId = match[2];
    const blockContent = match[3];
    if (blockId && blockContent !== undefined) {
      blocks.set(blockId, blockContent.trim());
    }
  }

  return blocks;
}

export function extractH2Blocks(content: string): HeadingBlock[] {
  const matches = Array.from(content.matchAll(h2Pattern));
  const seenSlugs = new Set<string>();

  return matches.map((match, index) => {
    const heading = (match[1] ?? '').trim().replace(/\s+#*$/, '');
    const nextMatch = matches[index + 1];
    const start = match.index ?? 0;
    const end = nextMatch?.index ?? content.length;
    const baseBlockId = blockIdFromHeading(heading, index);
    let blockId = baseBlockId;
    let suffix = 2;

    while (seenSlugs.has(blockId)) {
      blockId = `${baseBlockId}-${suffix}`;
      suffix += 1;
    }
    seenSlugs.add(blockId);

    return {
      blockId,
      start,
      end,
      content: content.slice(start, end).trimEnd(),
    };
  });
}

function slugifyHeading(heading: string): string {
  return heading
    .toLowerCase()
    .trim()
    .replace(/\p{P}+/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function escapeMarkerAttribute(value: string): string {
  return value.replace(/"/g, '&quot;');
}
