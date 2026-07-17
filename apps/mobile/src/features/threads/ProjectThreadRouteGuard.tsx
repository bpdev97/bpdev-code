import { isGenericChatThread } from "@t3tools/shared/genericChat";
import type { ComponentType } from "react";
import { View } from "react-native";

import { EmptyState } from "../../components/EmptyState";
import { useThreadSelection } from "../../state/use-thread-selection";

export function withProjectThreadRouteGuard<TProps extends object>(
  Screen: ComponentType<TProps>,
  resourceName: string,
): ComponentType<TProps> {
  return function ProjectThreadRouteGuard(props: TProps) {
    const { selectedThread } = useThreadSelection();

    if (isGenericChatThread(selectedThread)) {
      return (
        <View className="flex-1 items-center justify-center bg-screen px-6">
          <EmptyState
            variant="plain"
            title={`${resourceName} unavailable`}
            detail="General chats are not attached to a project or working directory."
          />
        </View>
      );
    }

    return <Screen {...props} />;
  };
}
