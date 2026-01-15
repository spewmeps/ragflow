/**
 * 优化的聊天消息容器示例
 * 展示如何集成所有优化方案
 *
 * 这是一个参考实现，可以集成到 single-chat-box.tsx 中
 */

import { VirtualMessageList } from '@/components/virtual-message-list';
import { useMemoryManagementSystem } from '@/hooks/use-memory-management';
import { IMessage } from '@/pages/next-chats/chat/interface';
import React, { useEffect, useMemo } from 'react';

interface OptimizedChatContainerProps {
  messages: IMessage[];
  messageContainerRef?: React.RefObject<HTMLDivElement>;
  renderMessage: (message: IMessage) => React.ReactNode;
  isLoading?: boolean;
}

/**
 * 优化的聊天消息容器
 * 自动根据内存使用情况切换渲染模式
 */
export const OptimizedChatContainer = React.forwardRef<
  HTMLDivElement,
  OptimizedChatContainerProps
>(({ messages, messageContainerRef, renderMessage, isLoading }, ref) => {
  // 启用内存管理系统
  const {
    memoryStats,
    memoryLevel,
    renderMode,
    startMonitoring,
    registerCleanup,
  } = useMemoryManagementSystem({
    checkInterval: 5000, // 每5秒检查一次
    thresholds: {
      warning: 0.8,
      critical: 0.9,
      cleanup: 0.95,
    },
  });

  // 启动内存监测
  useEffect(() => {
    startMonitoring();
  }, [startMonitoring]);

  // 注册消息清理回调
  useEffect(() => {
    const cleanup = registerCleanup(
      'chat-messages',
      () => {
        // 当内存压力大时，清理缓存
        console.log('[ChatContainer] Clearing message cache');
        // 具体清理逻辑由调用者实现
      },
      'warning',
    );
    return cleanup;
  }, [registerCleanup]);

  // 根据消息数量和内存状态决定渲染模式
  const optimalMode = useMemo(() => {
    const messageCount = messages.length;

    // 内存压力下强制使用虚拟列表
    if (memoryLevel === 'critical' || memoryLevel === 'cleanup') {
      return 'virtual';
    }

    // 消息过多时使用虚拟列表
    if (messageCount > 100) {
      return 'virtual';
    }

    return 'normal';
  }, [messages.length, memoryLevel]);

  // 添加视觉反馈
  const memoryIndicatorColor = {
    normal: '#10b981', // 绿色
    warning: '#f59e0b', // 黄色
    critical: '#ef4444', // 红色
    cleanup: '#7c2d12', // 深红色
  }[memoryLevel];

  const memoryPercentage = memoryStats
    ? (
        (memoryStats.usedJSHeapSize / memoryStats.jsHeapSizeLimit) *
        100
      ).toFixed(1)
    : '--';

  // 渲染模式提示
  const modeIndicator = {
    normal: '📝 普通模式',
    virtual: '⚡ 虚拟列表',
    paginated: '📄 分页模式',
  }[renderMode];

  return (
    <div
      ref={ref}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        position: 'relative',
      }}
    >
      {/* 内存状态指示器 - 开发/调试模式 */}
      {process.env.NODE_ENV === 'development' && (
        <div
          style={{
            padding: '8px 12px',
            background: '#f3f4f6',
            borderBottom: `2px solid ${memoryIndicatorColor}`,
            fontSize: '12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '16px',
          }}
        >
          <div>
            <span style={{ color: memoryIndicatorColor, fontWeight: 'bold' }}>
              {memoryLevel.toUpperCase()}
            </span>
            {' | '}
            {memoryPercentage}% 内存
          </div>
          <div style={{ color: '#666' }}>{modeIndicator}</div>
          <div style={{ color: '#666' }}>
            消息: {messages.length}
            {isLoading && ' (加载中...)'}
          </div>
        </div>
      )}

      {/* 消息列表容器 */}
      <div
        ref={messageContainerRef}
        style={{
          flex: 1,
          overflow: 'auto',
          position: 'relative',
        }}
      >
        {optimalMode === 'virtual' && messages.length > 0 ? (
          // 虚拟列表模式 - 高性能
          <VirtualMessageList
            messages={messages}
            messageHeight={100}
            containerHeight={600}
            renderMessage={(msg, idx) => (
              <div key={msg.id || idx} style={{ padding: '8px' }}>
                {renderMessage(msg)}
              </div>
            )}
            overscanCount={5}
          />
        ) : (
          // 普通模式 - 少量消息
          <div style={{ padding: '8px' }}>
            {messages.map((msg, idx) => (
              <div key={msg.id || idx}>{renderMessage(msg)}</div>
            ))}
          </div>
        )}

        {/* 空状态 */}
        {messages.length === 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#999',
            }}
          >
            暂无消息
          </div>
        )}
      </div>

      {/* 加载指示器 */}
      {isLoading && (
        <div
          style={{
            padding: '8px',
            textAlign: 'center',
            color: '#666',
            fontSize: '14px',
            borderTop: '1px solid #e5e7eb',
          }}
        >
          ⏳ 加载中...
        </div>
      )}
    </div>
  );
});

OptimizedChatContainer.displayName = 'OptimizedChatContainer';

/**
 * 使用示例：在 single-chat-box.tsx 中替换原来的消息容器
 *
 * 原来的代码：
 * ```tsx
 * <div ref={messageContainerRef} className="h-full overflow-auto">
 *   {filteredMessages?.map((message, i) => (
 *     <MessageItem key={message.id} message={message} />
 *   ))}
 * </div>
 * ```
 *
 * 替换为：
 * ```tsx
 * <OptimizedChatContainer
 *   ref={messageContainerRef}
 *   messages={filteredMessages}
 *   renderMessage={(msg) => <MessageItem message={msg} />}
 *   isLoading={sendLoading}
 * />
 * ```
 */
