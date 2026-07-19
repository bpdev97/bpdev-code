import { type HermesSettings, ThreadId } from "@t3tools/contracts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { ProviderAdapterProcessError } from "../Errors.ts";
import {
  HermesGatewayClient,
  type HermesGatewayConnection,
  type HermesGatewayClientOptions,
  type HermesGatewayEvent,
} from "./HermesGatewayClient.ts";
import { buildHermesGatewayArgs, HERMES_DRIVER_KIND } from "./HermesGatewaySupport.ts";

interface GatewayEndpoint {
  readonly port: number;
  readonly token: string;
}

export interface HermesGatewayRuntime {
  readonly connect: (
    onEvent: (event: HermesGatewayEvent) => void,
  ) => Effect.Effect<HermesGatewayConnection, ProviderAdapterProcessError>;
}

export interface HermesGatewayRuntimeOptions {
  readonly clientOptions?: HermesGatewayClientOptions;
}

const READY_PREFIX = "HERMES_BACKEND_READY port=";
const START_TIMEOUT_MS = 20_000;
const GATEWAY_THREAD_ID = ThreadId.make("hermes-gateway");

export const makeHermesGatewayRuntime = Effect.fn("makeHermesGatewayRuntime")(function* (
  settings: Pick<HermesSettings, "binaryPath" | "profile">,
  environment: NodeJS.ProcessEnv = process.env,
  options: HermesGatewayRuntimeOptions = {},
): Effect.fn.Return<
  HermesGatewayRuntime,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto | Scope.Scope
> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const crypto = yield* Crypto.Crypto;
  const parentScope = yield* Scope.Scope;
  const startLock = yield* Semaphore.make(1);
  const endpointRef = yield* Ref.make<Option.Option<GatewayEndpoint>>(Option.none());

  const start = startLock.withPermit(
    Effect.gen(function* () {
      const existing = yield* Ref.get(endpointRef);
      if (Option.isSome(existing)) return existing.value;

      const token = yield* crypto.randomUUIDv4.pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterProcessError({
              provider: HERMES_DRIVER_KIND,
              threadId: GATEWAY_THREAD_ID,
              detail: "Could not generate a Hermes gateway session token.",
              cause,
            }),
        ),
      );
      const scope = yield* Scope.make("sequential");
      yield* Scope.addFinalizer(parentScope, Scope.close(scope, Exit.void).pipe(Effect.ignore));
      const executable = settings.binaryPath || "hermes";
      const args = buildHermesGatewayArgs(settings);
      const spawnInput = yield* resolveSpawnCommand(executable, args, { env: environment }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterProcessError({
              provider: HERMES_DRIVER_KIND,
              threadId: GATEWAY_THREAD_ID,
              detail: "Could not resolve the Hermes gateway command.",
              cause,
            }),
        ),
      );
      const handle = yield* spawner
        .spawn(
          ChildProcess.make(spawnInput.command, spawnInput.args, {
            env: { ...environment, HERMES_DASHBOARD_SESSION_TOKEN: token },
            extendEnv: true,
            shell: spawnInput.shell,
          }),
        )
        .pipe(
          Effect.provideService(Scope.Scope, scope),
          Effect.mapError(
            (cause) =>
              new ProviderAdapterProcessError({
                provider: HERMES_DRIVER_KIND,
                threadId: GATEWAY_THREAD_ID,
                detail: "Could not start the Hermes gateway.",
                cause,
              }),
          ),
        );

      const ready = yield* Deferred.make<number, ProviderAdapterProcessError>();
      const exited = yield* Ref.make(false);
      yield* handle.stdout.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.runForEach((line) => {
          if (!line.startsWith(READY_PREFIX)) return Effect.void;
          const port = Number.parseInt(line.slice(READY_PREFIX.length).trim(), 10);
          return Number.isInteger(port) && port > 0
            ? Deferred.succeed(ready, port).pipe(Effect.asVoid)
            : Effect.void;
        }),
        Effect.ignore,
        Effect.forkIn(scope),
      );
      yield* handle.stderr.pipe(Stream.runDrain, Effect.ignore, Effect.forkIn(scope));
      yield* handle.exitCode.pipe(
        Effect.flatMap((code) =>
          Effect.all(
            [
              Ref.set(endpointRef, Option.none()),
              Ref.set(exited, true),
              Deferred.fail(
                ready,
                new ProviderAdapterProcessError({
                  provider: HERMES_DRIVER_KIND,
                  threadId: GATEWAY_THREAD_ID,
                  detail: `Hermes gateway exited before becoming ready (code ${Number(code)}).`,
                }),
              ).pipe(Effect.ignore),
            ],
            { discard: true },
          ),
        ),
        Effect.ignore,
        Effect.forkIn(scope),
      );

      const port = yield* Deferred.await(ready).pipe(
        Effect.timeoutOption(START_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new ProviderAdapterProcessError({
                  provider: HERMES_DRIVER_KIND,
                  threadId: GATEWAY_THREAD_ID,
                  detail: "Timed out waiting for the Hermes gateway to start.",
                }),
              ),
            onSome: Effect.succeed,
          }),
        ),
        Effect.onError(() => Scope.close(scope, Exit.void).pipe(Effect.ignore)),
      );
      const endpoint = { port, token } satisfies GatewayEndpoint;
      yield* Ref.set(endpointRef, Option.some(endpoint));
      if (yield* Ref.get(exited)) {
        yield* Ref.set(endpointRef, Option.none());
        yield* Scope.close(scope, Exit.void).pipe(Effect.ignore);
        return yield* new ProviderAdapterProcessError({
          provider: HERMES_DRIVER_KIND,
          threadId: GATEWAY_THREAD_ID,
          detail: "Hermes gateway exited during startup.",
        });
      }
      return endpoint;
    }),
  );

  const connect: HermesGatewayRuntime["connect"] = (onEvent) =>
    Effect.gen(function* () {
      const endpoint = yield* start;
      const client = new HermesGatewayClient(onEvent, options.clientOptions);
      const url = `ws://127.0.0.1:${endpoint.port}/api/ws?token=${encodeURIComponent(endpoint.token)}`;
      yield* Effect.tryPromise({
        try: () => client.connect(url),
        catch: (cause) =>
          new ProviderAdapterProcessError({
            provider: HERMES_DRIVER_KIND,
            threadId: GATEWAY_THREAD_ID,
            detail: cause instanceof Error ? cause.message : "Could not connect to Hermes gateway.",
            cause,
          }),
      });
      return client;
    });

  return { connect };
});
