import { StackActions, useNavigation } from "@react-navigation/native";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { isGenericChatThread } from "@t3tools/shared/genericChat";
import { useCallback, useMemo, useSyncExternalStore, type PropsWithChildren } from "react";

import { T3KeyboardCommands } from "../../native/T3KeyboardCommands";
import { useThreadShell } from "../../state/entities";
import {
  dispatchHardwareKeyboardCommand,
  getHardwareKeyboardCommandRegistrationVersion,
  getRegisteredHardwareKeyboardCommands,
  parseActiveThreadPath,
  subscribeToHardwareKeyboardCommandRegistrations,
  type HardwareKeyboardCommand,
} from "./hardwareKeyboardCommands";

export function HardwareKeyboardCommandProvider({
  children,
  pathname,
}: PropsWithChildren<{ readonly pathname: string }>) {
  const navigation = useNavigation();
  const activeThread = useMemo(() => parseActiveThreadPath(pathname), [pathname]);
  const activeThreadRef = useMemo<ScopedThreadRef | null>(() => {
    if (activeThread === null) {
      return null;
    }
    return {
      environmentId: EnvironmentId.make(activeThread.environmentId),
      threadId: ThreadId.make(activeThread.threadId),
    };
  }, [activeThread]);
  const activeThreadShell = useThreadShell(activeThreadRef);
  const activeThreadSupportsProjectTools =
    activeThread !== null && activeThreadShell !== null && !isGenericChatThread(activeThreadShell);
  const registrationVersion = useSyncExternalStore(
    subscribeToHardwareKeyboardCommandRegistrations,
    getHardwareKeyboardCommandRegistrationVersion,
    getHardwareKeyboardCommandRegistrationVersion,
  );
  const enabledCommands = useMemo(() => {
    const commands = new Set<HardwareKeyboardCommand>(getRegisteredHardwareKeyboardCommands());
    commands.add("newTask");
    if (pathname !== "/" || navigation.canGoBack()) commands.add("back");
    if (activeThreadSupportsProjectTools) {
      commands.add("files");
      commands.add("terminal");
      commands.add("review");
    }
    return [...commands];
  }, [activeThreadSupportsProjectTools, pathname, registrationVersion, navigation]);

  const onCommand = useCallback(
    (command: HardwareKeyboardCommand) => {
      if (dispatchHardwareKeyboardCommand(command)) return;

      if (command === "newTask") {
        navigation.navigate("NewTaskSheet", { screen: "NewTask" });
        return;
      }
      if (command === "back") {
        if (navigation.canGoBack()) {
          navigation.goBack();
        } else {
          navigation.dispatch(StackActions.replace("Home"));
        }
        return;
      }

      if (!activeThreadSupportsProjectTools || !activeThread) return;
      if (command === "files" && !/\/files(?:\/|$)/.test(pathname)) {
        navigation.navigate("ThreadFiles", activeThread);
      }
      if (command === "terminal" && !/\/terminal(?:\/|$)/.test(pathname)) {
        navigation.navigate("ThreadTerminal", activeThread);
      }
      if (command === "review" && !/\/review(?:\/|$)/.test(pathname)) {
        navigation.navigate("ThreadReview", activeThread);
      }
    },
    [activeThread, activeThreadSupportsProjectTools, pathname, navigation],
  );

  return (
    <T3KeyboardCommands enabledCommands={enabledCommands} onCommand={onCommand}>
      {children}
    </T3KeyboardCommands>
  );
}
