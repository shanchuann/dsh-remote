/**
 * Runtime wiring: config -> data files -> auth -> SSE hub -> service -> HTTP
 * listener. Kept separate from index.mjs so tests can drive the whole stack
 * with a FakeBridge and an ephemeral port.
 */
import { hostname } from "node:os";
import { resolve } from "node:path";
import { DeviceStore } from "../auth/devices.mjs";
import { PairingManager } from "../auth/pairing.mjs";
import { createPairingCode } from "../auth/tokens.mjs";
import { pairingEndpoints, pairingUri, writePairingArtifacts } from "../pairing/files.mjs";
import { renderPairingPage } from "../pairing/page.mjs";
import { qrSvg } from "../pairing/qr.mjs";
import { ensureDir } from "../state/atomic.mjs";
import {
  createLogger,
  normalizeConfig,
  PROTOCOL_VERSION,
  readPluginVersion
} from "../state/config.mjs";
import { loadHostState } from "../state/host.mjs";
import { PLUGIN_ROOT, pluginDataPaths, pluginDataPathsIn, resolveDshHome } from "../state/paths.mjs";
import { CloudflareTunnel } from "./cloudflare.mjs";
import { createRemoteServer } from "./server.mjs";
import { RemoteService } from "./service.mjs";
import { EventHub } from "./sse.mjs";

/** How often the pairing code is checked for expiry (it rotates itself). */
const PAIRING_REFRESH_MS = 15000;

/**
 * Build the runtime without binding a socket.
 * @param {{ctx?: object, rawConfig?: Record<string, unknown>, logger?: object,
 *   now?: () => number, interfaces?: object, bridge?: object}} [options]
 */
