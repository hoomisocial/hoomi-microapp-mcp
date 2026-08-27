import "dotenv/config";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = createApp(config);
const server = app.listen(config.port, config.host, () => {
  console.info(
    JSON.stringify({
      event: "server_started",
      service: "hoomi-mcp",
      host: config.host,
      port: config.port,
      mcp_path: config.mcpPath,
      auth_mode: config.authMode
    })
  );
});

function shutdown(signal: string): void {
  console.info(JSON.stringify({ event: "server_shutdown", signal }));
  server.close((error) => {
    if (error) {
      console.error(JSON.stringify({ event: "server_shutdown_error", error: error.name }));
      process.exitCode = 1;
      return;
    }

    process.exitCode = 0;
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
