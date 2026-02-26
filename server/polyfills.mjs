import { fileURLToPath } from "url";
import { dirname } from "path";

// Polyfill __dirname and __filename for ES modules
globalThis.__filename = fileURLToPath(import.meta.url);
globalThis.__dirname = dirname(globalThis.__filename);
