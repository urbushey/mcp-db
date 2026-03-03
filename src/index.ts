import { loadConfig } from "./config.ts";
import { startServer } from "./server.ts";

const config = loadConfig();
await startServer(config);
