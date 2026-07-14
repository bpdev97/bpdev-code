import * as NodeSqlite from "node:sqlite";
import type {
  RelayAgentActivityAggregateState,
  RelayAgentActivityState,
  RelayAgentAwarenessPreferences,
  RelayDeviceRegistrationRequest,
  RelayLiveActivityRegistrationRequest,
} from "@t3tools/contracts/relay";

import { makeAggregate } from "./aggregate.ts";

export interface DeliveryTarget {
  readonly deviceId: string;
  readonly pushToken: string | null;
  readonly activityPushToken: string | null;
  readonly bundleId: string | null;
  readonly apsEnvironment: "sandbox" | "production" | null;
  readonly preferences: RelayAgentAwarenessPreferences;
  readonly lastAggregate: RelayAgentActivityAggregateState | null;
}

interface DeviceRow {
  device_id: string;
  push_token: string | null;
  activity_push_token: string | null;
  bundle_id: string | null;
  aps_environment: "sandbox" | "production" | null;
  preferences_json: string;
  last_aggregate_json: string | null;
}

interface ActivityRow {
  state_json: string;
}

export class RelayStore {
  readonly #database: NodeSqlite.DatabaseSync;

  constructor(path: string) {
    this.#database = new NodeSqlite.DatabaseSync(path);
    this.#database.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    );
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        push_token TEXT,
        activity_push_token TEXT,
        bundle_id TEXT,
        aps_environment TEXT,
        preferences_json TEXT NOT NULL,
        last_aggregate_json TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS activities (
        environment_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (environment_id, thread_id)
      );
    `);
  }

  close(): void {
    this.#database.close();
  }

  registerDevice(input: RelayDeviceRegistrationRequest): void {
    this.#database
      .prepare(`
      INSERT INTO devices (
        device_id, label, push_token, bundle_id, aps_environment, preferences_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        label = excluded.label,
        push_token = excluded.push_token,
        bundle_id = excluded.bundle_id,
        aps_environment = excluded.aps_environment,
        preferences_json = excluded.preferences_json,
        updated_at = excluded.updated_at
    `)
      .run(
        input.deviceId,
        input.label,
        input.pushToken ?? null,
        input.bundleId ?? null,
        input.apsEnvironment ?? null,
        JSON.stringify(input.preferences),
        new Date().toISOString(),
      );
  }

  registerLiveActivity(input: RelayLiveActivityRegistrationRequest): boolean {
    const result = this.#database
      .prepare(`
      UPDATE devices SET activity_push_token = ?, last_aggregate_json = NULL, updated_at = ?
      WHERE device_id = ?
    `)
      .run(input.activityPushToken, new Date().toISOString(), input.deviceId);
    return result.changes > 0;
  }

  publish(input: {
    readonly environmentId: string;
    readonly threadId: string;
    readonly state: RelayAgentActivityState | null;
  }): void {
    if (input.state === null) {
      this.#database
        .prepare("DELETE FROM activities WHERE environment_id = ? AND thread_id = ?")
        .run(input.environmentId, input.threadId);
      return;
    }
    this.#database
      .prepare(`
      INSERT INTO activities (environment_id, thread_id, state_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(environment_id, thread_id) DO UPDATE SET
        state_json = excluded.state_json,
        updated_at = excluded.updated_at
    `)
      .run(input.environmentId, input.threadId, JSON.stringify(input.state), input.state.updatedAt);
  }

  aggregate(): RelayAgentActivityAggregateState | null {
    const rows = this.#database
      .prepare("SELECT state_json FROM activities")
      .all() as unknown as ActivityRow[];
    return makeAggregate(rows.map((row) => JSON.parse(row.state_json) as RelayAgentActivityState));
  }

  targets(): ReadonlyArray<DeliveryTarget> {
    const rows = this.#database
      .prepare(`
      SELECT device_id, push_token, activity_push_token, bundle_id, aps_environment,
             preferences_json, last_aggregate_json
      FROM devices
    `)
      .all() as unknown as DeviceRow[];
    return rows.map((row) => ({
      deviceId: row.device_id,
      pushToken: row.push_token,
      activityPushToken: row.activity_push_token,
      bundleId: row.bundle_id,
      apsEnvironment: row.aps_environment,
      preferences: JSON.parse(row.preferences_json) as RelayAgentAwarenessPreferences,
      lastAggregate: row.last_aggregate_json
        ? (JSON.parse(row.last_aggregate_json) as RelayAgentActivityAggregateState)
        : null,
    }));
  }

  target(deviceId: string): DeliveryTarget | null {
    return this.targets().find((target) => target.deviceId === deviceId) ?? null;
  }

  recordAggregate(deviceId: string, aggregate: RelayAgentActivityAggregateState | null): void {
    this.#database
      .prepare("UPDATE devices SET last_aggregate_json = ?, updated_at = ? WHERE device_id = ?")
      .run(aggregate ? JSON.stringify(aggregate) : null, new Date().toISOString(), deviceId);
  }

  clearPushToken(deviceId: string): void {
    this.#database
      .prepare("UPDATE devices SET push_token = NULL WHERE device_id = ?")
      .run(deviceId);
  }

  clearActivityToken(deviceId: string): void {
    this.#database
      .prepare(
        "UPDATE devices SET activity_push_token = NULL, last_aggregate_json = NULL WHERE device_id = ?",
      )
      .run(deviceId);
  }
}
