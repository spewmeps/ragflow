/**
 * 激进式内存清理Hook - 终极方案
 *
 * 在高内存使用情况下强制释放资源
 * 每个流式请求完成后立即清理
 */

import { useCallback, useEffect, useRef } from 'react';

interface MemoryThreshold {
  warning: number; // 70% - 清理非关键缓存
  critical: number; // 85% - 清理所有缓存
  emergency: number; // 95% - 页面崩溃前的最后一搏
}

const DEFAULT_THRESHOLDS: MemoryThreshold = {
  warning: 0.7,
  critical: 0.85,
  emergency: 0.95,
};

/**
 * 检查内存使用百分比
 */
function getMemoryUsagePercent(): number {
  if (!performance || !(performance as any).memory) return 0;
  const memory = (performance as any).memory;
  return memory.usedJSHeapSize / memory.jsHeapSizeLimit;
}

/**
 * 强制垃圾回收
 */
function forceGarbageCollection() {
  if (typeof global !== 'undefined' && global.gc) {
    try {
      global.gc();
      console.log('[AggressiveCleanup] GC executed');
    } catch (e) {
      console.debug('[AggressiveCleanup] GC not available:', e);
    }
  }
}

/**
 * 清理DOM缓存和事件监听
 */
function cleanupDOMCache() {
  // 清理所有隐藏的iframe缓存
  document
    .querySelectorAll('iframe[style*="display:none"]')
    .forEach((iframe) => {
      (iframe as HTMLIFrameElement).src = '';
    });

  // 清理detached DOM nodes引用
  const orphaned = document.querySelectorAll('[data-orphaned="true"]');
  orphaned.forEach((node) => {
    node.remove();
  });

  console.log('[AggressiveCleanup] DOM cache cleared');
}

/**
 * 清理事件监听器
 */
function cleanupEventListeners() {
  // 这个方法的局限性：无法清理所有监听器，只能清理特定的
  // 需要应用层确保正确的cleanup
  console.log('[AggressiveCleanup] Event cleanup check');
}

/**
 * 清理本地存储临时数据
 */
function cleanupTemporaryData() {
  try {
    // 清理sessionStorage中的大型临时数据
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && (key.startsWith('_tmp_') || key.startsWith('cache_'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => sessionStorage.removeItem(key));
    console.log(
      `[AggressiveCleanup] Cleared ${keysToRemove.length} temp storage items`,
    );
  } catch (e) {
    console.debug('[AggressiveCleanup] Error cleaning storage:', e);
  }
}

/**
 * 清理所有缓存数据
 */
export function clearAllCaches() {
  forceGarbageCollection();
  cleanupDOMCache();
  cleanupEventListeners();
  cleanupTemporaryData();

  // 给浏览器时间进行垃圾回收
  return new Promise((resolve) => {
    setTimeout(() => {
      const newUsage = getMemoryUsagePercent();
      console.log(
        `[AggressiveCleanup] Memory after cleanup: ${(newUsage * 100).toFixed(1)}%`,
      );
      resolve(newUsage);
    }, 100);
  });
}

/**
 * 主要Hook - 持续监控并在需要时清理
 */
export const useAggressiveMemoryCleanup = (
  thresholds: MemoryThreshold = DEFAULT_THRESHOLDS,
  checkInterval: number = 3000,
) => {
  const monitorRef = useRef<NodeJS.Timeout | null>(null);
  const lastCleanupRef = useRef<number>(0);
  const cleanupCooldownRef = useRef<number>(1000); // 清理间隔最少1秒

  const cleanup = useCallback(async () => {
    const now = Date.now();
    if (now - lastCleanupRef.current < cleanupCooldownRef.current) {
      console.log('[AggressiveCleanup] Cleanup in cooldown');
      return;
    }

    const usage = getMemoryUsagePercent();

    if (usage >= thresholds.emergency) {
      console.warn(
        '[AggressiveCleanup] 🆘 EMERGENCY cleanup triggered!',
        `${(usage * 100).toFixed(1)}%`,
      );
      await clearAllCaches();
      lastCleanupRef.current = now;
      cleanupCooldownRef.current = 2000; // 加长冷却时间
    } else if (usage >= thresholds.critical) {
      console.warn(
        '[AggressiveCleanup] 🔴 CRITICAL cleanup triggered!',
        `${(usage * 100).toFixed(1)}%`,
      );
      forceGarbageCollection();
      cleanupDOMCache();
      lastCleanupRef.current = now;
      cleanupCooldownRef.current = 1500;
    } else if (usage >= thresholds.warning) {
      console.warn(
        '[AggressiveCleanup] ⚠️ WARNING cleanup triggered!',
        `${(usage * 100).toFixed(1)}%`,
      );
      forceGarbageCollection();
      lastCleanupRef.current = now;
      cleanupCooldownRef.current = 1000;
    }
  }, [thresholds]);

  useEffect(() => {
    monitorRef.current = setInterval(() => {
      cleanup();
    }, checkInterval);

    return () => {
      if (monitorRef.current) {
        clearInterval(monitorRef.current);
      }
    };
  }, [cleanup, checkInterval]);

  return { cleanup, getMemoryUsagePercent };
};

/**
 * 流式请求完成后的快速清理
 */
export const cleanupAfterStreamingRequest = async (delayMs: number = 500) => {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      clearAllCaches().then(() => resolve());
    }, delayMs);
  });
};

/**
 * 获取内存统计信息
 */
export function getMemoryStats() {
  if (!performance || !(performance as any).memory) return null;

  const memory = (performance as any).memory;
  return {
    used: (memory.usedJSHeapSize / 1024 / 1024).toFixed(2),
    total: (memory.totalJSHeapSize / 1024 / 1024).toFixed(2),
    limit: (memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2),
    percent: ((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100).toFixed(
      1,
    ),
  };
}
