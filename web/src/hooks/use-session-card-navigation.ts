/**
 * Hook 用于处理会话卡片点击后的导航
 * 确保在点击会话时正确拼接 conversationApi 参数
 */

import { useNavigateWithFromState } from '@/hooks/route-hook';
import { Routes } from '@/routes';
import { useCallback } from 'react';
import { useParams, useSearchParams } from 'umi';

export const useHandleSessionCardNavigation = () => {
  const { id: dialogId } = useParams<{ id: string }>();
  const navigate = useNavigateWithFromState();
  const [searchParams] = useSearchParams();
  const conversationApi = searchParams.get('conversationApi') || '';

  /**
   * 处理会话卡片点击
   * @param conversationId 会话ID
   * @param isNew 是否为新会话
   */
  const handleSessionCardClick = useCallback(
    (conversationId: string, isNew: boolean) => {
      if (!dialogId) return;

      // 构建完整的路径，包含 conversationApi 参数
      let path = `${Routes.Chat}/${dialogId}?conversationId=${conversationId}&isNew=${isNew ? 'true' : 'false'}`;

      // 如果当前有 conversationApi 参数，保留它
      if (conversationApi) {
        path += `&conversationApi=${conversationApi}`;
      }

      navigate(path);
    },
    [dialogId, navigate, conversationApi],
  );

  return { handleSessionCardClick };
};

/**
 * Hook 用于获取当前场景的导航路径
 */
export const useChatMenuItemPath = (dialogId: string) => {
  const [searchParams] = useSearchParams();
  const conversationApi = searchParams.get('conversationApi') || '';

  return {
    path:
      conversationApi === ''
        ? `${Routes.Chat}/${dialogId}`
        : `${Routes.Chat}/${dialogId}?conversationApi=${conversationApi}`,
    conversationApi,
  };
};
