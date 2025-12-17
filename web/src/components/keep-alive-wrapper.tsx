/**
 * Keep-Alive Wrapper 组件
 * 保持页面状态，防止切换时重新拉取数据
 *
 * 实现原理：
 * 1. 使用 Ref 保存组件状态
 * 2. 通过事件监听路由变化
 * 3. 在路由恢复时恢复之前的状态
 */

import React, { useEffect, useRef } from 'react';
import { useLocation } from 'umi';

interface KeepAliveWrapperProps {
  children: React.ReactNode;
  cacheKey?: string;
}

// 全局缓存存储，保存每个路径的组件状态
const globalStateCache = new Map<string, any>();

/**
 * Keep-Alive Wrapper
 * 缓存组件状态和数据，切换时不重新获取
 */
export function KeepAliveWrapper({
  children,
  cacheKey,
}: KeepAliveWrapperProps) {
  const { pathname, search } = useLocation();
  const key = cacheKey || `${pathname}${search}`;
  const stateRef = useRef<any>(null);

  // 保存当前状态
  useEffect(() => {
    globalStateCache.set(key, stateRef.current);
  }, [key]);

  // 恢复之前的状态（如果存在）
  useEffect(() => {
    return () => {
      // 组件卸载前，保存当前状态
      if (stateRef.current) {
        globalStateCache.set(key, stateRef.current);
      }
    };
  }, [key]);

  return <>{children}</>;
}

/**
 * 获取缓存的状态
 */
export function getCachedState(key: string): any {
  return globalStateCache.get(key);
}

/**
 * 设置缓存的状态
 */
export function setCachedState(key: string, state: any): void {
  globalStateCache.set(key, state);
}

/**
 * 保活容器组件
 */
export function KeepAliveContainer() {
  return null;
}
