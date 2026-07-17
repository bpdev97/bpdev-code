import type { HermesSettings } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import type * as AcpSessionRuntime from "../acp/AcpSessionRuntime.ts";
import {
  applyHermesAcpModelSelection,
  currentHermesModelIdFromSessionSetup,
  makeHermesAcpRuntime,
} from "./HermesAcpSupport.ts";

interface HermesUtilityContext {
  readonly runtime: AcpSessionRuntime.AcpSessionRuntime["Service"];
  readonly started: AcpSessionRuntime.AcpSessionRuntimeStartResult;
  currentModelId: string | undefined;
}

export interface HermesAcpUtility {
  readonly getModels: Effect.Effect<
    EffectAcpSchema.SessionModelState | null | undefined,
    EffectAcpErrors.AcpError
  >;
  readonly generate: (input: {
    readonly modelId?: string | undefined;
    readonly prompt: string;
  }) => Effect.Effect<
    {
      readonly text: string;
      readonly response: EffectAcpSchema.PromptResponse;
    },
    EffectAcpErrors.AcpError
  >;
}

export const makeHermesAcpUtility = Effect.fn("makeHermesAcpUtility")(function* (
  hermesSettings: Pick<HermesSettings, "binaryPath" | "profile">,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<
  HermesAcpUtility,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto | Scope.Scope
> {
  const crypto = yield* Crypto.Crypto;
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const parentScope = yield* Scope.Scope;
  const serialization = yield* Semaphore.make(1);
  const contextRef = yield* Ref.make<Option.Option<HermesUtilityContext>>(Option.none());
  const outputTargetRef = yield* Ref.make<Option.Option<Ref.Ref<string>>>(Option.none());
  const modelsRef = yield* Ref.make<EffectAcpSchema.SessionModelState | null | undefined>(
    undefined,
  );

  const createContext = Effect.gen(function* () {
    const scope = yield* Scope.make("sequential");
    yield* Scope.addFinalizer(parentScope, Scope.close(scope, Exit.void).pipe(Effect.ignore));

    const runtime = yield* makeHermesAcpRuntime({
      hermesSettings,
      environment,
      childProcessSpawner,
      cwd: process.cwd(),
      clientInfo: { name: "t3-code-hermes-utility", version: "0.0.0" },
    }).pipe(
      Effect.provideService(Crypto.Crypto, crypto),
      Effect.provideService(Scope.Scope, scope),
    );

    yield* Stream.runForEach(runtime.getEvents(), (event) => {
      if (event._tag === "EventStreamBarrier") {
        return Deferred.succeed(event.acknowledge, undefined).pipe(Effect.asVoid);
      }
      if (event._tag !== "ContentDelta" || event.streamKind !== "assistant_text") {
        return Effect.void;
      }
      return Ref.get(outputTargetRef).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.void,
            onSome: (target) => Ref.update(target, (current) => current + event.text),
          }),
        ),
      );
    }).pipe(Effect.forkIn(scope));

    const started = yield* runtime
      .start()
      .pipe(Effect.onError(() => Scope.close(scope, Exit.void).pipe(Effect.ignore)));
    const context: HermesUtilityContext = {
      runtime,
      started,
      currentModelId: currentHermesModelIdFromSessionSetup(started.sessionSetupResult),
    };
    yield* Ref.set(contextRef, Option.some(context));
    return context;
  });

  const getOrCreateContext = Ref.get(contextRef).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => createContext,
        onSome: Effect.succeed,
      }),
    ),
  );

  const resetHistory = (context: HermesUtilityContext) =>
    context.runtime
      .prompt({ prompt: [{ type: "text", text: "/reset" }] })
      .pipe(Effect.andThen(context.runtime.drainEvents), Effect.asVoid);

  const getModels = serialization.withPermit(
    Effect.gen(function* () {
      const cached = yield* Ref.get(modelsRef);
      if (cached !== undefined) {
        return cached;
      }
      const context = yield* getOrCreateContext;
      const models = context.started.sessionSetupResult.models ?? null;
      yield* Ref.set(modelsRef, models);
      return models;
    }),
  );

  const generate: HermesAcpUtility["generate"] = (input) =>
    serialization.withPermit(
      Effect.gen(function* () {
        const context = yield* getOrCreateContext;
        yield* resetHistory(context);
        context.currentModelId = yield* applyHermesAcpModelSelection({
          runtime: context.runtime,
          currentModelId: context.currentModelId,
          requestedModelId: input.modelId,
          mapError: (cause) => cause,
        });

        const outputRef = yield* Ref.make("");
        yield* Ref.set(outputTargetRef, Option.some(outputRef));
        const response = yield* context.runtime
          .prompt({ prompt: [{ type: "text", text: input.prompt }] })
          .pipe(Effect.tap(() => context.runtime.drainEvents));
        const text = yield* Ref.get(outputRef);
        return { text, response };
      }).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            yield* Ref.set(outputTargetRef, Option.none());
            const context = yield* Ref.get(contextRef);
            if (Option.isSome(context)) {
              yield* resetHistory(context.value).pipe(Effect.ignore);
            }
          }),
        ),
      ),
    );

  return { getModels, generate };
});
