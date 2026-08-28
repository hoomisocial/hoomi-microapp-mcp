import "dotenv/config";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openSecretHandoffStore } from "./secrets/handoff.js";
import { openWriteApprovalStore, type WriteApprovalStore } from "./secrets/write-approval.js";

async function start(): Promise<void> {
  const config = loadConfig();
  const secretHandoffStore = await openSecretHandoffStore(config);
  let openedWriteApprovalStore: WriteApprovalStore | undefined;

  try {
    const writeApprovalStore: WriteApprovalStore = await openWriteApprovalStore(config);
    openedWriteApprovalStore = writeApprovalStore;
    const app = createApp(config, secretHandoffStore, writeApprovalStore);
    const server = app.listen(config.port, config.host, () => {
      console.info(
        JSON.stringify({
          event: "server_started",
          service: "hoomi-mcp",
          host: config.host,
          port: config.port,
          mcp_path: config.mcpPath,
          auth_mode: config.authMode,
          secret_handoff_store: config.secretHandoffStore,
          write_approval_store: config.secretHandoffStore
        })
      );
    });

    let shuttingDown = false;
    const shutdown = (signal: string): void => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.info(JSON.stringify({ event: "server_shutdown", signal }));
      server.close((error) => {
        void Promise.allSettled([secretHandoffStore.close(), writeApprovalStore.close()]).then((results) => {
          const storeFailure = results.find((result) => result.status === "rejected");
          if (error || storeFailure) {
            console.error(
              JSON.stringify({
                event: "server_shutdown_error",
                error: error?.name ?? "StoreCloseError"
              })
            );
            process.exitCode = 1;
            return;
          }

          process.exitCode = 0;
        });
      });
    };

    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    await Promise.allSettled([secretHandoffStore.close(), openedWriteApprovalStore?.close()]);
    throw error;
  }
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
