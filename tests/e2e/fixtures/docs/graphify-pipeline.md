# Graphify Knowledge Extraction Pipeline

Graphify converts parsed documents into a knowledge graph of entities and relationships.

## Pipeline Stages

1. **Document Intake**: Reads `parsed.md` from archive bucket
2. **Entity Extraction**: Claude Code identifies named entities (concepts, components, people, technologies)
3. **Relationship Mapping**: Extracts semantic relationships between entities (uses, depends_on, contains, etc.)
4. **Community Detection**: Groups related entities into communities using Louvain algorithm
5. **Graph Persistence**: Writes `graph_nodes` and `graph_edges` to PostgreSQL
6. **Wiki Generation**: Creates wiki pages from entity clusters, one page per community or major entity

## Output Format

### graph.json
```json
{
  "nodes": [{"id": "string", "label": "string", "type": "concept|mechanism|module", "community": "string"}],
  "edges": [{"source": "string", "target": "string", "relationship": "string", "weight": 0.0}]
}
```

### Wiki Pages
Each generated wiki page includes:
- Title derived from the primary entity label
- Summary paragraph from entity description
- Related entities section with internal links
- Source references pointing back to original documents

## Performance

- Typical processing: 2-5 minutes per document batch
- Graph size: 50-200 nodes per document depending on complexity
- Community detection threshold: min 3 nodes per community
