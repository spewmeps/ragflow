import { ReactNode, useCallback, useState } from 'react';
import {
  ChatKeepAliveContext,
  IChatKeepAliveManager,
} from './chat-keep-alive-context';

/**
 * 全局 Chat Keep-Alive 提供者
 * 维护三个场景（问一问、顶会洞察、深度研究）的 Chat 组件实例
 * 确保它们始终在内存中，不会因为路由切换而卸载
 */
export function ChatKeepAliveProvider({ children }: { children: ReactNode }) {
  const [instances, setInstances] = useState<Record<string, any>>({});

  const manager: IChatKeepAliveManager = {
    registerChatInstance: useCallback((scenario: string, instanceRef: any) => {
      setInstances((prev) => ({
        ...prev,
        [scenario]: instanceRef,
      }));
    }, []),

    getChatInstance: useCallback(
      (scenario: string) => {
        return instances[scenario];
      },
      [instances],
    ),

    unregisterChatInstance: useCallback((scenario: string) => {
      setInstances((prev) => {
        const newInstances = { ...prev };
        delete newInstances[scenario];
        return newInstances;
      });
    }, []),

    getActiveScenarios: useCallback(() => {
      return Object.keys(instances);
    }, [instances]),
  };

  return (
    <ChatKeepAliveContext.Provider value={manager}>
      {children}
    </ChatKeepAliveContext.Provider>
  );
}
