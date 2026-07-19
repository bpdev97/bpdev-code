export interface HermesGatewayEvent {
  readonly type: string;
  readonly session_id?: string;
  readonly payload?: unknown;
}

export interface HermesGatewayRpcErrorShape {
  readonly code?: number;
  readonly message?: string;
  readonly data?: unknown;
}

export class HermesGatewayRpcError extends Error {
  readonly code: number | undefined;
  readonly data: unknown;

  constructor(method: string, error: HermesGatewayRpcErrorShape) {
    super(error.message?.trim() || `Hermes gateway request failed: ${method}`);
    this.name = "HermesGatewayRpcError";
    this.code = error.code;
    this.data = error.data;
  }
}

interface JsonRpcFrame {
  readonly id?: string | number | null;
  readonly method?: string;
  readonly params?: HermesGatewayEvent;
  readonly result?: unknown;
  readonly error?: HermesGatewayRpcErrorShape;
}

interface PendingRequest {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (cause: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export interface HermesWebSocketLike {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: HermesWebSocketEvent) => void): void;
  removeEventListener(type: string, listener: (event: HermesWebSocketEvent) => void): void;
  send(data: string): void;
  close(): void;
}

export interface HermesWebSocketEvent {
  readonly data?: unknown;
}

export interface HermesGatewayClientOptions {
  readonly connectTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly socketFactory?: (url: string) => HermesWebSocketLike;
}

export interface HermesGatewayConnection {
  request<T>(method: string, params?: Readonly<Record<string, unknown>>): Promise<T>;
  close(): void;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

export class HermesGatewayClient implements HermesGatewayConnection {
  readonly #eventHandler: (event: HermesGatewayEvent) => void;
  readonly #options: {
    readonly connectTimeoutMs: number;
    readonly requestTimeoutMs: number;
    readonly socketFactory: ((url: string) => HermesWebSocketLike) | undefined;
  };
  #nextId = 0;
  #socket: HermesWebSocketLike | undefined;
  #pending = new Map<string | number, PendingRequest>();

  constructor(
    eventHandler: (event: HermesGatewayEvent) => void,
    options: HermesGatewayClientOptions = {},
  ) {
    this.#eventHandler = eventHandler;
    this.#options = {
      connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      socketFactory: options.socketFactory,
    };
  }

  async connect(url: string): Promise<void> {
    if (this.#socket) return;
    const socket = this.#options.socketFactory?.(url) ?? new WebSocket(url);
    this.#socket = socket;

    const ready = new Promise<void>((resolve, reject) => {
      let opened = false;
      let gatewayReady = false;
      // @effect-diagnostics-next-line globalTimers:off - Promise WebSocket boundary.
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for the Hermes gateway to become ready."));
        this.close();
      }, this.#options.connectTimeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
      };
      const settle = () => {
        if (!opened || !gatewayReady) return;
        cleanup();
        resolve();
      };
      const onOpen = () => {
        opened = true;
        settle();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Could not connect to the Hermes gateway."));
      };

      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onError);
      socket.addEventListener("message", (event) => {
        const frame = this.#parseFrame(event.data);
        if (frame?.method === "event" && frame.params?.type === "gateway.ready") {
          gatewayReady = true;
          settle();
        }
        this.#handleFrame(frame);
      });
      socket.addEventListener("close", () => {
        if (this.#socket === socket) this.#socket = undefined;
        const cause = new Error("Hermes gateway connection closed.");
        cleanup();
        reject(cause);
        this.#rejectPending(cause);
      });
    });
    await ready;
  }

  request<T>(method: string, params: Readonly<Record<string, unknown>> = {}): Promise<T> {
    const socket = this.#socket;
    if (!socket || socket.readyState !== 1) {
      return Promise.reject(new Error("Hermes gateway is not connected."));
    }
    const id = `t3-${++this.#nextId}`;
    return new Promise<T>((resolve, reject) => {
      // @effect-diagnostics-next-line globalTimers:off - Promise WebSocket boundary.
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Hermes gateway request timed out: ${method}`));
      }, this.#options.requestTimeoutMs);
      this.#pending.set(id, {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      try {
        socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      } catch (cause) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(cause);
      }
    });
  }

  close(): void {
    const socket = this.#socket;
    this.#socket = undefined;
    socket?.close();
    this.#rejectPending(new Error("Hermes gateway connection closed."));
  }

  #parseFrame(data: unknown): JsonRpcFrame | undefined {
    try {
      return JSON.parse(typeof data === "string" ? data : String(data)) as JsonRpcFrame;
    } catch {
      return undefined;
    }
  }

  #handleFrame(frame: JsonRpcFrame | undefined): void {
    if (!frame) return;
    if (frame.method === "event" && frame.params) {
      this.#eventHandler(frame.params);
      return;
    }
    if (frame.id === undefined || frame.id === null) return;
    const pending = this.#pending.get(frame.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(frame.id);
    if (frame.error) pending.reject(new HermesGatewayRpcError(pending.method, frame.error));
    else pending.resolve(frame.result);
  }

  #rejectPending(cause: unknown): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(cause);
    }
    this.#pending.clear();
  }
}
