import { ReactComponent as AssistantIcon } from '@/assets/svg/assistant.svg';
import { DeepinsightGenerationButtons } from '@/components/deepinsight-generation-buttons';
import { EditableExecutePlan } from '@/components/editable-execute-plan';
import { MessageType } from '@/constants/chat';
import { IReference, IReferenceChunk } from '@/interfaces/database/chat';
import classNames from 'classnames';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  useFetchDocumentInfosByIds,
  useFetchDocumentThumbnailsByIds,
} from '@/hooks/document-hooks';
import { IRegenerateMessage, IRemoveMessageById } from '@/hooks/logic-hooks';
import { cn } from '@/lib/utils';
import { IMessage } from '@/pages/chat/interface';
import MarkdownContent from '@/pages/chat/markdown-content';
import { Avatar, Flex, Space } from 'antd';
import { ReferenceDocumentList } from '../next-message-item/reference-document-list';
import { InnerUploadedMessageFiles } from '../next-message-item/uploaded-message-files';
import { useTheme } from '../theme-provider';
import { AssistantGroupButton, UserGroupButton } from './group-button';
import styles from './index.less';

// Helper function to convert thinking items to markdown content with proper formatting
// Supports progress bars, parent-child relationships, and tool call cards
const formatThinkingContent = (items: any[]): string => {
  if (!Array.isArray(items) || items.length === 0) {
    return '';
  }

  // Build parent-child tree structure
  const itemMap = new Map<string, any>();
  const rootItems: any[] = [];

  // First pass: create nodes for all items, using unique IDs even when message_id is null
  items.forEach((item, index) => {
    if (!item) return;
    // Use message_id if available, otherwise use index as unique key
    const key = item.message_id || `_null_${index}`;
    itemMap.set(key, { ...item, children: [], _key: key });
  });

  // Second pass: establish parent-child relationships
  items.forEach((item, index) => {
    if (!item) return;
    const key = item.message_id || `_null_${index}`;

    // Only establish parent-child relationship if parent_message_id exists
    if (item.parent_message_id && itemMap.has(item.parent_message_id)) {
      itemMap.get(item.parent_message_id)!.children.push(itemMap.get(key));
    } else {
      // If no parent or parent not found, treat as root item
      rootItems.push(itemMap.get(key));
    }
  });

  const result: string[] = [];
  const processedIds = new Set<string>();

  const processItem = (item: any) => {
    if (!item || processedIds.has(item._key)) return;
    processedIds.add(item._key);

    const content = item.content || '';
    const isToolCall = item.type === 'content_tool_call';
    const hasPercentage =
      item.percentage !== undefined && item.percentage !== null;

    // Get first line as title/label for items with progress
    let title = '';
    if (hasPercentage && typeof content === 'string') {
      title = content
        .split('\n')[0]
        .replace(/\s*\(?\d{1,3}%\)?\s*$/g, '')
        .trim();
    }

    // Add title heading only for items with progress bar
    if (title && hasPercentage) {
      result.push(`### ${title}`);
    }

    // Add progress bar if percentage exists - using styled progress indicator
    if (hasPercentage) {
      const percentage = Math.min(100, Math.max(0, item.percentage));
      const checkmark =
        percentage === 100
          ? '<span style="color: #52c41a; font-size: 12px;">✓</span>'
          : '';
      // Use styled progress div instead of HTML progress tag for consistency with deepinsightThinkingPanel
      result.push(
        `<div class="thinking-progress" style="margin-top: 6px; padding-left: 24px; display: flex; align-items: center; gap: 8px;"><div style="flex: 1; height: 4px; background: #e8e8e8; border-radius: 2px; overflow: hidden;"><div style="height: 100%; background: linear-gradient(90deg, #1890ff, #69c0ff); transition: width 0.3s; border-radius: 2px; width: ${percentage}%;"></div></div><span style="flex-shrink: 0; display: flex; align-items: center; justify-content: center;">${checkmark}</span></div>`,
      );
    }

    // Format content - just include as-is for markdown rendering, except tool calls
    if (isToolCall) {
      // Tool call content
      try {
        const toolContent =
          typeof content === 'string' ? JSON.parse(content) : content;
        const toolJson = JSON.stringify(toolContent);
        result.push(`<tool-call>\n${toolJson}\n</tool-call>`);
      } catch (e) {
        result.push(content);
      }
    } else if (content) {
      // Just include content as-is for markdown rendering
      // If has progress bar, skip first line since it's shown as heading
      const lines = content.split('\n');
      if (
        hasPercentage &&
        title &&
        lines.length > 1 &&
        lines[0].replace(/\s*\(?\d{1,3}%\)?\s*$/g, '').trim() === title
      ) {
        // Skip first line since it's already shown as heading
        result.push(lines.slice(1).join('\n'));
      } else {
        result.push(content);
      }
    }

    // Process children
    if (item.children && item.children.length > 0) {
      item.children.forEach((child: any) => {
        result.push(''); // Add spacing
        processItem(child);
      });
    }
  };

  rootItems.forEach((item) => {
    processItem(item);
    result.push(''); // Add spacing between root items
  });

  return result
    .filter((line) => line !== undefined)
    .join('\n')
    .trim();
};

