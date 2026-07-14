import * as NodeHttp2 from "node:http2";
import * as NodeCrypto from "node:crypto";
import * as NodeTimersPromises from "node:timers/promises";
import { importPKCS8, SignJWT } from "jose";
import type {
  RelayAgentActivityAggregateState,
  RelayAgentActivityState,
  RelayAgentAwarenessPreferences,
} from "@t3tools/contracts/relay";

import type { ApnsEnvironment, RelayConfig } from "./config.ts";

const TOKEN_LIFETIME_MS = 50 * 60 * 1_000;
const INVALID_TOKEN_REASONS = new Set(["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"]);

export interface ApnsResult {
  readonly ok: boolean;
  readonly status: number;
  readonly reason: string | null;
  readonly apnsId: string | null;
  readonly invalidToken: boolean;
}

export interface ApnsPreparedRequest {
  readonly token: string;
  readonly topic: string;
  readonly pushType: "alert" | "liveactivity";
  readonly priority: "5" | "10";
  readonly payload: unknown;
  readonly environment: ApnsEnvironment;
  readonly collapseId?: string;
}

interface ApnsRequest extends ApnsPreparedRequest {
  readonly apnsId: string;
}

export interface NotificationInput {
  readonly token: string;
  readonly bundleId?: string | null;
  readonly environment?: ApnsEnvironment | null;
  readonly state: RelayAgentActivityState;
}

export interface LiveActivityInput {
  readonly token: string;
  readonly bundleId?: string | null;
  readonly environment?: ApnsEnvironment | null;
  readonly aggregate: RelayAgentActivityAggregateState | null;
  readonly alert: { readonly title: string; readonly body: string } | null;
}

export interface ApnsDeliveryClient {
  readonly ready: () => Promise<void>;
  readonly sendNotification: (input: NotificationInput) => Promise<ApnsResult>;
  readonly sendLiveActivity: (input: LiveActivityInput) => Promise<ApnsResult>;
}

interface CachedProviderToken {
  readonly value: string;
  readonly createdAt: number;
}

export class ApnsClient implements ApnsDeliveryClient {
  readonly #config: RelayConfig["apns"];
  #key: Promise<CryptoKey> | null = null;
  #token: CachedProviderToken | null = null;

  constructor(config: RelayConfig["apns"]) {
    this.#config = config;
  }

  async ready(): Promise<void> {
    this.#key ??= importPKCS8(this.#config.privateKey, "ES256");
    await this.#key;
  }

  async #providerToken(): Promise<string> {
    const now = Date.now();
    if (this.#token && now - this.#token.createdAt < TOKEN_LIFETIME_MS) {
      return this.#token.value;
    }
    this.#key ??= importPKCS8(this.#config.privateKey, "ES256");
    const value = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: this.#config.keyId })
      .setIssuer(this.#config.teamId)
      .setIssuedAt(Math.floor(now / 1_000))
      .sign(await this.#key);
    this.#token = { value, createdAt: now };
    return value;
  }

  async #sendOnce(request: ApnsRequest): Promise<ApnsResult> {
    const host =
      request.environment === "production"
        ? "https://api.push.apple.com"
        : "https://api.sandbox.push.apple.com";
    const authorization = `bearer ${await this.#providerToken()}`;
    const body = JSON.stringify(request.payload);

    return await new Promise<ApnsResult>((resolve, reject) => {
      const session = NodeHttp2.connect(host);
      let settled = false;
      const finish = (result: ApnsResult) => {
        if (settled) return;
        settled = true;
        session.close();
        resolve(result);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        session.destroy();
        reject(error);
      };
      session.once("error", fail);
      session.setTimeout(10_000, () => fail(new Error("APNs request timed out")));
      const stream = session.request({
        ":method": "POST",
        ":path": `/3/device/${request.token}`,
        authorization,
        "apns-topic": request.topic,
        "apns-push-type": request.pushType,
        "apns-priority": request.priority,
        "apns-id": request.apnsId,
        "content-type": "application/json",
        ...(request.collapseId ? { "apns-collapse-id": request.collapseId } : {}),
      });
      let status = 0;
      let apnsId: string | null = null;
      let responseBody = "";
      stream.setEncoding("utf8");
      stream.on("response", (headers) => {
        status = Number(headers[":status"] ?? 0);
        apnsId = typeof headers["apns-id"] === "string" ? headers["apns-id"] : null;
      });
      stream.on("data", (chunk: string) => {
        responseBody += chunk;
      });
      stream.once("end", () => {
        let reason: string | null = null;
        if (responseBody) {
          try {
            const parsed = JSON.parse(responseBody) as { reason?: unknown };
            reason = typeof parsed.reason === "string" ? parsed.reason : responseBody;
          } catch {
            reason = responseBody;
          }
        }
        finish({
          ok: status === 200,
          status,
          reason,
          apnsId,
          invalidToken: status === 410 || (reason !== null && INVALID_TOKEN_REASONS.has(reason)),
        });
      });
      stream.once("error", fail);
      stream.end(body);
    });
  }

