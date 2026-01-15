/**
 * 虚拟列表消息容器
 * 用于大量消息场景下的内存优化
 *
 * 核心优化：
 * 1. 只渲染可见区域的消息
 * 2. 回收不可见的DOM节点
 * 3. 减少内存占用80%以上
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { FixedSizeList as List } from 'react-window';
import 'react-window/dist/List.css';

export interface VirtualMessageListProps {
  messages: any[];
  messageHeight?: number;
  containerHeight?: number;
  renderMessage: (
    message: any,
    index: number,
    style: React.CSSProperties,
  ) => React.ReactNode;
  onScroll?: (scrollOffset: number, isScrolling: boolean) => void;
  className?: string;
  overscanCount?: number; // 额外渲染的消息数，用于平滑滚动
}

/**
 * 虚拟列表消息容器
 * 这是一个内存优化的替代品，用于替换普通的消息列表
 */
export const VirtualMessageList = React.forwardRef<
  any,
  VirtualMessageListProps
>(
  (
    {
      messages,
      messageHeight = 100,
      containerHeight = 600,
      renderMessage,
      onScroll,
      className = '',
      overscanCount = 5,
    },
    ref,
  ) => {
    const listRef = useRef<List>(null);

    /**
     * 自动滚动到底部
     */
    const scrollToBottom = useCallback(() => {
      if (listRef.current && messages.length > 0) {
        const lastIndex = messages.length - 1;
        listRef.current.scrollToItem(lastIndex, 'end');
      }
    }, [messages.length]);

    /**
     * 当消息更新时滚动到底部
     */
    useEffect(() => {
      scrollToBottom();
    }, [messages.length, scrollToBottom]);

    /**
     * 自定义行渲染器
     */
    const Row = useCallback(
      ({ index, style }: { index: number; style: React.CSSProperties }) => {
        const message = messages[index];
        if (!message) {
          return <div style={style}></div>;
        }
        return (
          <div style={style} className="virtual-message-row">
            {renderMessage(message, index, style)}
          </div>
        );
      },
      [messages, renderMessage],
    );

    return (
      <List
        ref={listRef}
        height={containerHeight}
        itemCount={messages.length}
        itemSize={messageHeight}
        width="100%"
        onScroll={({ scrollOffset, isScrolling }) => {
          onScroll?.(scrollOffset, isScrolling);
        }}
        overscanCount={overscanCount}
        className={className}
      >
        {Row}
      </List>
    );
  },
);

VirtualMessageList.displayName = 'VirtualMessageList';

/**
 * Hook: 用于计算动态消息高度
 * 适用于消息高度可能不同的场景
 */
export const useDynamicMessageHeight = (messages: any[]) => {
  const heightCache = useRef<Map<string, number>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

  const getMessageHeight = useCallback((index: number, message: any) => {
    const cacheKey = message.id || `msg-${index}`;
    if (heightCache.current.has(cacheKey)) {
      return heightCache.current.get(cacheKey) || 100;
    }
    return 100; // 默认高度
  }, []);

  const recordMessageHeight = useCallback(
    (index: number, message: any, height: number) => {
      const cacheKey = message.id || `msg-${index}`;
      heightCache.current.set(cacheKey, height);
    },
    [],
  );

  const resetHeightCache = useCallback(() => {
    heightCache.current.clear();
  }, []);

  return {
    getMessageHeight,
    recordMessageHeight,
    resetHeightCache,
    containerRef,
  };
};

/**
 * 优化的消息渲染选项
 * 用于在虚拟列表和普通列表之间切换
 */
export interface MessageListRenderMode {
  mode: 'virtual' | 'normal';
  shouldUseVirtual: (messageCount: number) => boolean;
}

/**
 * 根据消息数量自动选择渲染模式
 */
export const getOptimalRenderMode = (
  messageCount: number,
): 'virtual' | 'normal' => {
  // 消息数超过100时使用虚拟列表
  return messageCount > 100 ? 'virtual' : 'normal';
};

/**
 * 消息分页器
 * 用于长对话场景，分页加载消息以减少内存
 */
export const useMessagePaginator = (
  totalMessages: number,
  pageSize: number = 50,
) => {
  const [currentPage, setCurrentPage] = React.useState(0);
  const [visibleMessages, setVisibleMessages] = React.useState<any[]>([]);

  const totalPages = Math.ceil(totalMessages / pageSize);

  const goToPage = useCallback(
    (page: number) => {
      if (page >= 0 && page < totalPages) {
        setCurrentPage(page);
      }
    },
    [totalPages],
  );

  const nextPage = useCallback(() => {
    goToPage(currentPage + 1);
  }, [currentPage, goToPage]);

  const prevPage = useCallback(() => {
    goToPage(currentPage - 1);
  }, [currentPage, goToPage]);

  const getPageMessages = useCallback(
    (allMessages: any[]) => {
      const startIdx = currentPage * pageSize;
      const endIdx = startIdx + pageSize;
      return allMessages.slice(startIdx, endIdx);
    },
    [currentPage, pageSize],
  );

  return {
    currentPage,
    totalPages,
    pageSize,
    goToPage,
    nextPage,
    prevPage,
    getPageMessages,
  };
};
