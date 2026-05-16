import { createCoreClient as createCorePackageClient } from "@megle/core-client";
import { getDesktopBridge } from "./desktop";

export { CoreApiError } from "@megle/core-client";
export type { CoreClientConfig } from "@megle/core-client";

export function getCoreClientConfig() {
  const desktop = getDesktopBridge();

  return {
    baseUrl:
      desktop?.coreUrl ??
      import.meta.env.VITE_MEGLE_CORE_URL ??
      "http://127.0.0.1:47321/api",
    sessionToken: desktop?.sessionToken
  };
}

export function createCoreClient(config = getCoreClientConfig()) {
  return createCorePackageClient(config);
}
