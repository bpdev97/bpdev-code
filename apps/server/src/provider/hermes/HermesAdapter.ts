import {
  ApprovalRequestId,
  EventId,
  type HermesSettings,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderSession,
  ProviderInstanceId,
  RuntimeRequestId,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import { mapAcpToAdapterError } from "../acp/AcpAdapterSupport.ts";
import type * as AcpSessionRuntime from "../acp/AcpSessionRuntime.ts";
import {
  makeAcpAssistantItemEvent,
  makeAcpContentDeltaEvent,
  makeAcpPlanUpdatedEvent,
  makeAcpRequestOpenedEvent,
  makeAcpRequestResolvedEvent,
  makeAcpToolCallEvent,
} from "../acp/AcpCoreRuntimeEvents.ts";
import { makeAcpNativeLoggerFactory } from "../acp/AcpNativeLogging.ts";
import { parsePermissionRequest } from "../acp/AcpRuntimeModel.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import type { EventNdjsonLogger } from "../Layers/EventNdjsonLogger.ts";
import {
  applyHermesAcpModelSelection,
  applyHermesRuntimeMode,
  currentHermesModelIdFromSessionSetup,
  HERMES_DRIVER_KIND,
  HERMES_RESUME_SCHEMA_VERSION,
  makeHermesAcpRuntime,
  parseHermesAcpConversationCursor,
  resolveHermesModelId,
  selectHermesAutoApprovalOptionId,
  selectHermesPermissionOptionId,
} from "./HermesAcpSupport.ts";

export interface HermesAdapterOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly instanceId?: ProviderInstanceId;
  readonly nativeEventLogger?: EventNdjsonLogger;
}

interface PendingApproval {
  readonly decision: Deferred.Deferred<ProviderApprovalDecision>;
}

interface HermesSessionContext {
  readonly threadId: ThreadId;
  readonly acpSessionId: string;
  readonly runtimeInstanceId: string;
  readonly scope: Scope.Closeable;
  readonly acp: AcpSessionRuntime.AcpSessionRuntime["Service"];
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly interruptedTurnIds: Set<TurnId>;
  session: ProviderSession;
  notificationFiber: Fiber.Fiber<void, never> | undefined;
  turns: Array<{ id: TurnId; items: Array<unknown> }>;
  activeTurnId: TurnId | undefined;
  currentModelId: string | undefined;
  promptsInFlight: number;
  lastPlanFingerprint: string | undefined;
  stopped: boolean;
}

function settlePendingApprovalsAsCancelled(
  pendingApprovals: ReadonlyMap<ApprovalRequestId, PendingApproval>,
): Effect.Effect<void> {
  return Effect.forEach(
    Array.from(pendingApprovals.values()),
    (pending) => Deferred.succeed(pending.decision, "cancel").pipe(Effect.ignore),
    { discard: true },
  );
}

function appendPromptResultToTurn(
  context: HermesSessionContext,
  turnId: TurnId,
  prompt: ReadonlyArray<EffectAcpSchema.ContentBlock>,
  response: EffectAcpSchema.PromptResponse,
): void {
  const existing = context.turns.find((turn) => turn.id === turnId);
  context.turns = existing
    ? context.turns.map((turn) =>
        turn.id === turnId ? { ...turn, items: [...turn.items, { prompt, response }] } : turn,
      )
    : [...context.turns, { id: turnId, items: [{ prompt, response }] }];
}

function assistantItemIdForRuntime(context: HermesSessionContext, itemId: string): string {
  return `hermes:${context.runtimeInstanceId}:${itemId}`;
}