export async function createRemoteRuntime(options) {
  const settings = options ?? {};
  const config = normalizeConfig(settings.rawConfig);
  const logger = settings.logger ?? createLogger(settings.ctx?.logger, config.logLevel);
  const now = settings.now ?? Date.now;
  const interfaces = settings.interfaces;
  const paths = config.dataDir
    ? pluginDataPathsIn(resolve(config.dataDir))
    : pluginDataPaths(resolveDshHome(config.dshHome));

  await ensureDir(paths.dir);
  const hostState = await loadHostState(paths.host, { now, hostName: hostname(), logger });

  const devices = new DeviceStore({
    filePath: paths.devices,
    deviceTtlDays: config.deviceTtlDays,
    now,
    logger
  });
  await devices.load();

  const pluginVersion = (await readPluginVersion(PLUGIN_ROOT)) || "0.1.0";
  const state = {
    listening: false,
    port: config.port,
    bindAddress: config.host,
    artifacts: null,
    timer: null,
    refreshChain: Promise.resolve(),
    tunnel: null
  };
  let refreshArtifactsHook = null;

  const pairing = new PairingManager({
    ttlMs: config.pairingTtlMs,
    now,
    codeFactory: createPairingCode,
    onChange: () => {
      if (refreshArtifactsHook !== null) refreshArtifactsHook();
    }
  });
  pairing.rotate();

  const hub = new EventHub({
    now,
    logger,
    ...(Number.isFinite(settings.pingIntervalMs) ? { pingIntervalMs: settings.pingIntervalMs } : {})
  });
  const service = new RemoteService({
    config,
    devices,
    pairing,
    hub,
    hostState,
    pluginVersion,
    protocolVersion: PROTOCOL_VERSION,
    now,
    logger
  });

  /** Display name: the bridge knows the desktop host name; fall back to ours. */
  function hostDisplayName() {
    try {
      const descriptor = service.hostDescriptor();
      return descriptor.name || hostState.name;
    } catch {
      return hostState.name;
    }
  }

  function publicUrl() {
    return config.publicUrl ?? state.tunnel?.snapshot().publicUrl ?? null;
  }

  function tunnelSnapshot() {
    return state.tunnel === null ? null : state.tunnel.snapshot();
  }

  /** JSON the Settings page polls every few seconds. */
  function pairingState() {
    const snapshot = pairing.snapshot();
    const endpoints = pairingEndpoints(state.port, interfaces);
    const hostName = hostDisplayName();
    const pub = publicUrl();
    const uri = pairingUri({ baseUrl: endpoints.baseUrl, altUrl: pub ?? undefined, code: snapshot.code, hostId: hostState.hostId, hostName });
    return {
      protocol: PROTOCOL_VERSION,
      pluginVersion,
      hostId: hostState.hostId,
      hostName,
      port: state.port,
      pairing: { code: snapshot.code, expiresAt: snapshot.expiresAt },
      addresses: endpoints.addresses,
      publicUrl: pub,
      tunnel: tunnelSnapshot(),
      devices: devices.list().map((device) => ({
        deviceId: device.deviceId,
        name: device.name,
        platform: device.platform,
        createdAt: device.createdAt,
        lastSeenAt: device.lastSeenAt
      })),
      qrSvg: qrSvg(uri, { cellSize: 6, margin: 4, scalable: true }),
      serverTime: now()
    };
  }

  function renderPage() {
    const snapshot = pairing.snapshot();
    const endpoints = pairingEndpoints(state.port, interfaces);
    const hostName = hostDisplayName();
    const publicBase = publicUrl();
    const uri = pairingUri({
      baseUrl: endpoints.baseUrl,
      altUrl: publicBase ?? undefined,
      code: snapshot.code,
      hostId: hostState.hostId,
      hostName
    });
    return renderPairingPage({
      hostName,
      hostId: hostState.hostId,
      port: state.port,
      protocol: PROTOCOL_VERSION,
      pluginVersion,
      pairing: snapshot,
      qrSvg: qrSvg(uri, { cellSize: 6, margin: 4, scalable: true }),
      addresses: endpoints.addresses,
      publicUrl: publicBase,
      tunnel: tunnelSnapshot(),
      devices: devices.list(),
      now: now()
    });
  }

  const http = createRemoteServer({
    service,
    devices,
    pairing,
    hub,
    config,
    protocolVersion: PROTOCOL_VERSION,
    pluginVersion,
    renderPairingPage: () => renderPage(),
    attachmentsRoot: resolve(resolveDshHome(config.dshHome), "attachments", "v1", "objects"),
    logger,
    now,
    rateLimit: settings.rateLimit,
    pairRateLimit: settings.pairRateLimit
  });

  const runtime = {
    config,
    logger,
    paths,
    hostState,
    devices,
    pairing,
    hub,
    service,
    http,
    pluginVersion,
    protocolVersion: PROTOCOL_VERSION,
    /** @returns {object|null} */
    get bridge() {
      return service.bridge;
    },
    /** Hand this to DshBridge's options.handlers before init(). */
    bridgeHandlers() {
      return service.bridgeHandlers();
    },
    attachBridge(bridge) {
      service.attachBridge(bridge);
    },
    get listening() {
      return state.listening;
    },
    get port() {
      return state.port;
    },
    get bindAddress() {
      return state.bindAddress;
    },
    get pairingArtifacts() {
      return state.artifacts;
    },
    /** Same data the Settings page renders (also unit-testable). */
    pairingState() {
      return pairingState();
    },
    /** External root the phone can reach, if a tunnel/public URL is active. */
    get publicUrl() {
      return publicUrl();
    },
    /** Cloudflare tunnel facts (null when not configured). */
    get tunnelStatus() {
      return tunnelSnapshot();
    },

    /** Number of paired phones currently holding an SSE connection. */
    mobileClientCount() {
      return hub.deviceCount();
    },

    /** Bind the LAN listener, write pairing artifacts, and start timers. */
    async start() {
      if (state.listening) return runtime;
      let address;
      try {
        address = await http.listen();
      } catch (error) {
        if (error?.code === "EADDRINUSE") {
          logger.error(
            "dsh remote: port " + config.port + " is already in use; change config.port in the cordis patch " +
            "(0 picks a random free port) or stop the process holding it"
          );
        } else {
          logger.error("dsh remote: cannot listen on " + config.host + ":" + config.port + ": " + (error?.message ?? error));
        }
        throw error;
      }
      state.listening = true;
      if (address !== null && typeof address === "object") {
        state.port = typeof address.port === "number" ? address.port : config.port;
        state.bindAddress = address.address ?? config.host;
      }
      hub.start();
      refreshArtifactsHook = () => {
        // Serialize rewrites: pairing.json/txt/png are four files on disk and a
        // rotation burst must not interleave them.
        state.refreshChain = state.refreshChain.then(() => runtime.refreshPairingArtifacts()).catch((error) => {
          logger.warn("dsh remote: could not refresh pairing artifacts: " + error.message);
        });
      };
      await runtime.refreshPairingArtifacts().catch((error) => {
        logger.warn("dsh remote: could not write pairing artifacts: " + error.message);
      });
      state.timer = setInterval(() => {
        try {
          pairing.ensureFresh();
        } catch (error) {
          logger.warn("dsh remote: pairing refresh failed: " + error.message);
        }
      }, PAIRING_REFRESH_MS);
      state.timer.unref?.();
      if (config.cloudflare !== null) {
        state.tunnel = new CloudflareTunnel({
          config: config.cloudflare,
          port: state.port,
          logger,
          onUrlChange: () => {
            if (refreshArtifactsHook !== null) refreshArtifactsHook();
          }
        });
        await state.tunnel.start();
      }
      const endpoints = pairingEndpoints(state.port, interfaces);
      const displayUrl = endpoints.addresses[0]?.url ?? "http://127.0.0.1:" + state.port;
      logger.info("dsh remote: " + displayUrl + " (pair code " + pairing.snapshot().code + ")");
      return runtime;
    },

    /** Rewrite pairing.json/txt/svg/png for the current code. */
    async refreshPairingArtifacts() {
      if (!state.listening) return null;
      const snapshot = pairing.snapshot();
      const artifacts = await writePairingArtifacts({
        paths,
        hostId: hostState.hostId,
        hostName: hostDisplayName(),
        protocol: PROTOCOL_VERSION,
        port: state.port,
        pairing: snapshot,
        now: now(),
        interfaces,
        publicUrl: publicUrl(),
        deviceCount: devices.size
      });
      state.artifacts = artifacts;
      return artifacts;
    },

    /** Current QR payload (also embedded in the pairing page). */
    pairingUri() {
      const snapshot = pairing.snapshot();
      const endpoints = pairingEndpoints(state.port, interfaces);
      return pairingUri({
        baseUrl: endpoints.baseUrl,
        altUrl: publicUrl() ?? undefined,
        code: snapshot.code,
        hostId: hostState.hostId,
        hostName: hostDisplayName()
      });
    },

    /** Release follow handles, close SSE sockets, stop the listener. */
    async stop() {
      if (state.timer !== null) {
        clearInterval(state.timer);
        state.timer = null;
      }
      refreshArtifactsHook = null;
      state.listening = false;
      if (state.tunnel !== null) {
        await state.tunnel.stop().catch((error) => logger.warn("dsh remote: stopping cloudflared failed: " + error.message));
        state.tunnel = null;
      }
      await state.refreshChain;
      await service.dispose().catch((error) => logger.warn("dsh remote: disposing subscriptions failed: " + error.message));
      hub.stop();
      await devices.flush().catch((error) => logger.warn("dsh remote: flushing devices failed: " + error.message));
      await http.close().catch((error) => logger.warn("dsh remote: closing listener failed: " + error.message));
    }
  };

  service.publicUrlProvider = () => runtime.publicUrl;
  service.tunnelProvider = () => runtime.tunnelStatus;

  // Settings page data: the client bundle renders the QR/code/devices from
  // this same-origin JSON route (the DSH Settings → 远程控制 section).
  const hostContext = settings.ctx;
  if (hostContext !== undefined && typeof hostContext.inject === "function") {
    try {
      hostContext.inject(["webServer"], (webCtx) => {
        try {
          webCtx.effect(() => webCtx.webServer.register({
            kind: "exact",
            path: "/dsh-remote/state",
            handler: (request, response) => {
              if (request.method !== "GET") {
                response.writeHead(405, { allow: "GET", "content-type": "application/json; charset=utf-8" });
                response.end(JSON.stringify({ error: "method-not-allowed" }));
                return;
              }
              let body;
              try {
                body = JSON.stringify(runtime.pairingState());
              } catch (error) {
                response.writeHead(500, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
                response.end(JSON.stringify({ error: "internal", message: String(error?.message ?? error) }));
                return;
              }
              response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
              response.end(body);
            }
          }), "dsh-remote: settings state route");
        } catch (error) {
          logger.warn("dsh remote: cannot register the settings route: " + (error?.message ?? error));
        }
      });
    } catch (error) {
      logger.warn("dsh remote: cannot register the settings state: " + (error?.message ?? error));
    }
  }

  if (settings.bridge !== undefined && settings.bridge !== null) {
    service.attachBridge(settings.bridge);
    if (typeof settings.bridge.init === "function") await settings.bridge.init();
  }

  return runtime;
}