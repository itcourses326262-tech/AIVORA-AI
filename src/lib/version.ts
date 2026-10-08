import { version } from '../../package.json';

/** The `version` of package.json, inlined at build time (so it works in the standalone server). */
export const APP_VERSION: string = version;