  async #send(input: ApnsPreparedRequest): Promise<ApnsResult> {
    const request = { ...input, apnsId: NodeCrypto.randomUUID() };
    const sendAttempt = async (attempt: number): Promise<ApnsResult> => {
      try {
        const result = await this.#sendOnce(request);
        const retryable = result.status === 429 || result.status >= 500;
        if (!retryable || attempt === 2) return result;
      } catch (error) {
        if (attempt === 2) throw error;
      }
      await NodeTimersPromises.setTimeout(250 * 2 ** attempt);
      return sendAttempt(attempt + 1);
    };
    return sendAttempt(0);
  }

  sendNotification(input: NotificationInput): Promise<ApnsResult> {
    return this.#send(makeNotificationRequest(this.#config, input));
  }

  sendLiveActivity(input: LiveActivityInput): Promise<ApnsResult> {
    return this.#send(makeLiveActivityRequest(this.#config, input));
  }
}

export function makeNotificationRequest(
  config: RelayConfig["apns"],
  input: NotificationInput,
): ApnsPreparedRequest {
  return {
    token: input.token,
    topic: input.bundleId ?? config.bundleId,
    pushType: "alert",
    priority: "10",
    environment: input.environment ?? config.environment,
    collapseId: NodeCrypto.createHash("sha256")
      .update(`${input.state.environmentId}:${input.state.threadId}`)
      .digest("hex"),
    payload: {
      aps: {
        alert: {
          title: input.state.threadTitle,
          body: `${statusForPhase(input.state.phase)}: ${input.state.projectTitle}`,
        },
        sound: "default",
      },
      environmentId: input.state.environmentId,
      threadId: input.state.threadId,
      deepLink: input.state.deepLink,
    },
  };
}

export function makeLiveActivityRequest(
  config: RelayConfig["apns"],
  input: LiveActivityInput,
  now = Date.now(),
): ApnsPreparedRequest {
  const timestamp = Math.floor(now / 1_000);
  const event = input.aggregate?.activeCount ? "update" : "end";
  const contentState = input.aggregate
    ? { "content-state": { name: "AgentActivity", props: JSON.stringify(input.aggregate) } }
    : {};
  return {
    token: input.token,
    topic: `${input.bundleId ?? config.bundleId}.push-type.liveactivity`,
    pushType: "liveactivity",
    priority: event === "update" && input.alert === null ? "5" : "10",
    environment: input.environment ?? config.environment,
    payload: {
      aps:
        event === "update"
          ? {
              timestamp,
              event,
              ...contentState,
              "stale-date": timestamp + 10 * 60,
              ...(input.alert ? { alert: { ...input.alert, sound: "default" } } : {}),
            }
          : {
              timestamp,
              event,
              ...contentState,
              "dismissal-date": timestamp + (input.aggregate ? 5 * 60 : 15),
              ...(input.alert ? { alert: { ...input.alert, sound: "default" } } : {}),
            },
    },
  };
}

function statusForPhase(phase: RelayAgentActivityState["phase"]): string {
  switch (phase) {
    case "waiting_for_approval":
      return "Approval needed";
    case "waiting_for_input":
      return "Input needed";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "starting":
      return "Connecting";
    case "running":
      return "Working";
    case "stale":
      return "Waiting";
  }
}

export function shouldNotify(input: {
  readonly state: RelayAgentActivityState | null;
  readonly previous: RelayAgentActivityAggregateState | null;
  readonly preferences: RelayAgentAwarenessPreferences;
}): boolean {
  const state = input.state;
  if (!state || !input.preferences.notificationsEnabled) return false;
  const previousPhase = input.previous?.activities.find(
    (row) => row.environmentId === state.environmentId && row.threadId === state.threadId,
  )?.phase;
  if (previousPhase === state.phase) return false;
  switch (state.phase) {
    case "waiting_for_approval":
      return input.preferences.notifyOnApproval;
    case "waiting_for_input":
      return input.preferences.notifyOnInput;
    case "completed":
      return input.preferences.notifyOnCompletion;
    case "failed":
      return input.preferences.notifyOnFailure;
    default:
      return false;
  }
}

export function liveActivityAlert(input: {
  readonly state: RelayAgentActivityState | null;
  readonly previous: RelayAgentActivityAggregateState | null;
  readonly preferences: RelayAgentAwarenessPreferences;
}): { readonly title: string; readonly body: string } | null {
  if (!shouldNotify(input) || !input.state) return null;
  return {
    title: input.state.threadTitle,
    body: `${statusForPhase(input.state.phase)}: ${input.state.projectTitle}`,
  };
}
