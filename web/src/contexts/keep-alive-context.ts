/**
 * Keep-Alive Context - 用于保持多个路由页面的组件实例
 * 防止页面切换时组件被卸载，从而保留状态和计时器
 */

import { createContext, ReactNode } from 'react';

export interface KeepAliveRoute {
  /** 唯一路由标识，通常是完整的 pathname + search */
  path: string;
  /** 组件实例 */
  component: ReactNode;
  /** 是否是当前激活的路由 */
  isActive: boolean;
}

export interface KeepAliveManager {
  /** 注册一个需要保活的路由 */
  register(path: string, component: ReactNode): void;
  /** 注销一个路由 */
  unregister(path: string): void;
  /** 获取指定路由的组件 */
  getComponent(path: string): ReactNode | undefined;
  /** 获取所有保活路由 */
  getAllRoutes(): KeepAliveRoute[];
  /** 设置当前激活的路由 */
  setActivePath(path: string): void;
  /** 获取当前激活的路由 */
  getActivePath(): string;
}

export const KeepAliveContext = createContext<KeepAliveManager | null>(null);

/**
 * 创建 Keep-Alive 管理器实例
 */
export function createKeepAliveManager(): KeepAliveManager {
  const routes = new Map<string, ReactNode>();
  let activePath = '';

  return {
    register(path: string, component: ReactNode) {
      routes.set(path, component);
    },

    unregister(path: string) {
      routes.delete(path);
    },

    getComponent(path: string): ReactNode | undefined {
      return routes.get(path);
    },

    getAllRoutes(): KeepAliveRoute[] {
      return Array.from(routes.entries()).map(([path, component]) => ({
        path,
        component,
        isActive: path === activePath,
      }));
    },

    setActivePath(path: string) {
      activePath = path;
    },

    getActivePath(): string {
      return activePath;
    },
  };
}