interface IProps extends Partial<IRemoveMessageById>, IRegenerateMessage {
  item: IMessage;
  reference: IReference;
  loading?: boolean;
  sendLoading?: boolean;
  visibleAvatar?: boolean;
  nickname?: string;
  avatar?: string;
  avatarDialog?: string | null;
  clickDocumentButton?: (documentId: string, chunk: IReferenceChunk) => void;
  index: number;
  showLikeButton?: boolean;
  showLoudspeaker?: boolean;
  isDeepinsightChat?: boolean;
  isDeepinsightConference?: boolean;
  isCompleted?: boolean;
  conversationId?: string;
  onSendMessage?: (message: string) => void;
}

const MessageItem = ({
  item,
  reference,
  loading = false,
  avatar,
  avatarDialog,
  sendLoading = false,
  clickDocumentButton,
  index,
  removeMessageById,
  regenerateMessage,
  showLikeButton = true,
  showLoudspeaker = true,
  visibleAvatar = true,
  isDeepinsightChat = false,
  isDeepinsightConference = false,
  isCompleted = false,
  conversationId,
  onSendMessage,
}: IProps) => {
  const { theme } = useTheme();
  const isAssistant = item.role === MessageType.Assistant;
  const isUser = item.role === MessageType.User;
  const { data: documentList, setDocumentIds } = useFetchDocumentInfosByIds();
  const { data: documentThumbnails, setDocumentIds: setIds } =
    useFetchDocumentThumbnailsByIds();

  // Track real-time elapsed time during loading
  // Use a ref to store the start time and update display periodically
  const loadingStartTimeRef = useRef<number | null>(null);
  const [realTimeElapsed, setRealTimeElapsed] = useState<number>(0);

  // When loading starts, record the start time
  useEffect(() => {
    if (loading && isAssistant && !loadingStartTimeRef.current) {
      loadingStartTimeRef.current = Date.now();
    }
  }, [loading, isAssistant]);

  // Effect to update real-time elapsed time every 100ms when loading
  // Uses stored start time to calculate elapsed, so it continues even when page is hidden
  useEffect(() => {
    if (!loading || !isAssistant || !loadingStartTimeRef.current) {
      return;
    }

    const interval = setInterval(() => {
      if (loadingStartTimeRef.current) {
        const elapsed = Date.now() - loadingStartTimeRef.current;
        setRealTimeElapsed(elapsed);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [loading, isAssistant]);

  // Reset real-time elapsed time when loading completes
  useEffect(() => {
    if (!loading) {
      setRealTimeElapsed(0);
      loadingStartTimeRef.current = null;
    }
  }, [loading]);

  // Helper function to get content as string
  const getContentString = (content: any): string => {
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      return content.map((item: any) => item.content || '').join('\n');
    }
    return '';
  };

  // Helper function to filter out result type items in deepinsightChat/Conference mode
  // Both modes should use the same logic to extract displayable content
  const filterResultContent = (content: any): string => {
    if (!isDeepinsightChat && !isDeepinsightConference) {
      if (typeof content === 'string') {
        return content;
      }
      if (Array.isArray(content)) {
        return content.map((item: any) => item.content || '').join('\n');
      }
      return '';
    }

    if (typeof content === 'string') {
      // Remove <result>...</result> tags from string content
      return content.replace(/<result>[\s\S]*?<\/result>/gi, '').trim();
    }

    if (Array.isArray(content)) {
      // For deepinsightConference: Format thinking items with proper structure and results
      // For deepinsightChat: Keep items with empty process (which excludes thinking items)
      if (isDeepinsightConference) {
        // Collect thinking and result items
        const thinkingItems: any[] = [];
        const resultItems: string[] = [];

        content.forEach((item: any) => {
          if (!item) return;

          const isInterruptType = item.type === 'interrupt_execute_plan_edit';
          const isThinkingType = item.type?.startsWith('thinking_step_');

          if (isInterruptType) {
            // Skip interrupt items
            return;
          }

          if (
            isThinkingType ||
            item.process === 'think' ||
            item.process === 'progress'
          ) {
            // Collect thinking items for structured formatting
            thinkingItems.push(item);
          } else if (item.type === 'result') {
            // Collect result content
            resultItems.push(item.content || '');
          }
        });

        const result: string[] = [];

        // Add thinking content with proper formatting (parent-child structure, progress bars, tool calls)
        if (thinkingItems.length > 0) {
          const thinkingContent = formatThinkingContent(thinkingItems);
          if (thinkingContent) {
            result.push(`<think>${thinkingContent}</think>`);
          }
        }

        // Add result contents
        if (resultItems.length > 0) {
          result.push(...resultItems);
        }

        return result.join('\n').trim();
      } else {
        // For deepinsightChat: keep items with empty process (which excludes thinking items)
        const otherContents: string[] = [];

        content.forEach((item: any) => {
          if (!item) return;

          const isInterruptType = item.type === 'interrupt_execute_plan_edit';
          const isThinkingType = item.type?.startsWith('thinking_step_');
          const isEmptyProcess = item.process === '';

          if (isEmptyProcess && !isInterruptType && !isThinkingType) {
            if (item.type === 'content_tool_call') {
              // Convert content_tool_call to <tool-call> format
              try {
                const toolCallContent =
                  typeof item.content === 'string'
                    ? item.content
                    : JSON.stringify(item.content);
                otherContents.push(
                  `<tool-call>\n${toolCallContent}\n</tool-call>`,
                );
              } catch (e) {
                otherContents.push(item.content || '');
              }
            } else {
              otherContents.push(item.content || '');
            }
          }
        });

        return otherContents.join('\n').trim();
      }
    }

    return '';
  };

  // Detect interrupt_execute_plan_edit message
  const interruptPlanData = useMemo(() => {
    if (!isDeepinsightChat) {
      return null;
    }
    // Check in data.answer or data.answerArray
    const answerArray = item?.data?.answer || item?.data?.answerArray;
    if (!Array.isArray(answerArray)) {
      return null;
    }
    const planItem = answerArray.find(
      (x: any) => x?.type === 'interrupt_execute_plan_edit',
    );
    return planItem;
  }, [isDeepinsightChat, item?.data?.answer, item?.data?.answerArray]);

  const referenceDocumentList = useMemo(() => {
    return reference?.doc_aggs ?? [];
  }, [reference?.doc_aggs]);

  const handleRegenerateMessage = useCallback(() => {
    regenerateMessage?.(item);
  }, [regenerateMessage, item]);

  useEffect(() => {
    const ids = item?.doc_ids ?? [];
    if (ids.length) {
      setDocumentIds(ids);
      const documentIds = ids.filter((x) => !(x in documentThumbnails));
      if (documentIds.length) {
        setIds(documentIds);
      }
    }
  }, [item.doc_ids, setDocumentIds, setIds, documentThumbnails]);

  return (
    <div
      className={classNames(styles.messageItem, {
        [styles.messageItemLeft]: item.role === MessageType.Assistant,
        [styles.messageItemRight]: item.role === MessageType.User,
      })}
    >
      <section
        className={classNames(styles.messageItemSection, {
          [styles.messageItemSectionLeft]: item.role === MessageType.Assistant,
          [styles.messageItemSectionRight]: item.role === MessageType.User,
        })}
      >
        <div
          className={classNames(styles.messageItemContent, {
            [styles.messageItemContentReverse]: item.role === MessageType.User,
          })}
        >
          {visibleAvatar &&
            (item.role === MessageType.User ? (
              <Avatar
                size={40}
                src={avatar ?? '/logo.svg'}
                style={{ flexShrink: 0 }}
              />
            ) : avatarDialog ? (
              <Avatar size={40} src={avatarDialog} style={{ flexShrink: 0 }} />
            ) : (
              <AssistantIcon style={{ flexShrink: 0 }} />
            ))}

          <Flex
            vertical
            gap={8}
            flex={isAssistant ? 1 : 'none'}
            style={{
              minWidth: 0,
              maxWidth: isAssistant ? '100%' : 'calc(100% - 60px)',
            }}
            align={isAssistant ? 'flex-start' : 'flex-end'}
          >
            <Space>
              {isAssistant ? (
                index !== 0 && (
                  <AssistantGroupButton
                    messageId={item.id}
                    content={getContentString(item.content)}
                    prompt={item.prompt}
                    showLikeButton={showLikeButton}
                    audioBinary={item.audio_binary}
                    showLoudspeaker={showLoudspeaker}
                  ></AssistantGroupButton>
                )
              ) : (
                <UserGroupButton
                  content={getContentString(item.content)}
                  messageId={item.id}
                  removeMessageById={removeMessageById}
                  regenerateMessage={
                    regenerateMessage && handleRegenerateMessage
                  }
                  sendLoading={sendLoading}
                ></UserGroupButton>
              )}

              {/* <b>{isAssistant ? '' : nickname}</b> */}
            </Space>
            <div
              className={cn(
                isAssistant
                  ? theme === 'dark'
                    ? styles.messageTextDark
                    : styles.messageText
                  : styles.messageUserText,
                { '!bg-bg-card': !isAssistant },
              )}
            >
              {/* Show editable execute plan for deepinsightChat mode */}
              {isDeepinsightChat && interruptPlanData && (
                <div style={{ marginBottom: '12px' }}>
                  <EditableExecutePlan
                    content={interruptPlanData.content}
                    messageId={item.id}
                    conversationId={conversationId}
                    onStartResearch={(plan) => onSendMessage?.(plan)}
                  />
                </div>
              )}

              {/* Show main content with thinking data for deepinsightConference */}
              {!(isDeepinsightChat && interruptPlanData) && (
                <>
                  <MarkdownContent
                    loading={loading}
                    content={
                      isAssistant
                        ? isDeepinsightConference
                          ? filterResultContent(item.content)
                          : filterResultContent(item.content)
                        : typeof item.content === 'string'
                          ? item.content
                          : Array.isArray(item.content)
                            ? item.content
                                .map((i: any) => i.content || '')
                                .join('\n')
                            : ''
                    }
                    reference={reference}
                    progressSteps={item.data?.progressSteps}
                    progress={isAssistant ? (item.data?.progress ?? 0) : 0}
                    elapsedTime={item.data?.elapsedTime}
                    clickDocumentButton={clickDocumentButton}
                    isDeepinsightConference={isDeepinsightConference}
                    contentArray={
                      isDeepinsightConference
                        ? Array.isArray(item.data?.answer)
                          ? item.data.answer
                          : Array.isArray(item.data?.answerArray)
                            ? item.data.answerArray
                            : Array.isArray(item.content)
                              ? item.content
                              : undefined
                        : undefined
                    }
                  ></MarkdownContent>

                  {/* Show loading spinner and real-time elapsed time during loading - after content */}
                  {isAssistant && loading && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginTop: '12px',
                      }}
                    >
                      <div
                        style={{
                          width: '16px',
                          height: '16px',
                          border: '2px solid #f0f0f0',
                          borderTop: '2px solid #1890ff',
                          borderRadius: '50%',
                          animation: 'spin 0.6s linear infinite',
                        }}
                      />
                      <span style={{ fontSize: '12px', color: '#999' }}>
                        正在加载...
                      </span>
                      {/* Show real-time elapsed time during loading - calculated from component state */}
                      {realTimeElapsed > 0 && (
                        <span
                          style={{
                            fontSize: '12px',
                            color: '#999',
                            marginLeft: '8px',
                          }}
                        >
                          已耗时: {(realTimeElapsed / 1000).toFixed(2)}秒
                        </span>
                      )}
                      <style>{`
                        @keyframes spin {
                          to { transform: rotate(360deg); }
                        }
                      `}</style>
                    </div>
                  )}

                  {/* Show total elapsed time only after loading is complete */}
                  {isAssistant &&
                    !loading &&
                    (() => {
                      let elapsedTime: number | null = null;

                      // First try to get from data.elapsedTime (streaming data)
                      if (item.data?.elapsedTime) {
                        elapsedTime = item.data.elapsedTime;
                      }
                      // For deepinsightConference with historical data, calculate from timestamps
                      else if (
                        isDeepinsightConference &&
                        Array.isArray(item?.content)
                      ) {
                        const firstItem = item.content[0];
                        const lastItem = item.content[item.content.length - 1];
                        if (firstItem?.create_time && lastItem?.create_time) {
                          elapsedTime = Math.round(
                            (lastItem.create_time - firstItem.create_time) *
                              1000,
                          );
                        }
                      }

                      return elapsedTime ? (
                        <div
                          style={{
                            marginTop: '8px',
                            fontSize: '12px',
                            opacity: 0.6,
                          }}
                        >
                          总耗时: {(elapsedTime / 1000).toFixed(2)}秒
                        </div>
                      ) : null;
                    })()}
                </>
              )}
            </div>
            {isAssistant && referenceDocumentList.length > 0 && (
              <ReferenceDocumentList
                list={referenceDocumentList}
              ></ReferenceDocumentList>
            )}

            {isAssistant &&
              isCompleted &&
              (isDeepinsightChat || isDeepinsightConference) &&
              conversationId && (
                <DeepinsightGenerationButtons
                  conversationId={conversationId}
                  messageId={item.id}
                  messageContent={getContentString(item.content)}
                  isDeepinsightChat={isDeepinsightChat}
                />
              )}

            {isUser && documentList.length > 0 && (
              <InnerUploadedMessageFiles
                files={documentList}
              ></InnerUploadedMessageFiles>
            )}
          </Flex>
        </div>
      </section>
    </div>
  );
};

export default memo(MessageItem);
