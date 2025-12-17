import { createContext } from 'react';

export interface IChatKeepAliveManager {
  // 注册一个场景的 Chat 实例
  registerChatInstance: (scenario: string, instanceRef: any) => void;
  // 获取一个场景的 Chat 实例
  getChatInstance: (scenario: string) => any;
  // 卸载时清理
  unregisterChatInstance: (scenario: string) => void;
  // 获取所有活跃的场景
  getActiveScenarios: () => string[];
}

export const ChatKeepAliveContext = createContext<IChatKeepAliveManager | null>(
  null,
);