export const makeHermesAdapter = Effect.fn("makeHermesAdapter")(function* (
  hermesSettings: HermesSettings,
  options?: HermesAdapterOptions,
): Effect.fn.Return<
  ProviderAdapterShape<ProviderAdapterError>,
  never,
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | Path.Path
  | ServerConfig
  | Scope.Scope
> {
  const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("hermes");
  const nativeEventLogger = options?.nativeEventLogger;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const serverConfig = yield* ServerConfig;
  const crypto = yield* Crypto.Crypto;
  const makeAcpNativeLoggers = yield* makeAcpNativeLoggerFactory();
  const sessions = new Map<ThreadId, HermesSessionContext>();
  const threadLocksRef = yield* SynchronizedRef.make(new Map<string, Semaphore.Semaphore>());
  const runtimeEventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const randomUUIDv4 = crypto.randomUUIDv4.pipe(
    Effect.mapError(
      (cause) =>
        new ProviderAdapterRequestError({
          provider: HERMES_DRIVER_KIND,
          method: "crypto/randomUUIDv4",
          detail: "Failed to generate a Hermes runtime identifier.",
          cause,
        }),
    ),
  );
  const makeEventStamp = () =>
    Effect.all({ eventId: Effect.map(randomUUIDv4, EventId.make), createdAt: nowIso });
  const offerRuntimeEvent = (event: ProviderRuntimeEvent) =>
    PubSub.publish(runtimeEventPubSub, event).pipe(Effect.asVoid);
  const mapAcpCallbackFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.mapError(
        (cause) =>
          new EffectAcpErrors.AcpTransportError({
            detail: "Failed to process a Hermes ACP callback.",
            cause,
          }),
      ),
    );

  const getThreadSemaphore = (threadId: string) =>
    SynchronizedRef.modifyEffect(threadLocksRef, (current) => {
      const existing = current.get(threadId);
      if (existing) return Effect.succeed([existing, current] as const);
      return Semaphore.make(1).pipe(
        Effect.map((semaphore) => {
          const next = new Map(current);
          next.set(threadId, semaphore);
          return [semaphore, next] as const;
        }),
      );
    });
  const withThreadLock = <A, E, R>(threadId: string, effect: Effect.Effect<A, E, R>) =>
    Effect.flatMap(getThreadSemaphore(threadId), (semaphore) => semaphore.withPermit(effect));

  const requireSession = (
    threadId: ThreadId,
  ): Effect.Effect<HermesSessionContext, ProviderAdapterSessionNotFoundError> => {
    const context = sessions.get(threadId);
    return !context || context.stopped
      ? Effect.fail(
          new ProviderAdapterSessionNotFoundError({
            provider: HERMES_DRIVER_KIND,
            threadId,
          }),
        )
      : Effect.succeed(context);
  };

  const logNative = (threadId: ThreadId, method: string, payload: unknown) =>
    nativeEventLogger
      ? Effect.gen(function* () {
          const observedAt = yield* nowIso;
          yield* nativeEventLogger.write(
            {
              observedAt,
              event: {
                id: yield* randomUUIDv4,
                kind: "notification",
                provider: HERMES_DRIVER_KIND,
                createdAt: observedAt,
                method,
                threadId,
                payload,
              },
            },
            threadId,
          );
        }).pipe(
          Effect.catchCause((cause) => Effect.logWarning("Hermes event logging failed", cause)),
        )
      : Effect.void;

  const stopSessionInternal = (context: HermesSessionContext) =>
    Effect.gen(function* () {
      if (context.stopped) return;
      context.stopped = true;
      yield* settlePendingApprovalsAsCancelled(context.pendingApprovals);
      if (context.notificationFiber) yield* Fiber.interrupt(context.notificationFiber);
      yield* Scope.close(context.scope, Exit.void).pipe(Effect.ignore);
      sessions.delete(context.threadId);
      yield* offerRuntimeEvent({
        type: "session.exited",
        ...(yield* makeEventStamp()),
        provider: HERMES_DRIVER_KIND,
        threadId: context.threadId,
        payload: { exitKind: "graceful" },
      });
    });

  const startSession: ProviderAdapterShape<ProviderAdapterError>["startSession"] = (input) =>
    withThreadLock(
      input.threadId,
      Effect.gen(function* () {
        if (input.provider !== undefined && input.provider !== HERMES_DRIVER_KIND) {
          return yield* new ProviderAdapterValidationError({
            provider: HERMES_DRIVER_KIND,
            operation: "startSession",
            issue: `Expected provider '${HERMES_DRIVER_KIND}' but received '${input.provider}'.`,
          });
        }
        if (!input.cwd?.trim()) {
          return yield* new ProviderAdapterValidationError({
            provider: HERMES_DRIVER_KIND,
            operation: "startSession",
            issue: "cwd is required and must be non-empty.",
          });
        }

        const existing = sessions.get(input.threadId);
        if (existing && !existing.stopped) yield* stopSessionInternal(existing);
        const cwd = path.resolve(input.cwd.trim());
        const sessionScope = yield* Scope.make("sequential");
        let sessionScopeTransferred = false;
        yield* Effect.addFinalizer(() =>
          sessionScopeTransferred ? Effect.void : Scope.close(sessionScope, Exit.void),
        );
        const pendingApprovals = new Map<ApprovalRequestId, PendingApproval>();
        const resumeSessionId = parseHermesAcpConversationCursor(input.resumeCursor)?.sessionId;
        const acpNativeLoggers = makeAcpNativeLoggers({
          nativeEventLogger,
          provider: HERMES_DRIVER_KIND,
          threadId: input.threadId,
        });
        const mcpSession = McpProviderSession.readMcpProviderSession(input.threadId);
        const acp = yield* makeHermesAcpRuntime({
          hermesSettings,
          ...(options?.environment ? { environment: options.environment } : {}),
          childProcessSpawner,
          cwd,
          ...(resumeSessionId ? { resumeSessionId } : {}),
          clientInfo: { name: "t3-code", version: "0.0.0" },
          ...(mcpSession
            ? {
                mcpServers: [
                  {
                    type: "http" as const,
                    name: "t3-code",
                    url: mcpSession.endpoint,
                    headers: [{ name: "Authorization", value: mcpSession.authorizationHeader }],
                  },
                ],
              }
            : {}),
          ...acpNativeLoggers,
        }).pipe(
          Effect.provideService(Scope.Scope, sessionScope),
          Effect.mapError(
            (cause) =>
              new ProviderAdapterProcessError({
                provider: HERMES_DRIVER_KIND,
                threadId: input.threadId,
                detail: cause.message,
                cause,
              }),
          ),
        );

        yield* acp.handleRequestPermission((params) =>
          mapAcpCallbackFailure(
            Effect.gen(function* () {
              yield* logNative(input.threadId, "session/request_permission", params);
              if (input.runtimeMode === "full-access") {
                const optionId = selectHermesAutoApprovalOptionId(params);
                return optionId
                  ? { outcome: { outcome: "selected" as const, optionId } }
                  : { outcome: { outcome: "cancelled" as const } };
              }

              const permissionRequest = parsePermissionRequest(params);
              const requestId = ApprovalRequestId.make(yield* randomUUIDv4);
              const runtimeRequestId = RuntimeRequestId.make(requestId);
              const decision = yield* Deferred.make<ProviderApprovalDecision>();
              pendingApprovals.set(requestId, { decision });
              const turnId = sessions.get(input.threadId)?.activeTurnId;
              yield* offerRuntimeEvent(
                makeAcpRequestOpenedEvent({
                  stamp: yield* makeEventStamp(),
                  provider: HERMES_DRIVER_KIND,
                  threadId: input.threadId,
                  turnId,
                  requestId: runtimeRequestId,
                  permissionRequest,
                  detail: permissionRequest.detail ?? "Hermes requested permission.",
                  args: params,
                  source: "acp.jsonrpc",
                  method: "session/request_permission",
                  rawPayload: params,
                }),
              );
              const resolved = yield* Deferred.await(decision);
              pendingApprovals.delete(requestId);
              yield* offerRuntimeEvent(
                makeAcpRequestResolvedEvent({
                  stamp: yield* makeEventStamp(),
                  provider: HERMES_DRIVER_KIND,
                  threadId: input.threadId,
                  turnId,
                  requestId: runtimeRequestId,
                  permissionRequest,
                  decision: resolved,
                }),
              );
              const optionId = selectHermesPermissionOptionId(params, resolved);
              if (resolved === "acceptForSession" && optionId === "allow_once") {
                yield* Effect.logWarning(
                  "Hermes did not advertise allow_session; using one-time approval.",
                );
              }
              return optionId
                ? { outcome: { outcome: "selected" as const, optionId } }
                : { outcome: { outcome: "cancelled" as const } };
            }),
          ),
        );

        const started = yield* acp
          .start()
          .pipe(
            Effect.mapError((cause) =>
              mapAcpToAdapterError(HERMES_DRIVER_KIND, input.threadId, "session/start", cause),
            ),
          );
        const selectedModel =
          input.modelSelection?.instanceId === boundInstanceId
            ? resolveHermesModelId(input.modelSelection.model)
            : undefined;
        const currentModelId = yield* applyHermesAcpModelSelection({
          runtime: acp,
          currentModelId: currentHermesModelIdFromSessionSetup(started.sessionSetupResult),
          requestedModelId: selectedModel,
          mapError: (cause) =>
            mapAcpToAdapterError(HERMES_DRIVER_KIND, input.threadId, "session/set_model", cause),
        });
        yield* applyHermesRuntimeMode({
          runtime: acp,
          sessionId: started.sessionId,
          runtimeMode: input.runtimeMode,
          currentModeId: started.sessionSetupResult.modes?.currentModeId,
          mapError: (cause) =>
            mapAcpToAdapterError(HERMES_DRIVER_KIND, input.threadId, "session/set_mode", cause),
        });

        const now = yield* nowIso;
        const session: ProviderSession = {
          provider: HERMES_DRIVER_KIND,
          providerInstanceId: boundInstanceId,
          status: "ready",
          runtimeMode: input.runtimeMode,
          cwd,
          ...(currentModelId ? { model: currentModelId } : {}),
          threadId: input.threadId,
          resumeCursor: {
            schemaVersion: HERMES_RESUME_SCHEMA_VERSION,
            transport: "acp",
            sessionId: started.sessionId,
          },
          createdAt: now,
          updatedAt: now,
        };
        const context: HermesSessionContext = {
          threadId: input.threadId,
          acpSessionId: started.sessionId,
          runtimeInstanceId: yield* randomUUIDv4,
          scope: sessionScope,
          acp,
          pendingApprovals,
          interruptedTurnIds: new Set(),
          session,
          notificationFiber: undefined,
          turns: [],
          activeTurnId: undefined,
          currentModelId,
          promptsInFlight: 0,
          lastPlanFingerprint: undefined,
          stopped: false,
        };

        const notificationFiber = yield* Stream.runForEach(acp.getEvents(), (event) =>
          Effect.gen(function* () {
            if (event._tag === "EventStreamBarrier") {
              yield* Deferred.succeed(event.acknowledge, undefined);
              return;
            }
            if (
              event._tag === "PlanUpdated" ||
              event._tag === "ToolCallUpdated" ||
              event._tag === "ContentDelta"
            ) {
              yield* logNative(context.threadId, "session/update", event.rawPayload);
            }
            if (event._tag === "ModeChanged") return;
            const turnId = context.activeTurnId;
            if (!turnId || context.interruptedTurnIds.has(turnId)) return;
            const stamp = yield* makeEventStamp();
            switch (event._tag) {
              case "AssistantItemStarted":
              case "AssistantItemCompleted":
                yield* offerRuntimeEvent(
                  makeAcpAssistantItemEvent({
                    stamp,
                    provider: HERMES_DRIVER_KIND,
                    threadId: context.threadId,
                    turnId,
                    itemId: assistantItemIdForRuntime(context, event.itemId),
                    lifecycle:
                      event._tag === "AssistantItemStarted" ? "item.started" : "item.completed",
                  }),
                );
                return;
              case "PlanUpdated": {
                const fingerprint = `${event.payload.explanation ?? ""}\u0000${event.payload.plan
                  .map((entry) => `${entry.status}\u0000${entry.step}`)
                  .join("\u0001")}`;
                if (context.lastPlanFingerprint === fingerprint) return;
                context.lastPlanFingerprint = fingerprint;
                yield* offerRuntimeEvent(
                  makeAcpPlanUpdatedEvent({
                    stamp,
                    provider: HERMES_DRIVER_KIND,
                    threadId: context.threadId,
                    turnId,
                    payload: event.payload,
                    source: "acp.jsonrpc",
                    method: "session/update",
                    rawPayload: event.rawPayload,
                  }),
                );
                return;
              }
              case "ToolCallUpdated":
                yield* offerRuntimeEvent(
                  makeAcpToolCallEvent({
                    stamp,
                    provider: HERMES_DRIVER_KIND,
                    threadId: context.threadId,
                    turnId,
                    toolCall: event.toolCall,
                    rawPayload: event.rawPayload,
                  }),
                );
                return;
              case "ContentDelta":
                yield* offerRuntimeEvent(
                  makeAcpContentDeltaEvent({
                    stamp,
                    provider: HERMES_DRIVER_KIND,
                    threadId: context.threadId,
                    turnId,
                    ...(event.itemId
                      ? { itemId: assistantItemIdForRuntime(context, event.itemId) }
                      : {}),
                    streamKind: event.streamKind,
                    text: event.text,
                    rawPayload: event.rawPayload,
                  }),
                );
                return;
            }
          }),
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.logError("Failed to process a Hermes ACP notification.", cause),
          ),
          Effect.forkIn(sessionScope),
        );
        context.notificationFiber = notificationFiber;
        sessions.set(input.threadId, context);
        sessionScopeTransferred = true;

        yield* offerRuntimeEvent({
          type: "session.started",
          ...(yield* makeEventStamp()),
          provider: HERMES_DRIVER_KIND,
          threadId: input.threadId,
          payload: { resume: started.initializeResult },
        });
        yield* offerRuntimeEvent({
          type: "session.state.changed",
          ...(yield* makeEventStamp()),
          provider: HERMES_DRIVER_KIND,
          threadId: input.threadId,
          payload: { state: "ready", reason: "Hermes ACP session ready" },
        });
        yield* offerRuntimeEvent({
          type: "thread.started",
          ...(yield* makeEventStamp()),
          provider: HERMES_DRIVER_KIND,
          threadId: input.threadId,
          payload: { providerThreadId: started.sessionId },
        });
        return session;
      }).pipe(Effect.scoped),
    );

  const sendTurn: ProviderAdapterShape<ProviderAdapterError>["sendTurn"] = (input) =>
    Effect.gen(function* () {
      const prepared = yield* withThreadLock(
        input.threadId,
        Effect.gen(function* () {
          const context = yield* requireSession(input.threadId);
          const steeringTurnId = context.promptsInFlight > 0 ? context.activeTurnId : undefined;
          const turnId = steeringTurnId ?? TurnId.make(yield* randomUUIDv4);
          const selectedModel =
            input.modelSelection?.instanceId === boundInstanceId
              ? resolveHermesModelId(input.modelSelection.model)
              : undefined;
          context.currentModelId = yield* applyHermesAcpModelSelection({
            runtime: context.acp,
            currentModelId: context.currentModelId,
            requestedModelId: selectedModel,
            mapError: (cause) =>
              mapAcpToAdapterError(HERMES_DRIVER_KIND, input.threadId, "session/set_model", cause),
          });

          const text = input.input?.trim();
          const imageParts = yield* Effect.forEach(input.attachments ?? [], (attachment) =>
            Effect.gen(function* () {
              const attachmentPath = resolveAttachmentPath({
                attachmentsDir: serverConfig.attachmentsDir,
                attachment,
              });
              if (!attachmentPath) {
                return yield* new ProviderAdapterRequestError({
                  provider: HERMES_DRIVER_KIND,
                  method: "session/prompt",
                  detail: `Invalid attachment id '${attachment.id}'.`,
                });
              }
              const bytes = yield* fileSystem.readFile(attachmentPath).pipe(
                Effect.mapError(
                  (cause) =>
                    new ProviderAdapterRequestError({
                      provider: HERMES_DRIVER_KIND,
                      method: "session/prompt",
                      detail: cause.message,
                      cause,
                    }),
                ),
              );
              return {
                type: "image" as const,
                data: Buffer.from(bytes).toString("base64"),
                mimeType: attachment.mimeType,
              } satisfies EffectAcpSchema.ContentBlock;
            }),
          );
          const prompt: Array<EffectAcpSchema.ContentBlock> = [
            ...(text ? [{ type: "text" as const, text }] : []),
            ...imageParts,
          ];
          if (prompt.length === 0) {
            return yield* new ProviderAdapterValidationError({
              provider: HERMES_DRIVER_KIND,
              operation: "sendTurn",
              issue: "Turn requires non-empty text or attachments.",
            });
          }

          context.promptsInFlight += 1;
          context.activeTurnId = turnId;
          context.session = {
            ...context.session,
            status: "running",
            activeTurnId: turnId,
            updatedAt: yield* nowIso,
            ...(context.currentModelId ? { model: context.currentModelId } : {}),
          };
          if (!steeringTurnId) {
            context.lastPlanFingerprint = undefined;
            yield* offerRuntimeEvent({
              type: "turn.started",
              ...(yield* makeEventStamp()),
              provider: HERMES_DRIVER_KIND,
              threadId: input.threadId,
              turnId,
              payload: context.currentModelId ? { model: context.currentModelId } : {},
            });
          }
          const isSteering = steeringTurnId !== undefined;
          const acpPrompt =
            isSteering && text && imageParts.length === 0
              ? ([
                  { type: "text" as const, text: `/steer ${text}` },
                ] satisfies Array<EffectAcpSchema.ContentBlock>)
              : prompt;
          return {
            acp: context.acp,
            acpSessionId: context.acpSessionId,
            prompt: acpPrompt,
            turnId,
            resumeCursor: context.session.resumeCursor,
            isSteering,
          };
        }),
      );

      const promptEffect = prepared.isSteering
        ? prepared.acp.promptWhileActive({ prompt: prepared.prompt })
        : prepared.acp.prompt({ prompt: prepared.prompt });
      return yield* promptEffect.pipe(
        Effect.mapError((cause) =>
          mapAcpToAdapterError(HERMES_DRIVER_KIND, input.threadId, "session/prompt", cause),
        ),
        Effect.matchEffect({
          onFailure: (error) =>
            withThreadLock(
              input.threadId,
              Effect.gen(function* () {
                const context = sessions.get(input.threadId);
                if (
                  context &&
                  context.acpSessionId === prepared.acpSessionId &&
                  !context.interruptedTurnIds.has(prepared.turnId)
                ) {
                  context.promptsInFlight = Math.max(0, context.promptsInFlight - 1);
                  if (context.promptsInFlight === 0) {
                    const { activeTurnId: _activeTurnId, ...readySession } = context.session;
                    context.activeTurnId = undefined;
                    context.session = {
                      ...readySession,
                      status: "ready",
                      updatedAt: yield* nowIso,
                    };
                    yield* offerRuntimeEvent({
                      type: "turn.completed",
                      ...(yield* makeEventStamp()),
                      provider: HERMES_DRIVER_KIND,
                      threadId: input.threadId,
                      turnId: prepared.turnId,
                      payload: { state: "failed", errorMessage: error.message },
                    });
                  }
                }
                return yield* error;
              }),
            ),
          onSuccess: (response) =>
            prepared.acp.drainEvents.pipe(
              Effect.andThen(
                withThreadLock(
                  input.threadId,
                  Effect.gen(function* () {
                    const context = yield* requireSession(input.threadId);
                    if (
                      context.acpSessionId !== prepared.acpSessionId ||
                      context.interruptedTurnIds.has(prepared.turnId)
                    ) {
                      return {
                        threadId: input.threadId,
                        turnId: prepared.turnId,
                        resumeCursor: prepared.resumeCursor,
                      };
                    }
                    appendPromptResultToTurn(context, prepared.turnId, prepared.prompt, response);
                    context.promptsInFlight = Math.max(0, context.promptsInFlight - 1);
                    if (context.promptsInFlight === 0) {
                      const { activeTurnId: _activeTurnId, ...readySession } = context.session;
                      context.activeTurnId = undefined;
                      context.session = {
                        ...readySession,
                        status: "ready",
                        updatedAt: yield* nowIso,
                      };
                      yield* offerRuntimeEvent({
                        type: "turn.completed",
                        ...(yield* makeEventStamp()),
                        provider: HERMES_DRIVER_KIND,
                        threadId: input.threadId,
                        turnId: prepared.turnId,
                        payload: {
                          state: response.stopReason === "cancelled" ? "cancelled" : "completed",
                          stopReason: response.stopReason,
                        },
                      });
                    }
                    return {
                      threadId: input.threadId,
                      turnId: prepared.turnId,
                      resumeCursor: context.session.resumeCursor,
                    };
                  }),
                ),
              ),
            ),
        }),
      );
    });

  const interruptTurn: ProviderAdapterShape<ProviderAdapterError>["interruptTurn"] = (
    threadId,
    requestedTurnId,
  ) =>
    withThreadLock(
      threadId,
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        const turnId = context.activeTurnId ?? context.session.activeTurnId;
        if (requestedTurnId && turnId && requestedTurnId !== turnId) return;
        yield* settlePendingApprovalsAsCancelled(context.pendingApprovals);
        yield* context.acp.cancel.pipe(
          Effect.mapError((cause) =>
            mapAcpToAdapterError(HERMES_DRIVER_KIND, threadId, "session/cancel", cause),
          ),
          Effect.ignore,
        );
        context.promptsInFlight = 0;
        if (turnId) context.interruptedTurnIds.add(turnId);
        const { activeTurnId: _activeTurnId, ...readySession } = context.session;
        context.activeTurnId = undefined;
        context.session = { ...readySession, status: "ready", updatedAt: yield* nowIso };
        if (turnId) {
          yield* offerRuntimeEvent({
            type: "turn.completed",
            ...(yield* makeEventStamp()),
            provider: HERMES_DRIVER_KIND,
            threadId,
            turnId,
            payload: { state: "cancelled", stopReason: "cancelled" },
          });
        }
      }),
    );

  const respondToRequest: ProviderAdapterShape<ProviderAdapterError>["respondToRequest"] = (
    threadId,
    requestId,
    decision,
  ) =>
    Effect.gen(function* () {
      const context = yield* requireSession(threadId);
      const pending = context.pendingApprovals.get(requestId);
      if (!pending) {
        return yield* new ProviderAdapterRequestError({
          provider: HERMES_DRIVER_KIND,
          method: "session/request_permission",
          detail: `Unknown pending approval request: ${requestId}`,
        });
      }
      yield* Deferred.succeed(pending.decision, decision);
    });

  const respondToUserInput: ProviderAdapterShape<ProviderAdapterError>["respondToUserInput"] = (
    threadId,
  ) =>
    requireSession(threadId).pipe(
      Effect.andThen(
        Effect.fail(
          new ProviderAdapterRequestError({
            provider: HERMES_DRIVER_KIND,
            method: "session/elicitation",
            detail: "Hermes ACP does not currently advertise structured user-input requests.",
          }),
        ),
      ),
    );

  const readThread: ProviderAdapterShape<ProviderAdapterError>["readThread"] = (threadId) =>
    requireSession(threadId).pipe(Effect.map((context) => ({ threadId, turns: context.turns })));
  const rollbackThread: ProviderAdapterShape<ProviderAdapterError>["rollbackThread"] = (
    threadId,
    numTurns,
  ) =>
    Effect.gen(function* () {
      yield* requireSession(threadId);
      if (!Number.isInteger(numTurns) || numTurns < 1) {
        return yield* new ProviderAdapterValidationError({
          provider: HERMES_DRIVER_KIND,
          operation: "rollbackThread",
          issue: "numTurns must be an integer >= 1.",
        });
      }
      return yield* new ProviderAdapterRequestError({
        provider: HERMES_DRIVER_KIND,
        method: "thread/rollback",
        detail: "Hermes ACP sessions do not support provider-side rollback.",
      });
    });
  const stopSession: ProviderAdapterShape<ProviderAdapterError>["stopSession"] = (threadId) =>
    withThreadLock(threadId, requireSession(threadId).pipe(Effect.flatMap(stopSessionInternal)));
  const listSessions: ProviderAdapterShape<ProviderAdapterError>["listSessions"] = () =>
    Effect.sync(() => Array.from(sessions.values(), (context) => ({ ...context.session })));
  const hasSession: ProviderAdapterShape<ProviderAdapterError>["hasSession"] = (threadId) =>
    Effect.sync(() => {
      const context = sessions.get(threadId);
      return context !== undefined && !context.stopped;
    });
  const stopAll: ProviderAdapterShape<ProviderAdapterError>["stopAll"] = () =>
    Effect.forEach(Array.from(sessions.values()), stopSessionInternal, { discard: true });

  yield* Effect.addFinalizer(() =>
    stopAll().pipe(Effect.ignore, Effect.andThen(PubSub.shutdown(runtimeEventPubSub))),
  );

  return {
    provider: HERMES_DRIVER_KIND,
    capabilities: { sessionModelSwitch: "in-session" },
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    readThread,
    rollbackThread,
    stopAll,
    streamEvents: Stream.fromPubSub(runtimeEventPubSub),
  } satisfies ProviderAdapterShape<ProviderAdapterError>;
});
