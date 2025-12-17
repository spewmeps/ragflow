import React, {
  CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
// @ts-expect-error react-window exports type
import { Message } from '@/interfaces/database/chat';
import { List as FixedSizeList } from 'react-window';

interface VirtualizedMessageListProps {
  messages: Message[];
  messageRenderer: (message: Message, index: number) => React.ReactNode;
  overscanCount?: number;
}

/**
 * 虚拟列表组件，用于优化长聊天列表性能
 * 自动计算容器高度，支持动态调整
 *
 * 关键特性：
 * 1. ResizeObserver 监听容器尺寸变化
 * 2. 动态高度测量，支持可变消息高度
 * 3. 自动滚动到底部
 * 4. 容器尺寸为 0 时不渲染虚拟列表
 */
export const VirtualizedMessageList = React.forwardRef<
  any,
  VirtualizedMessageListProps
>(({ messages, messageRenderer, overscanCount = 5 }, ref) => {
  const heightsRef = useRef<Record<number, number>>({});
  const outerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<any>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // 监听容器尺寸变化
  useEffect(() => {
    if (!outerRef.current) return;

    let mounted = true;

    const updateSize = () => {
      if (!mounted || !outerRef.current) return;

      const rect = outerRef.current.getBoundingClientRect();

      // 获取计算后的尺寸，确保即使元素隐藏也能计算
      const computedStyle = window.getComputedStyle(outerRef.current);
      const width =
        outerRef.current.offsetWidth || parseInt(computedStyle.width, 10);
      const height =
        outerRef.current.offsetHeight || parseInt(computedStyle.height, 10);

      if (width > 0 && height > 0) {
        setSize({
          width: Math.floor(width),
          height: Math.floor(height),
        });
      }
    };

    // 使用 ResizeObserver 监听尺寸变化
    const resizeObserver = new ResizeObserver(() => {
      updateSize();
    });

    resizeObserver.observe(outerRef.current);

    // 初始化时立即更新一次
    updateSize();

    // 使用 requestAnimationFrame 确保 DOM 已更新
    const frameId = requestAnimationFrame(updateSize);

    return () => {
      mounted = false;
      resizeObserver.disconnect();
      cancelAnimationFrame(frameId);
    };
  }, []);

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    if (listRef.current && messages.length > 0) {
      // 滚动到最后一条消息
      listRef.current.scrollToItem?.(messages.length - 1, 'end');
    }
  }, [messages.length]);

  // 监听消息数变化，自动滚动到底部
  useEffect(() => {
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

  // 动态计算消息高度
  const getItemSize = (index: number): number => {
    // 如果已经测量过，使用实际高度
    if (heightsRef.current[index] !== undefined) {
      return heightsRef.current[index];
    }

    const message = messages[index];
    if (!message) return 100;

    // 根据消息类型估算高度
    const contentLength = String(message.content || '').length;
    const isAssistant = message.role === 'assistant';

    if (isAssistant) {
      // AI 消息可能包含思考过程和长文本，需要更多高度
      // 估算公式：基础高度 + 内容相关高度
      return Math.max(120, Math.min(1200, 140 + contentLength / 6));
    }

    // 用户消息通常较短
    return Math.max(80, Math.min(300, 80 + contentLength / 15));
  };

  const Row = React.memo(
    ({ index, style }: { index: number; style: CSSProperties }) => {
      const message = messages[index];
      const itemRef = useRef<HTMLDivElement>(null);

      // 测量实际高度并更新
      useEffect(() => {
        if (!itemRef.current) return;

        const measure = () => {
          const actualHeight = itemRef.current?.offsetHeight ?? 0;
          if (actualHeight > 0) {
            const oldHeight = heightsRef.current[index];

            if (oldHeight !== actualHeight) {
              heightsRef.current[index] = actualHeight;

              // 如果高度变化超过 10px，重新计算虚拟列表布局
              if (Math.abs(actualHeight - (oldHeight ?? 0)) > 10) {
                // 使用 requestAnimationFrame 延迟更新，避免频繁触发
                requestAnimationFrame(() => {
                  listRef.current?.resetAfterIndex?.(index);
                });
              }
            }
          }
        };

        // 使用 requestAnimationFrame 确保 DOM 已渲染
        const frameId = requestAnimationFrame(measure);
        return () => cancelAnimationFrame(frameId);
      }, [index]);

      return (
        <div ref={itemRef} style={style} className="w-full box-border">
          {messageRenderer(message, index)}
        </div>
      );
    },
  );

  Row.displayName = 'VirtualListRow';

  // 如果尺寸还没获取到或尺寸为 0，显示空容器
  // （等待 ResizeObserver 回调）
  if (size.width === 0 || size.height === 0) {
    return (
      <div
        ref={outerRef}
        style={{
          width: '100%',
          height: '100%',
          overflow: 'hidden',
        }}
      />
    );
  }

  return (
    <div
      ref={outerRef}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <FixedSizeList
        ref={(listInstance) => {
          listRef.current = listInstance;
          if (typeof ref === 'function') {
            ref(listInstance);
          } else if (ref) {
            ref.current = listInstance;
          }
        }}
        height={size.height}
        itemCount={messages.length}
        itemSize={getItemSize}
        width={size.width}
        overscanCount={overscanCount}
      >
        {Row}
      </FixedSizeList>
    </div>
  );
});

VirtualizedMessageList.displayName = 'VirtualizedMessageList';
