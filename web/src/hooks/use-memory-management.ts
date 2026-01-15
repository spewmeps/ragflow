/**
 * 内存监测和自动优化系统
 *
 * 功能：
 * 1. 实时监测内存使用
 * 2. 达到阈值时自动触发垃圾回收
 * 3. 清理过期消息和缓存
 * 4. 降级渲染模式（虚拟列表 -> 分页）
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface MemoryStats {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
  usedPercent: number;
  timestamp: number;
}

export interface MemoryThresholds {
  warning: number; // 80% 触发警告
  critical: number; // 90% 触发紧急模式
  cleanup: number; // 95% 触发强制清理
}

const DEFAULT_THRESHOLDS: MemoryThresholds = {
  warning: 0.8,
  critical: 0.9,
  cleanup: 0.95,
};

/**
 * 内存监测Hook
 */
export const useMemoryMonitor = (
  thresholds: MemoryThresholds = DEFAULT_THRESHOLDS,
  checkInterval: number = 5000, // 每5秒检查一次
) => {
  const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);
  const [memoryLevel, setMemoryLevel] = useState<
    'normal' | 'warning' | 'critical' | 'cleanup'
  >('normal');
  const monitorRef = useRef<NodeJS.Timeout | null>(null);
  const callbacksRef = useRef<Map<string, (level: typeof memoryLevel) => void>>(
    new Map(),
  );

  /**
   * 获取当前内存统计
   */
  const getMemoryStats = useCallback((): MemoryStats | null => {
    if (!performance.memory) {
      console.warn('Memory API not available');
      return null;
    }

    const stats: MemoryStats = {
      usedJSHeapSize: performance.memory.usedJSHeapSize,
      totalJSHeapSize: performance.memory.totalJSHeapSize,
      jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
      usedPercent:
        performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit,
      timestamp: Date.now(),
    };

    return stats;
  }, []);

  /**
   * 判断内存等级
   */
  const getMemoryLevel = useCallback(
    (usedPercent: number) => {
      if (usedPercent >= thresholds.cleanup) return 'cleanup';
      if (usedPercent >= thresholds.critical) return 'critical';
      if (usedPercent >= thresholds.warning) return 'warning';
      return 'normal';
    },
    [thresholds],
  );

  /**
   * 强制垃圾回收
   */
  const forceGC = useCallback(() => {
    if (typeof global !== 'undefined' && global.gc) {
      console.log('[Memory] Forcing garbage collection...');
      global.gc();
      // 延迟后再检查
      setTimeout(() => {
        const stats = getMemoryStats();
        if (stats) {
          setMemoryStats(stats);
          const level = getMemoryLevel(stats.usedPercent);
          setMemoryLevel(level);
        }
      }, 100);
    } else {
      console.warn(
        '[Memory] GC not available. Run Node/Chrome with --expose-gc flag',
      );
    }
  }, [getMemoryStats, getMemoryLevel]);

  /**
   * 注册内存变化回调
   */
  const onMemoryLevelChange = useCallback(
    (id: string, callback: (level: typeof memoryLevel) => void) => {
      callbacksRef.current.set(id, callback);
      return () => {
        callbacksRef.current.delete(id);
      };
    },
    [],
  );

  /**
   * 启动监测
   */
  const startMonitoring = useCallback(() => {
    if (monitorRef.current) return;

    monitorRef.current = setInterval(() => {
      const stats = getMemoryStats();
      if (!stats) return;

      setMemoryStats(stats);
      const newLevel = getMemoryLevel(stats.usedPercent);

      if (newLevel !== memoryLevel) {
        setMemoryLevel(newLevel);

        // 触发回调
        callbacksRef.current.forEach((callback) => {
          callback(newLevel);
        });

        // 输出日志
        const levelColors = {
          normal: '✅',
          warning: '⚠️ ',
          critical: '🔴',
          cleanup: '💀',
        };

        console.log(
          `${levelColors[newLevel]} Memory Level: ${newLevel} (${(
            stats.usedPercent * 100
          ).toFixed(
            1,
          )}% / ${(stats.jsHeapSizeLimit / 1024 / 1024).toFixed(0)}MB)`,
        );

        // 达到临界值时自动GC
        if (newLevel === 'critical' || newLevel === 'cleanup') {
          forceGC();
        }
      }
    }, checkInterval);
  }, [checkInterval, getMemoryLevel, getMemoryStats, memoryLevel, forceGC]);

  /**
   * 停止监测
   */
  const stopMonitoring = useCallback(() => {
    if (monitorRef.current) {
      clearInterval(monitorRef.current);
      monitorRef.current = null;
    }
  }, []);

  /**
   * 组件卸载时停止监测
   */
  useEffect(() => {
    return () => {
      stopMonitoring();
    };
  }, [stopMonitoring]);

  return {
    memoryStats,
    memoryLevel,
    getMemoryStats,
    getMemoryLevel,
    forceGC,
    startMonitoring,
    stopMonitoring,
    onMemoryLevelChange,
  };
};

