/**
 * Keep-Alive Hook - 提供在组件中使用 Keep-Alive 功能的接口
 */

import {
  KeepAliveContext,
  KeepAliveManager,
} from '@/contexts/keep-alive-context';
import { useContext, useEffect } from 'react';

/**
 * 使用 Keep-Alive 管理器
 * @throws 如果在 KeepAliveProvider 外部使用会抛出错误
 */
export function useKeepAlive(): KeepAliveManager {
  const manager = useContext(KeepAliveContext);

  if (!manager) {
    throw new Error(
      'useKeepAlive must be used within a KeepAliveProvider component',
    );
  }

  return manager;
}

/**
 * 注册一个路由页面以保活
 * @param path - 完整的路由路径（包含 query 参数）
 * @param component - 要保活的组件实例
 */
export function useRegisterKeepAlive(path: string, component: React.ReactNode) {
  const manager = useKeepAlive();

  useEffect(() => {
    manager.register(path, component);

    return () => {
      // 不主动卸载，让组件保活
    };
  }, [path, component, manager]);
}
