import DeepInsightThinkingPanel from '@/components/deepinsight-thinking-panel';
import { NextMessageInput } from '@/components/message-input/next';
import MessageItem from '@/components/message-item';
import PdfDrawer from '@/components/pdf-drawer';
import { useClickDrawer } from '@/components/pdf-drawer/hooks';
import { ChatSearchParams, MessageType } from '@/constants/chat';
import { useStreamingRequest } from '@/contexts/streaming-request-context';
import {
  useFetchConversation,
  useFetchDialog,
  useGetChatSearchParams,
} from '@/hooks/use-chat-request';
import { useFetchUserInfo } from '@/hooks/user-setting-hooks';
import { AnswerItem } from '@/interfaces/database/chat';
import { buildMessageUuidWithRole } from '@/utils/chat';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { v4 as uuid } from 'uuid';
import {
  useGetSendButtonDisabled,
  useSendButtonDisabled,
} from '../../hooks/use-button-disabled';
import { useCreateConversationBeforeUploadDocument } from '../../hooks/use-create-conversation';
import { useDeepinsightCompletion } from '../../hooks/use-deepinsight-completion';
import { useSendMessage } from '../../hooks/use-send-chat-message';
import { buildMessageItemReference } from '../../utils';

interface IProps {
  controller: AbortController;
  stopOutputMessage(): void;
  thinkingPanelVisible?: boolean;
}

