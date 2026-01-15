import MessageItem from '@/components/message-item';
import { ChatSearchParams, MessageType } from '@/constants/chat';
import { useStreamingRequest } from '@/contexts/streaming-request-context';
import { Flex, Spin } from 'antd';
import {
  useCreateConversationBeforeUploadDocument,
  useGetFileIcon,
  useGetSendButtonDisabled,
  useSendButtonDisabled,
  useSendNextMessage,
} from '../hooks';
import { buildMessageItemReference } from '../utils';

import DeepInsightThinkingPanel from '@/components/deepinsight-thinking-panel';
import MessageInput from '@/components/message-input';
import PdfDrawer from '@/components/pdf-drawer';
import { useClickDrawer } from '@/components/pdf-drawer/hooks';
import {
  useFetchNextConversation,
  useFetchNextDialog,
  useGetChatSearchParams,
} from '@/hooks/chat-hooks';
import { useFetchUserInfo } from '@/hooks/user-setting-hooks';
import { AnswerItem } from '@/interfaces/database/chat';
import { buildMessageUuidWithRole } from '@/utils/chat';
import { useEffect, useMemo } from 'react';
import { useLocation } from 'umi';

interface IProps {
  controller: AbortController;
  settingsPanelOpen?: boolean;
  conversationId?: string; // 来自 URL 的 conversationId，供外部触发 refetch
  isActive?: boolean;
}

const ChatContainer = ({ controller, settingsPanelOpen = false }: IProps) => {
  // 优先使用外部传入的 conversationId（如 GlobalChatContainer 传入），否则从 URL 中读取
  const { conversationId: conversationIdFromUrl } = useGetChatSearchParams();
  const externalConversationId =
    (props as any)?.conversationId || conversationIdFromUrl;
  const isActive = (props as any)?.isActive ?? true;
  const { data: conversation, refetch } = useFetchNextConversation();
  const { data: currentDialog } = useFetchNextDialog();
  const { search } = useLocation();
  const { setIsStreaming } = useStreamingRequest();

  // 获取路由参数，判断会话类型
  const conversationApi = useMemo(() => {
    const params = new URLSearchParams(search);
    return params.get(ChatSearchParams.ConversationApi) || '';
  }, [search]);

  // 判断是否为任何 deepinsight 模式
  const isDeepinsightMode =
    conversationApi === 'deepinsightChat' ||
    conversationApi === 'deepinsightConferenceQuestion';

  const {
    value,
    scrollRef,
    messageContainerRef,
    loading,
    sendLoading,
    derivedMessages,
    handleInputChange,
    handlePressEnter,
    regenerateMessage,
    removeMessageById,
    stopOutputMessage,
  } = useSendNextMessage(controller);

  // 将 sendLoading 状态同步到全局 Context
  useEffect(() => {
    setIsStreaming(sendLoading);
  }, [sendLoading, setIsStreaming]);

  // NOTE: Removed explicit refetch here to avoid duplicate requests. useMultiScenarioRoute
  // will invalidate only the precise cache for the target scenario so that only the
  // active instance will fetch the conversation.

  // 提取deepinsight思考数据
  const thinkingData = useMemo(() => {
    const lastMessage = derivedMessages?.[derivedMessages.length - 1];
    // 尝试从 answer 字段获取数据，而不是 answerArray
    const answerArray =
      lastMessage?.data?.answer || lastMessage?.data?.answerArray;
    if (
      lastMessage?.role === MessageType.Assistant &&
      Array.isArray(answerArray)
    ) {
      return answerArray as AnswerItem[];
    }
    return [];
  }, [derivedMessages]);

  // 在 deepinsight 模式下，根据 conversationApi 类型进行不同的消息过滤
  const filteredMessages = useMemo(() => {
    if (!isDeepinsightMode) {
      return derivedMessages;
    }

    // 对于 deepinsightChat，过滤掉 type 为 think 和 result 的消息
    if (conversationApi === 'deepinsightChat') {
      return derivedMessages?.filter((msg) => {
        // 保留所有用户消息
        if (msg.role === MessageType.User) {
          return true;
        }
        // 对于助手消息，过滤掉 type 为 think 或 result 的
        if (msg.role === MessageType.Assistant) {
          const messageType = msg.data?.type;
          return messageType !== 'think' && messageType !== 'result';
        }
        return true;
      });
    }

    // 对于 deepinsightConferenceQuestion 和其他模式，保留所有消息
    return derivedMessages;
  }, [derivedMessages, isDeepinsightMode, conversationApi]);

  // 检测是否为deepinsightChat模式
  const isDeepinsightChat = useMemo(() => {
    return thinkingData.length > 0;
  }, [thinkingData]);

  const { visible, hideModal, documentId, selectedChunk, clickDocumentButton } =
    useClickDrawer();
  const disabled = useGetSendButtonDisabled();
  const sendDisabled = useSendButtonDisabled(value);
  useGetFileIcon();
  const { data: userInfo } = useFetchUserInfo();
  const { createConversationBeforeUploadDocument } =
    useCreateConversationBeforeUploadDocument();

  return (
    <>
      <Flex
        flex={1}
        className={`${styles.chatContainer} ${isDeepinsightChat ? styles.withThinkingPanel : ''}`}
        vertical
      >
        <Flex
          flex={1}
          className={styles.messageWrapper}
          style={{ width: '100%', boxSizing: 'border-box' }}
        >
          <Flex
            flex={1}
            vertical
            className={styles.messageContainer}
            ref={messageContainerRef}
          >
            <div style={{ width: '100%', boxSizing: 'border-box' }}>
              <Spin spinning={loading}>
                {filteredMessages?.map((message, i) => {
                  return (
                    <MessageItem
                      loading={
                        message.role === MessageType.Assistant &&
                        sendLoading &&
                        filteredMessages.length - 1 === i
                      }
                      key={buildMessageUuidWithRole(message)}
                      item={message}
                      nickname={userInfo.nickname}
                      avatar={userInfo.avatar}
                      avatarDialog={currentDialog.icon}
                      reference={buildMessageItemReference(
                        {
                          message: derivedMessages,
                          reference: conversation.reference,
                        },
                        message,
                      )}
                      clickDocumentButton={clickDocumentButton}
                      index={i}
                      removeMessageById={removeMessageById}
                      regenerateMessage={regenerateMessage}
                      sendLoading={sendLoading}
                    ></MessageItem>
                  );
                })}
              </Spin>
            </div>
            <div ref={scrollRef} />
          </Flex>

          {isDeepinsightChat && !settingsPanelOpen && (
            <div className={styles.thinkingPanelWrapper}>
              <DeepInsightThinkingPanel
                data={thinkingData}
                // 在 deepinsightChat 模式下不要在右侧面板显示加载框
                loading={isDeepinsightMode ? false : sendLoading}
              />
            </div>
          )}
        </Flex>
        <MessageInput
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
        ></MessageInput>
      </Flex>
      <PdfDrawer
        visible={visible}
        hideModal={hideModal}
        documentId={documentId}
        chunk={selectedChunk}
      ></PdfDrawer>
    </>
  );
};

export default memo(ChatContainer);
