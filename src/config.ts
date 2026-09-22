/**
 * Central configuration, read once from environment variables.
 * Every service decides whether it is enabled based on this object.
 */
export interface Config {
  httpTimeoutMs: number;
  hebcal: {
    defaultGeonameId: number;
  };
  greenInvoice: {
    apiId?: string;
    apiSecret?: string;
    env: "sandbox" | "production";
    allowWrite: boolean;
  };
}

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const giEnv = (env.GREENINVOICE_ENV ?? "sandbox").toLowerCase();
  if (giEnv !== "sandbox" && giEnv !== "production") {
    throw new Error(`GREENINVOICE_ENV must be "sandbox" or "production", got "${giEnv}"`);
  }

  return {
    httpTimeoutMs: int(env.HTTP_TIMEOUT_MS, 15_000),
    hebcal: {
      defaultGeonameId: int(env.HEBCAL_DEFAULT_GEONAMEID, 281184),
    },
    greenInvoice: {
      apiId: env.GREENINVOICE_API_ID || undefined,
      apiSecret: env.GREENINVOICE_API_SECRET || undefined,
      env: giEnv,
      allowWrite: env.GREENINVOICE_ALLOW_WRITE === "true",
    },
  };
}
