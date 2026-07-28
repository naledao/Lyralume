export function shouldUsePackagedResources(
  appIsPackaged: boolean,
  devServerUrl: string | undefined = process.env.VITE_DEV_SERVER_URL,
): boolean {
  return appIsPackaged && !devServerUrl;
}
