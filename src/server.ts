import "dotenv/config";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openSecretHandoffStore } from "./secrets/handoff.js";

async function start(): Promise<void> {
  const config = loadConfig();
  const secretHandoffStore = await openSecretHandoffStore(config);
  const app = createApp(config, secretHandoffStore);
  const server = app.listen(config.port, config.host, () => {
    console.info(
      JSON.stringify({
        event: "server_started",
        service: "hoomi-mcp",
        host: config.host,
        port: config.port,
        mcp_path: config.mcpPath,
        auth_mode: config.authMode,
        secret_handoff_store: config.secretHandoffStore
      })
    );
  });

  const shutdown = (signal: string): void => {
    console.info(JSON.stringify({ event: "server_shutdown", signal }));
    server.close((error) => {
      void secretHandoffStore.close().finally(() => {
        if (error) {
          console.error(JSON.stringify({ event: "server_shutdown_error", error: error.name }));
          process.exitCode = 1;
          return;
        }

        process.exitCode = 0;
      });
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

void start().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: "server_start_error",
      error: error instanceof Error ? error.name : "UnknownError"
    })
  );
  process.exitCode = 1;
});
