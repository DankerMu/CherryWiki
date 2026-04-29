export type RequestContext = {
  request_id: string;
  tenant_id: string;
  user_id: string | null;
  space_id: string | null;
};
