/**
 * 全局保活管理器 - 解决跨路由保活问题
 * 使用全局状态保存每个场景的组件实例和数据
 */

import React, { createContext, useContext, useRef } from 'react';

interface CacheItem {
  component: React.ReactNode;
  timestamp: number;
}

interface GlobalKeepAliveManager {
  cache: Map<string, CacheItem>;
  set(key: string, component: React.ReactNode): void;
  get(key: string): React.ReactNode | undefined;
  has(key: string): boolean;
  delete(key: string): void;
  clear(): void;
}

export const GlobalKeepAliveContext =
  createContext<GlobalKeepAliveManager | null>(null);

/**
 * 创建全局保活管理器
 */
function createGlobalKeepAliveManager(): GlobalKeepAliveManager {
  return {
    cache: new Map(),
    set(key: string, component: React.ReactNode) {
      this.cache.set(key, {
        component,
        timestamp: Date.now(),
      });
    },
    get(key: string) {
      return this.cache.get(key)?.component;
    },
    has(key: string) {
      return this.cache.has(key);
    },
    delete(key: string) {
      this.cache.delete(key);
    },
    clear() {
      this.cache.clear();
    },
  };
}

/**
 * 全局保活提供者
 */
export function GlobalKeepAliveProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const managerRef = useRef(createGlobalKeepAliveManager());

  return (
    <GlobalKeepAliveContext.Provider value={managerRef.current}>
      {children}
    </GlobalKeepAliveContext.Provider>
  );
}

/**
 * 使用全局保活管理器
 */
export function useGlobalKeepAlive(): GlobalKeepAliveManager {
  const manager = useContext(GlobalKeepAliveContext);
  if (!manager) {
    throw new Error(
      'useGlobalKeepAlive must be used within GlobalKeepAliveProvider',
    );
  }
  return manager;
}
