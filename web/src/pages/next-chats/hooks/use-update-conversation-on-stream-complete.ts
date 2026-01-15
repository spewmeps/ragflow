/**
 * 流式会话完成后的会话数据持久化更新Hook
 * 确保在场景切换后仍能恢复最新的会话数据
 */

import { ChatApiAction } from '@/hooks/use-chat-request';
import { Message } from '@/interfaces/database/chat';
import chatService from '@/services/next-chat-service';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useParams, useSearchParams } from 'umi';

interface UpdateConversationDataParams {
  conversationId: string;
  messages: Message[];
}

/**
 * Hook: 在流式会话完成后更新会话数据
 * 通过接口持久化更新，确保保活数据最新
 */
export const useUpdateConversationOnStreamComplete = () => {
  const { id: dialogId } = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();

  // 从 URL 获取当前场景的 conversationApi
  const conversationApi = (() => {
    const param = searchParams.get('conversationApi') || '';
    return param === 'ask' ? '' : param;
  })();

  /**
   * 触发会话数据更新
   * 在流式完成(MessageEnd事件)后调用
   */
  const updateConversationData = useCallback(
    async (params: UpdateConversationDataParams) => {
      const { conversationId, messages } = params;

      if (!conversationId || !messages.length) {
        console.warn(
          '[useUpdateConversationOnStreamComplete] Missing required params:',
          { conversationId: !!conversationId, messagesLength: messages.length },
        );
        return;
      }

      try {
        console.log(
          '[useUpdateConversationOnStreamComplete] Updating conversation after stream complete:',
          {
            conversationId,
            messageCount: messages.length,
            dialogId,
          },
        );

        // 直接调用服务，无需通过 useUpdateConversation Hook
        // 避免显示成功提示（因为这是自动后台更新）
        const response = await chatService.setConversation({
          dialog_id: dialogId,
          conversation_id: conversationId,
          message: messages,
          // 不更新会话名称，避免覆盖原有的会话名
          name: undefined,
          // 流式完成更新时，不是新建会话，所以is_new为false
          is_new: false,
        });

        const data = response?.data;
        if (data?.code === 0) {
          console.log(
            '[useUpdateConversationOnStreamComplete] Successfully updated conversation',
          );

          // 🔑 流式完成后，更新 React Query 缓存，防止场景切换回来数据消失
          const cachedData = {
            ...data?.data,
            message: messages,
          };

          // 更新 React Query 缓存，这样切换场景回来时可以从缓存恢复
          queryClient.setQueryData(
            [ChatApiAction.FetchConversation, conversationId, conversationApi],
            cachedData,
          );

          console.log(
            '[useUpdateConversationOnStreamComplete] Updated React Query cache for scenario:',
            {
              conversationId,
              conversationApi,
              messageCount: messages.length,
            },
          );
        } else {
          console.warn(
            '[useUpdateConversationOnStreamComplete] Failed to update conversation:',
            data,
          );
        }

        return data;
      } catch (error) {
        console.error(
          '[useUpdateConversationOnStreamComplete] Error updating conversation:',
          error,
        );
      }
    },
    [dialogId, conversationApi, queryClient],
  );

  return { updateConversationData };
};