/**
 * 清理器Hook - 自动清理过期数据
 */
export const useAutoCleanup = (
  memoryLevel: 'normal' | 'warning' | 'critical' | 'cleanup',
) => {
  const cleanupCallbacksRef = useRef<Map<string, () => void>>(new Map());

  /**
   * 注册清理回调
   */
  const registerCleanup = useCallback(
    (
      id: string,
      callback: () => void,
      triggerLevel: typeof memoryLevel = 'warning',
    ) => {
      cleanupCallbacksRef.current.set(id, callback);
      return () => {
        cleanupCallbacksRef.current.delete(id);
      };
    },
    [],
  );

  /**
   * 执行所有清理回调
   */
  const executeCleanup = useCallback((urgency: 'normal' | 'aggressive') => {
    console.log(`[Cleanup] Executing ${urgency} cleanup...`);
    cleanupCallbacksRef.current.forEach((callback) => {
      try {
        callback();
      } catch (e) {
        console.error('[Cleanup] Error during cleanup:', e);
      }
    });
  }, []);

  /**
   * 根据内存等级自动清理
   */
  useEffect(() => {
    if (memoryLevel === 'warning') {
      console.log(
        '[AutoCleanup] Warning level reached, starting gentle cleanup...',
      );
      executeCleanup('normal');
    } else if (memoryLevel === 'critical') {
      console.log(
        '[AutoCleanup] Critical level reached, starting aggressive cleanup...',
      );
      executeCleanup('aggressive');
    }
  }, [memoryLevel, executeCleanup]);

  return {
    registerCleanup,
    executeCleanup,
  };
};

/**
 * 消息缓存清理器
 */
export const useMessageCacheCleanup = (
  messages: any[],
  maxCacheSize: number = 5000, // 最多保留5000条消息
) => {
  const cleanup = useCallback(() => {
    if (messages.length > maxCacheSize) {
      const excessCount = messages.length - maxCacheSize;
      console.log(`[MessageCache] Removing ${excessCount} excess messages`);
      // 返回清理函数
      return () => {
        // 由调用者实现具体的清理逻辑
      };
    }
  }, [messages.length, maxCacheSize]);

  return { cleanup };
};

/**
 * 渲染模式降级器
 * 当内存高时自动切换到更高效的渲染模式
 */
export const useRenderModeDowngrade = () => {
  const [renderMode, setRenderMode] = useState<
    'normal' | 'virtual' | 'paginated'
  >('normal');

  const downgradeRenderMode = useCallback(() => {
    setRenderMode((prev) => {
      if (prev === 'normal') return 'virtual';
      if (prev === 'virtual') return 'paginated';
      return prev;
    });
    console.log(`[RenderMode] Downgraded to: ${renderMode}`);
  }, [renderMode]);

  const upgradeRenderMode = useCallback(() => {
    setRenderMode((prev) => {
      if (prev === 'paginated') return 'virtual';
      if (prev === 'virtual') return 'normal';
      return prev;
    });
    console.log(`[RenderMode] Upgraded to: ${renderMode}`);
  }, [renderMode]);

  return {
    renderMode,
    downgradeRenderMode,
    upgradeRenderMode,
  };
};

/**
 * 完整的内存管理系统
 */
export const useMemoryManagementSystem = (options?: {
  thresholds?: MemoryThresholds;
  checkInterval?: number;
  maxCacheSize?: number;
}) => {
  const {
    thresholds = DEFAULT_THRESHOLDS,
    checkInterval = 5000,
    maxCacheSize = 5000,
  } = options || {};

  const {
    memoryStats,
    memoryLevel,
    getMemoryStats,
    forceGC,
    startMonitoring,
    stopMonitoring,
    onMemoryLevelChange,
  } = useMemoryMonitor(thresholds, checkInterval);

  const { registerCleanup, executeCleanup } = useAutoCleanup(memoryLevel);
  const { renderMode, downgradeRenderMode, upgradeRenderMode } =
    useRenderModeDowngrade();

  /**
   * 根据内存等级自动调整
   */
  useEffect(() => {
    if (memoryLevel === 'warning') {
      console.log('[MemorySystem] Memory warning - switching to virtual list');
      downgradeRenderMode();
    } else if (memoryLevel === 'critical' || memoryLevel === 'cleanup') {
      console.log('[MemorySystem] Memory critical - switching to pagination');
      downgradeRenderMode();
    } else if (memoryLevel === 'normal') {
      console.log('[MemorySystem] Memory normal - returning to normal mode');
      upgradeRenderMode();
    }
  }, [memoryLevel, downgradeRenderMode, upgradeRenderMode]);

  return {
    // 状态
    memoryStats,
    memoryLevel,
    renderMode,

    // 方法
    getMemoryStats,
    forceGC,
    startMonitoring,
    stopMonitoring,
    onMemoryLevelChange,
    registerCleanup,
    executeCleanup,
    downgradeRenderMode,
    upgradeRenderMode,
  };
};
