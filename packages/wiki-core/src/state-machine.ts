export type WikiPageStatus = 'draft' | 'published' | 'archived';

export class PublishStateMachine {
  canPublish(currentStatus: string): boolean {
    return currentStatus === 'draft';
  }

  publish(currentStatus: string): WikiPageStatus {
    if (this.canPublish(currentStatus)) {
      return 'published';
    }

    if (currentStatus === 'published') {
      throw new Error('VERSION_ALREADY_PUBLISHED');
    }

    throw new Error('INVALID_PUBLISH_TRANSITION');
  }

  canUnpublish(currentStatus: string): boolean {
    return currentStatus === 'published';
  }

  unpublish(currentStatus: string): WikiPageStatus {
    if (this.canUnpublish(currentStatus)) {
      return 'draft';
    }

    if (currentStatus === 'draft') {
      throw new Error('VERSION_ALREADY_DRAFT');
    }

    throw new Error('INVALID_UNPUBLISH_TRANSITION');
  }

  canArchive(currentStatus: string): boolean {
    return currentStatus === 'published';
  }

  archive(currentStatus: string): WikiPageStatus {
    if (this.canArchive(currentStatus)) {
      return 'archived';
    }

    throw new Error('INVALID_ARCHIVE_TRANSITION');
  }

  rollback(
    targetVersionContent: string,
    currentMaxVersionNo: number,
  ): { content: string; versionNo: number; source: 'rollback'; status: 'published' } {
    return {
      content: targetVersionContent,
      versionNo: currentMaxVersionNo + 1,
      source: 'rollback',
      status: 'published',
    };
  }
}
