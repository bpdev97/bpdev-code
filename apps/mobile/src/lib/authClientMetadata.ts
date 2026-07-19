import type { AuthClientPresentationMetadata } from "@t3tools/contracts";
import { Platform } from "react-native";
import { APP_NAME } from "../branding";

export function authClientMetadata(): AuthClientPresentationMetadata {
  return {
    label: `${APP_NAME} Mobile`,
    deviceType: "mobile",
    ...(Platform.OS === "ios" ? { os: "iOS" } : Platform.OS === "android" ? { os: "Android" } : {}),
  };
}