export function SingleChatBox({
  controller,
  stopOutputMessage,
  thinkingPanelVisible = true,
}: IProps) {
  const { visible, hideModal, documentId, selectedChunk, clickDocumentButton } =
    useClickDrawer();
  const [selectedKbs, setSelectedKbs] = useState<string[]>([]);
  const [webSearch, setWebSearch] = useState(false);
  const { setIsStreaming } = useStreamingRequest();

  const {
    value,
    scrollRef,
    messageContainerRef,
    sendLoading,
    derivedMessages,
    isUploading,
    handleInputChange,
    handlePressEnter,
    regenerateMessage,
    removeMessageById,
    handleUploadFile,
    removeFile,
    handleSendMessage,
    addNewestQuestion,
  } = useSendMessage(controller, selectedKbs, webSearch);

  // 将 sendLoading 状态同步到全局 Context
  useEffect(() => {
    setIsStreaming(sendLoading);
  }, [sendLoading, setIsStreaming]);
  const { data: userInfo } = useFetchUserInfo();
  const { data: currentDialog } = useFetchDialog();
  const { createConversationBeforeUploadDocument } =
    useCreateConversationBeforeUploadDocument();
  const { conversationId } = useGetChatSearchParams();
  const { data: conversation } = useFetchConversation();
  const disabled = useGetSendButtonDisabled();
  const sendDisabled = useSendButtonDisabled(value);

  // Handler for when user clicks "开始研究" in EditableExecutePlan
  const handleStartResearchFromPlan = (planContent: string) => {
    const messageId = uuid();
    addNewestQuestion({
      content: planContent,
      id: messageId,
      role: MessageType.User,
    });
    handleSendMessage({
      content: planContent,
      role: MessageType.User,
      id: messageId,
    } as any);
  };

  // 获取路由参数，判断是否为 deepinsight 模式
  const searchParams = new URLSearchParams(window.location.search);
  const conversationApi =
    searchParams.get(ChatSearchParams.ConversationApi) || '';
  const isDeepinsightMode = conversationApi === 'deepinsightChat';
  const isDeepinsightConferenceMode =
    conversationApi === 'deepinsightConferenceQuestion';
  const isAnyDeepinsightMode = isDeepinsightMode || isDeepinsightConferenceMode;

  // 提取思考数据 - 只包含 process='think' 或 type 为思考相关的项
  const thinkingData = useMemo(() => {
    if (!isDeepinsightMode) {
      return [];
    }
    const lastMessage = derivedMessages?.[derivedMessages.length - 1];
    if (lastMessage?.role !== MessageType.Assistant) {
      return [];
    }

    // For deepinsightChat mode: try to get from data.answer/answerArray (streaming) first,
    // then fall back to content array (historical/stored data)
    let answerArray =
      lastMessage?.data?.answer ||
      lastMessage?.data?.answerArray ||
      (Array.isArray(lastMessage?.content) ? lastMessage?.content : null);

    if (Array.isArray(answerArray)) {
      // Filter to include thinking-related items and result items for the right panel
      const thinkingTypes = [
        'thinking_step_outline',
        'thinking_step_topic',
        'thinking_step_analysis',
        'think',
        'result',
      ];
      return (answerArray as AnswerItem[]).filter(
        (item) =>
          item?.process === 'think' || thinkingTypes.includes(item?.type),
      );
    }
    return [];
  }, [derivedMessages, isDeepinsightMode]);

  // 检测完成状态
  const completionMode = isDeepinsightMode
    ? 'chat'
    : isDeepinsightConferenceMode
      ? 'conference'
      : null;

  const lastMessageAnswerData = useMemo(() => {
    const lastMessage = derivedMessages?.[derivedMessages.length - 1];
    if (lastMessage?.role !== MessageType.Assistant) {
      return undefined;
    }

    // For deepinsightConferenceQuestion, extract content from complete conversation data
    // The content array contains all the message items including completion indicators
    if (isDeepinsightConferenceMode && Array.isArray(lastMessage?.content)) {
      return lastMessage?.content;
    }

    return (
      lastMessage?.data?.answer ||
      lastMessage?.data?.answerArray ||
      (Array.isArray(lastMessage?.content) ? lastMessage?.content : undefined)
    );
  }, [derivedMessages, isDeepinsightConferenceMode]);

  const { isCompleted } = useDeepinsightCompletion(
    lastMessageAnswerData,
    completionMode,
  );

  // DEV-only debug: print summary to help troubleshoot filtering issues
  // placed after filteredMessages is computed so we can inspect results
  // (only in development to avoid noise in production)

  // DEV-only debug: print summary to help troubleshoot filtering issues
  // placed after filteredMessages is computed so we can inspect results
  // (only in development to avoid noise in production)

  // (debug logging moved down to after filteredMessages declaration)

  // Helper function to check if an item should be filtered out
  const shouldFilterOutItem = useCallback(
    (item: any): boolean => {
      if (!item) return true;

      // In deepinsight mode, only show items with process='' and type!='result'
      // Filter out think, progress, and result type items
      if (isDeepinsightMode) {
        // Only keep items where process is empty string (the final complete content) and not result type
        const isResultType = item.type === 'result';
        return item.process !== '' || isResultType;
      }

      // In other modes, filter out only 'result' type items
      const isResultType = item.type === 'result';
      return isResultType;
    },
    [isDeepinsightMode],
  );

  // Helper function to strip think/result tags from content string
  const stripThinkAndResultTags = (content: string): string => {
    if (!content) return content;
    // Remove <think>...</think> and <result>...</result> tags
    let stripped = content
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<result>[\s\S]*?<\/result>/gi, '');
    // Clean up any extra whitespace
    stripped = stripped.replace(/^\s+|\s+$/g, '');
    return stripped;
  };

  // 在 deepinsight 模式下，过滤掉 type 为 think 和 result 的内容项
  const filteredMessages = useMemo(() => {
    // 第一层：过滤掉非最后一个占位符消息
    // 占位符消息只在等待答案时显示，一旦真实答案到达就应该被替换
    // 去重已经在 addNewestAnswer 中完成了，这里不需要再做
    const dedupedMessages = (derivedMessages ?? []).filter((msg, idx, arr) => {
      // 用户消息和系统消息永远保留
      if (msg.role !== MessageType.Assistant) {
        return true;
      }

      const isPlaceholder =
        typeof msg.id === 'string' && msg.id.startsWith('placeholder_');

      if (!isPlaceholder) {
        // 非占位符的助手消息：全部保留（去重已在 addNewestAnswer 中完成）
        return true;
      }

      // 占位符消息：只保留最后一个
      if (idx === arr.length - 1) {
        return true;
      }

      // 占位符消息但不是最后一条，说明已经有真实答案了，过滤掉
      return false;
    });

    if (!isDeepinsightMode) {
      return dedupedMessages;
    }

    return dedupedMessages
      ?.map((msg, msgIndex) => {
        if (msg.role !== MessageType.Assistant) {
          return msg;
        }

        const newMsg = { ...msg } as any;

        // Normalize both answer and answerArray to arrays
        // Also check if content field itself is an array (from streaming data)
        let answers = Array.isArray(msg.data?.answer)
          ? msg.data.answer
          : Array.isArray(msg.data?.answerArray)
            ? msg.data.answerArray
            : Array.isArray(msg.content)
              ? msg.content
              : null;

        if (!answers || !Array.isArray(answers)) {
          // Even if no answer array, strip think/result tags from content
          return {
            ...newMsg,
            content: stripThinkAndResultTags(newMsg.content),
          };
        }

        // Deep filter: remove blocked items and their nested children
        const recursiveFilter = (items: any[]): any[] => {
          return items
            .filter((item) => !shouldFilterOutItem(item))
            .map((item) => {
              // If item has nested children/answer arrays, recursively filter them
              if (Array.isArray(item.children)) {
                return {
                  ...item,
                  children: recursiveFilter(item.children),
                };
              }
              if (Array.isArray(item.answer)) {
                return {
                  ...item,
                  answer: recursiveFilter(item.answer),
                };
              }
              return item;
            });
        };

        const filtered = recursiveFilter(answers);

        // Check if this is the last assistant message
        const isLastMessage = msgIndex === dedupedMessages.length - 1;

        if (filtered.length === 0) {
          // For the last message during loading, keep it with empty content (to show placeholder)
          // For other messages, hide them
          if (!isLastMessage || !sendLoading) {
            return null;
          }

          // Keep last message but with empty content during loading
          newMsg.content = '';
          return newMsg;
        }

        // Ensure filtered items are used for rendering: write filtered array to content
        // and also preserve it on data.answer/answerArray for downstream usage
        newMsg.content = filtered;
        if (Array.isArray(msg.data?.answer)) {
          newMsg.data = { ...msg.data, answer: filtered };
        } else if (Array.isArray(msg.data?.answerArray)) {
          newMsg.data = { ...msg.data, answerArray: filtered };
        } else {
          newMsg.data = { ...msg.data, answer: filtered };
        }

        return newMsg;
      })
      .filter((msg): msg is any => msg !== null)
      .map((msg: any) => {
        let contentStr = msg.content;

        // If content is an array (from streaming data), convert to string
        if (Array.isArray(msg.content)) {
          contentStr = msg.content
            .map((item: any) => item.content || '')
            .join('\n');
        }

        return {
          ...msg,
          content: stripThinkAndResultTags(contentStr),
        };
      });
  }, [derivedMessages, isDeepinsightMode, shouldFilterOutItem, sendLoading]);

  return (
    <section className="flex flex-col h-full overflow-hidden">
      <div className="flex flex-1 min-h-0 p-5">
        {/* 左边：聊天内容和输入框 */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0 mr-3">
          <div
            ref={messageContainerRef}
            className="flex-1 overflow-auto min-h-0"
          >
            {(() => {
              return (
                <>
                  <div className="w-full">
                    {filteredMessages?.map((message, i) => {
                      // Check if this is the last assistant message in filtered list
                      const isLastAssistantMessage =
                        message.role === MessageType.Assistant &&
                        filteredMessages.length - 1 === i;

                      // In deepinsight mode, show loading on the last message until content arrives
                      const shouldShowLoading =
                        isDeepinsightMode &&
                        sendLoading &&
                        isLastAssistantMessage
                          ? true
                          : !isDeepinsightMode &&
                            message.role === MessageType.Assistant &&
                            sendLoading &&
                            filteredMessages.length - 1 === i;

                      return (
                        <MessageItem
                          loading={shouldShowLoading}
                          key={buildMessageUuidWithRole(message)}
                          item={message}
                          nickname={userInfo.nickname}
                          avatar={userInfo.avatar}
                          avatarDialog={currentDialog.icon}
                          reference={buildMessageItemReference(
                            {
                              message: filteredMessages,
                              reference: conversation.reference,
                            },
                            message,
                          )}
                          clickDocumentButton={clickDocumentButton}
                          index={i}
                          removeMessageById={removeMessageById}
                          regenerateMessage={regenerateMessage}
                          sendLoading={sendLoading}
                          isDeepinsightChat={isDeepinsightMode}
                          isDeepinsightConference={isDeepinsightConferenceMode}
                          isCompleted={
                            isLastAssistantMessage && isCompleted
                              ? isCompleted
                              : false
                          }
                          conversationId={conversationId}
                          onSendMessage={handleStartResearchFromPlan}
                        ></MessageItem>
                      );
                    })}
                  </div>
                  <div ref={scrollRef} />
                </>
              );
            })()}
          </div>

          <div className="mt-3 flex-shrink-0">
            <NextMessageInput
              disabled={disabled}
              sendDisabled={sendDisabled}
              sendLoading={sendLoading}
              value={value}
              onInputChange={handleInputChange}
              onPressEnter={handlePressEnter}
              conversationId={conversationId}
              createConversationBeforeUploadDocument={
                createConversationBeforeUploadDocument
              }
              stopOutputMessage={stopOutputMessage}
              onUpload={handleUploadFile}
              isUploading={isUploading}
              removeFile={removeFile}
              showAttachmentButton={!isAnyDeepinsightMode}
              isDeepinsightMode={isAnyDeepinsightMode}
              conversationApi={conversationApi}
              selectedKbs={selectedKbs}
              onKbChange={setSelectedKbs}
              webSearch={webSearch}
              onWebSearchChange={setWebSearch}
            />
          </div>
        </div>

        {/* 右边的思考面板 - 在 deepinsight 模式下显示 */}
        {isDeepinsightMode && thinkingPanelVisible && (
          <div className="flex-1 border-l border-gray-200 overflow-y-auto h-full bg-white flex-shrink-0 flex flex-col">
            <DeepInsightThinkingPanel
              data={thinkingData}
              // deepinsightChat 模式下不显示右侧思考/结果面板的加载框
              loading={isDeepinsightMode ? false : sendLoading}
            />
          </div>
        )}
      </div>

      {visible && (
        <div className="p-5">
          <PdfDrawer
            visible={visible}
            hideModal={hideModal}
            documentId={documentId}
            chunk={selectedChunk}
          ></PdfDrawer>
        </div>
      )}
    </section>
  );
}
