/**
 * Keep-Alive Provider 组件
 */

import React, { useMemo } from 'react';
import { createKeepAliveManager, KeepAliveContext } from './keep-alive-context';

interface KeepAliveProviderProps {
  children: React.ReactNode;
}

/**
 * Keep-Alive 提供者组件
 * 用于在应用中启用路由组件的保活机制
 */
export function KeepAliveProvider({ children }: KeepAliveProviderProps) {
  const manager = useMemo(() => createKeepAliveManager(), []);

  return (
    <KeepAliveContext.Provider value={manager}>
      {children}
    </KeepAliveContext.Provider>
  );
}
