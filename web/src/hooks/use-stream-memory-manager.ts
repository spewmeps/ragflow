/**
 * 流式数据内存管理Hook
 * 用于优化流式数据处理的内存占用
 *
 * 主要优化点：
 * 1. 自动清理Reader资源
 * 2. 限制缓冲区大小
 * 3. 及时清理解析器
 * 4. 实现内存监测和告警
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface MemoryUsage {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface StreamBuffer {
  chunks: string[];
  size: number;
  maxSize: number;
}

export const useStreamMemoryManager = () => {
  const readerRef = useRef<ReadableStreamDefaultReader | null>(null);
  const decoderRef = useRef<TextDecoder | null>(null);
  const bufferRef = useRef<StreamBuffer>({
    chunks: [],
    size: 0,
    maxSize: 5 * 1024 * 1024, // 5MB max buffer
  });
  const [memoryWarning, setMemoryWarning] = useState(false);

  /**
   * 获取当前内存使用情况
   */
  const getMemoryUsage = useCallback((): MemoryUsage | null => {
    if (!performance.memory) return null;
    return {
      usedJSHeapSize: performance.memory.usedJSHeapSize,
      totalJSHeapSize: performance.memory.totalJSHeapSize,
      jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
    };
  }, []);

  /**
   * 检查内存是否超过阈值
   */
  const checkMemoryThreshold = useCallback(
    (thresholdPercent = 0.8) => {
      const memory = getMemoryUsage();
      if (!memory) return false;
      return memory.usedJSHeapSize / memory.jsHeapSizeLimit > thresholdPercent;
    },
    [getMemoryUsage],
  );

  /**
   * 清理缓冲区
   */
  const clearBuffer = useCallback(() => {
    bufferRef.current.chunks = [];
    bufferRef.current.size = 0;
  }, []);

  /**
   * 添加数据块到缓冲区（带大小限制）
   */
  const addToBuffer = useCallback((chunk: string): boolean => {
    const chunkSize = new Blob([chunk]).size;
    const buffer = bufferRef.current;

    // 如果添加这个块会超过限制，触发清理
    if (buffer.size + chunkSize > buffer.maxSize) {
      console.warn('[StreamMemory] Buffer overflow, clearing old chunks');
      // 保留最新的数据，清理旧数据
      const recentChunks = buffer.chunks.slice(-10); // 保留最近10个块
      buffer.chunks = recentChunks;
      buffer.size = recentChunks.reduce(
        (sum, c) => sum + new Blob([c]).size,
        0,
      );

      // 如果仍然超过限制，返回false表示应该停止添加
      if (buffer.size + chunkSize > buffer.maxSize) {
        return false;
      }
    }

    buffer.chunks.push(chunk);
    buffer.size += chunkSize;
    return true;
  }, []);

  /**
   * 从缓冲区提取所有数据
   */
  const flushBuffer = useCallback((): string => {
    const data = bufferRef.current.chunks.join('');
    clearBuffer();
    return data;
  }, [clearBuffer]);

  /**
   * 创建高效的流式Reader
   */
  const createOptimizedStreamReader = useCallback(
    async (response: Response) => {
      // 清理旧的reader
      if (readerRef.current) {
        try {
          await readerRef.current.cancel();
        } catch (e) {
          console.debug('[StreamMemory] Error cancelling old reader:', e);
        }
        readerRef.current = null;
      }

      if (!response.body) return null;

      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();

      readerRef.current = reader;

      return {
        read: async () => {
          try {
            const { done, value } = await reader.read();

            // 内存使用监测
            if (checkMemoryThreshold(0.8)) {
              setMemoryWarning(true);
              console.warn('[StreamMemory] High memory usage detected!');
            } else {
              setMemoryWarning(false);
            }

            if (done) {
              return { done: true, value: null };
            }

            // 检查缓冲区容量
            if (!addToBuffer(value)) {
              console.warn(
                '[StreamMemory] Buffer limit reached, forcing flush',
              );
              return { done: false, value: flushBuffer() };
            }

            return { done: false, value };
          } catch (e) {
            if (e instanceof DOMException && e.name === 'AbortError') {
              console.log('[StreamMemory] Stream read aborted');
            } else {
              console.error('[StreamMemory] Stream read error:', e);
            }
            throw e;
          }
        },

        /**
         * 获取累积的数据
         */
        getAccumulatedData: () => {
          return bufferRef.current.chunks.join('');
        },

        /**
         * 清理资源
         */
        cleanup: async () => {
          try {
            if (reader) {
              await reader.cancel();
            }
            readerRef.current = null;
            clearBuffer();
          } catch (e) {
            console.debug('[StreamMemory] Error during cleanup:', e);
          }
        },
      };
    },
    [addToBuffer, checkMemoryThreshold, clearBuffer, flushBuffer],
  );

  /**
   * 清理所有资源
   */
  const cleanup = useCallback(async () => {
    try {
      if (readerRef.current) {
        await readerRef.current.cancel();
        readerRef.current = null;
      }
      clearBuffer();
      decoderRef.current = null;
    } catch (e) {
      console.debug('[StreamMemory] Cleanup error:', e);
    }
  }, [clearBuffer]);

  /**
   * 组件卸载时清理
   */
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    createOptimizedStreamReader,
    getMemoryUsage,
    checkMemoryThreshold,
    clearBuffer,
    flushBuffer,
    cleanup,
    memoryWarning,
  };
};
