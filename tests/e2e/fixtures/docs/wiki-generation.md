# Wiki Page Generation

After Graphify extracts a knowledge graph, the wiki generator creates structured wiki pages.

## Generation Process

1. **Community Selection**: Each community with ≥3 nodes becomes a wiki page candidate
2. **Content Assembly**: Primary entity description becomes the page summary; related entities form subsections
3. **Internal Linking**: References between entities within the same space become wiki internal links
4. **Status Assignment**: Generated pages default to `status='published'` (configurable per run)
5. **Idempotency**: Re-running on the same source documents updates existing pages rather than creating duplicates

## Page Structure

Each generated wiki page contains:
- **Title**: Derived from the community's primary entity label
- **Summary**: 2-3 paragraph description synthesized from entity descriptions
- **Key Concepts**: Bullet list of related entities with brief descriptions
- **Relationships**: How this topic connects to other wiki pages
- **Sources**: References to original uploaded documents

## Page States

| Status | Meaning | Visible in search? |
|--------|---------|-------------------|
| published | Live and indexed | Yes |
| draft | Work in progress | No |
| archived | Soft-deleted | No |

Only `published` pages appear in chat retrieval results. Draft pages are excluded to prevent incomplete content from polluting answers.

## Docmost Integration

Wiki pages can be synced to Docmost for collaborative editing:
- Bridge API pushes page content to Docmost workspace
- Edits in Docmost sync back via webhook events
- Conflict resolution: last-write-wins with version tracking
