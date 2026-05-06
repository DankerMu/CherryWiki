import { describe, it } from 'vitest';

describe.skip('P4-E5 manual backup/restore acceptance', () => {
  it('backs up, clears, restores, and verifies CherryWiki health and data integrity', () => {
    /*
     * Manual infrastructure required:
     * - PostgreSQL reachable through POSTGRES_*.
     * - MinIO reachable through MINIO_* and mc.
     * - CherryWiki API reachable through CHERRY_API_URL.
     * - GRAPHIFY_OUTPUT_PATH and WIKI_REPO_PATH point to real directories.
     *
     * Flow:
     * 1. Seed or confirm baseline data:
     *    - at least one user
     *    - at least one Space
     *    - at least one Wiki page
     *    - Graphify output containing nodes and edges
     *    - MinIO objects used by uploaded documents
     * 2. Run ./scripts/backup.sh and record the printed backup directory.
     * 3. Clear the running environment:
     *    - drop/recreate or truncate the PostgreSQL database
     *    - remove MinIO bucket contents
     *    - remove GRAPHIFY_OUTPUT_PATH
     *    - remove WIKI_REPO_PATH
     * 4. Run ./scripts/restore.sh <backup_dir>.
     * 5. Verify /api/admin/system/health returns healthy db, redis, and minio state.
     * 6. Verify data integrity:
     *    - user count matches baseline
     *    - Space count matches baseline
     *    - Wiki page count matches baseline
     *    - Graph node and edge counts match baseline
     *    - Chat/RAG flow can answer from restored content
     */
  });
});
