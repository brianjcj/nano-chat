export type AppEnv = {
  apiBaseUrl: string;
  wsUrl: string;
};

type MetaEnv = Record<string, string | undefined>;

type LocationLike = Pick<Location, "protocol" | "host">;

export function getAppEnv(
  metaEnv: MetaEnv = import.meta.env,
  locationLike: LocationLike = getCurrentLocation(),
): AppEnv {
  const apiBaseUrl = readEnvOverride(metaEnv, "VITE_API_BASE_URL") ?? "/api/v1";
  const wsUrl = readEnvOverride(metaEnv, "VITE_WS_URL") ?? buildDefaultWsUrl(locationLike);

  return { apiBaseUrl, wsUrl };
}

function buildDefaultWsUrl(locationLike: LocationLike) {
  const protocol = locationLike.protocol === "https:" ? "wss:" : "ws:";

  return `${protocol}//${locationLike.host}/ws?version=1`;
}

function readEnvOverride(metaEnv: MetaEnv, key: keyof MetaEnv) {
  const value = metaEnv[key]?.trim();

  return value ? value : undefined;
}

function getCurrentLocation(): LocationLike {
  if (typeof location === "undefined") {
    return { protocol: "http:", host: "localhost" };
  }

  return location;
}
