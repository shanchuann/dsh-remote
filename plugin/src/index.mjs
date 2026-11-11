/**
 * Cordis plugin entry for dsh-remote: LAN HTTP + SSE access to this DeepSeek
 * Harness instance for the paired mobile app.
 *
 * The plugin is loaded by absolute file URL from the profile patch layer, so it
 * imports only relative modules (node: builtins internally, plus the vendored
 * QR encoder). No bare specifier may appear on this path.
 */
import { DshBridge } from "./dsh/bridge.mjs";
import { createRemoteRuntime } from "./net/app.mjs";

/** Cordis plugin id, used by the patch layer. */
export const name = "dsh-remote";

/** The bridge needs the session controller; waiting for it keeps activation ordered. */
export const inject = ["sessionController"];

/**
 * @param {import("@deepseek-ai/cordis").Context} ctx
 * @param {{port?: number, host?: string, pairingTtlMs?: number, deviceTtlDays?: number,
 *   logLevel?: "debug"|"info"|"warn"|"error"|"silent", dshHome?: string, dataDir?: string}} config
 */
export function apply(ctx, config) {
  ctx.effect(() => {
    let runtime = null;
    let disposed = false;

    const ready = (async () => {
      runtime = await createRemoteRuntime({ ctx, rawConfig: config });
      const bridge = new DshBridge(ctx, {
        logger: runtime.logger,
        handlers: runtime.bridgeHandlers(),
        // Bridge gates approvals on this: with no phone listening the desktop
        // answerer handles it immediately instead of waiting out the timeout.
        hasMobileClients: () => runtime.mobileClientCount() > 0
      });
      runtime.attachBridge(bridge);
      await bridge.init();
      if (disposed) return;
      await runtime.start();
    })().catch((error) => {
      runtime?.logger?.error?.("dsh remote: failed to start: " + (error?.message ?? error));
    });

    return async () => {
      disposed = true;
      await ready;
      if (runtime !== null) await runtime.stop();
      ctx.logger?.info?.("dsh remote: stopped");
    };
  });
}
