import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as NodeOS from "node:os";

import { PERSONAL_DISTRIBUTION } from "../../../downstream/config.ts";
import { resolveBaseDir } from "./os-jank.ts";

it.layer(NodeServices.layer)("resolveBaseDir", (it) => {
  it.effect("uses the personal distribution state home by default", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const baseDir = yield* resolveBaseDir(undefined);

      assert.equal(
        baseDir,
        path.join(NodeOS.homedir(), PERSONAL_DISTRIBUTION.macos.stateHomeDirectoryName),
      );
    }),
  );
});
