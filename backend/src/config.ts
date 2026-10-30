import * as path from 'path';

/** Everything the API reads from the environment, in one place. */
export interface Config {
  /** Bearer token for /api/admin/*. When unset, admin access depends on `openAdmin`. */
  adminToken?: string;
  /** Allow admin calls without a token. Only the local dev server turns this on. */
  openAdmin: boolean;
  /** Browser origins allowed to call the API ('*' for any). */
  corsOrigins: string[];
  /** Where FileStorage keeps its documents. */
  dataDir: string;
  /** Contact sent to api.helldivers2.dev in X-Super-Contact, as its maintainers ask. */
  contact: string;
}

export const REPO_ROOT = path.resolve(__dirname, '..', '..');

const LOCAL_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:4173', 'http://127.0.0.1:4173'];

export function loadConfig(env: NodeJS.ProcessEnv = process.env, defaults: Partial<Config> = {}): Config {
  const list = (v?: string) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);
  return {
    adminToken: env.HD2E_ADMIN_TOKEN || defaults.adminToken,
    openAdmin: defaults.openAdmin ?? false,
    corsOrigins: list(env.HD2E_CORS_ORIGINS) ?? defaults.corsOrigins ?? LOCAL_ORIGINS,
    dataDir: env.HD2E_DATA_DIR || defaults.dataDir || path.join(REPO_ROOT, 'data', 'server'),
    contact: env.HD2E_CONTACT || defaults.contact || 'helldivers2endgame@gmail.com',
  };
}
