import type { AclJson } from './types.js';

type PageAclInput = {
  tenant_id: string;
  space_id: string;
  page_id: string;
};

type VersionAclInput = {
  version_no: number;
};

type SpaceConfigInput = {
  classification?: string | null;
  default_classification?: string | null;
  graphify_config?: {
    classification?: string | null;
  } | null;
};

export type AclBuilderDeps = {
  getAllowedGroupIds(spaceId: string): Promise<string[]> | string[];
};

export async function buildAclJson(
  page: PageAclInput,
  version: VersionAclInput,
  spaceConfig: SpaceConfigInput | null | undefined,
  deps: AclBuilderDeps,
): Promise<AclJson> {
  return {
    tenant_id: page.tenant_id,
    space_id: page.space_id,
    allowed_group_ids: await deps.getAllowedGroupIds(page.space_id),
    classification: resolveClassification(spaceConfig),
    page_id: page.page_id,
    page_version: version.version_no,
  };
}

function resolveClassification(spaceConfig: SpaceConfigInput | null | undefined): string {
  const classification =
    spaceConfig?.classification ?? spaceConfig?.default_classification ?? spaceConfig?.graphify_config?.classification;

  if (typeof classification === 'string' && classification.trim().length > 0) {
    return classification;
  }

  return 'internal';
}
