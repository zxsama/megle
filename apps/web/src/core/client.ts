import { createCoreClient as createCorePackageClient } from "@megle/core-client";

export { CoreApiError } from "@megle/core-client";
export type { CoreClientConfig } from "@megle/core-client";

export interface MegleDesktopBridge {
  coreUrl?: string;
  sessionToken?: string;
}

declare global {
  interface Window {
    megleDesktop?: MegleDesktopBridge;
  }
}

export function getCoreClientConfig() {
  return {
    baseUrl:
      window.megleDesktop?.coreUrl ??
      import.meta.env.VITE_MEGLE_CORE_URL ??
      "http://127.0.0.1:47321/api",
    sessionToken: window.megleDesktop?.sessionToken
  };
}

export function createCoreClient(config = getCoreClientConfig()) {
  return createCorePackageClient(config);
}
