/**
 * 多场景路由状态管理
 * 为每个场景独立保存 conversationId、conversationApi 等路由参数
 * 切换场景时自动恢复上次的状态
 */

import { ChatSearchParams } from '@/constants/chat';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'umi';

interface ScenarioRouteState {
  conversationId?: string;
  isNew?: string;
  conversationApi?: string;
}

// 场景配置
const SCENARIOS = {
  ask: {
    key: 'ask',
    conversationApi: '',
    label: '问一问',
  },
  conference: {
    key: 'conference',
    conversationApi: 'deepinsightConferenceQuestion',
    label: '顶会洞察',
  },
  deepinsight: {
    key: 'deepinsight',
    conversationApi: 'deepinsightChat',
    label: '深度研究',
  },
};

// 全局状态存储：保存每个场景的路由参数
const scenarioStateMap = new Map<string, ScenarioRouteState>();

// 全局标志：跟踪上次恢复的场景，防止重复恢复
let lastRestoredScenarioKey = 'ask';

/**
 * 获取当前场景的 key
 */
export const getCurrentScenarioKey = (conversationApi?: string): string => {
  if (conversationApi === 'deepinsightConferenceQuestion') return 'conference';
  if (conversationApi === 'deepinsightChat') return 'deepinsight';
  // Handle both empty string and 'ask' as Ask scenario
  return 'ask';
};

/**
 * 获取指定场景的保存状态（菜单导航时使用）
 */
export const getScenarioSavedState = (
  scenarioKey: string,
): ScenarioRouteState | undefined => {
  return scenarioStateMap.get(scenarioKey);
};

/**
 * Hook: 管理多场景路由状态
 * 当切换场景时，自动恢复该场景上次的 conversationId
 *
 * 注意：此 Hook 在三个场景的 ChatContent 中都会运行，
 * 但内部会判断当前实例是否活跃，只有活跃时才执行恢复
 */
export const useMultiScenarioRoute = () => {
  const [searchParams] = useSearchParams();
  const { id: dialogId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const lastScenarioRef = useRef<string>('ask');
  const navigationPendingRef = useRef<boolean>(false);
  const hasRestoredRef = useRef<boolean>(false);

  // 获取当前场景的 conversationApi
  // Normalize: 'ask' in URL maps to empty string internally
  const rawConversationApi = searchParams.get('conversationApi') || '';
  const conversationApi =
    rawConversationApi === 'ask' ? '' : rawConversationApi;
  const urlScenarioKey = getCurrentScenarioKey(rawConversationApi);
  const conversationId =
    searchParams.get(ChatSearchParams.ConversationId) || '';
  const isNew = searchParams.get(ChatSearchParams.isNew) || '';

  // 监听场景切换，恢复上次保存的会话
  useEffect(() => {
    // hook running

    // 如果正在等待导航完成，跳过这次检查
    if (navigationPendingRef.current) {
      return;
    }

    const previousScenario = lastScenarioRef.current;

    // 如果场景改变了
    if (previousScenario !== urlScenarioKey) {
      // scene changed

      // 重置恢复标志
      hasRestoredRef.current = false;
      lastScenarioRef.current = urlScenarioKey;

      // 检查是否需要恢复
      // 但只有在这个场景还没有被恢复过的情况下才恢复
      const savedState = scenarioStateMap.get(urlScenarioKey);

      // checking if restore needed

      // 如果有保存的 conversationId 且与当前的不同，就恢复
      // 这确保菜单点击后立即恢复状态
      if (
        savedState?.conversationId &&
        savedState.conversationId !== conversationId
      ) {
        // restoring conversation

        hasRestoredRef.current = true;
        navigationPendingRef.current = true;
        lastRestoredScenarioKey = urlScenarioKey;

        const newParams = new URLSearchParams();
        newParams.set(
          ChatSearchParams.ConversationId,
          savedState.conversationId,
        );
        if (savedState.isNew) {
          newParams.set(ChatSearchParams.isNew, savedState.isNew);
        }

        // For Ask scenario, use 'ask' as the conversationApi parameter
        // For other scenarios, use their respective API identifiers
        const apiParam =
          urlScenarioKey === 'ask'
            ? 'ask'
            : SCENARIOS[urlScenarioKey as keyof typeof SCENARIOS]
                ?.conversationApi || '';

        if (apiParam) {
          newParams.set('conversationApi', apiParam);
        }

        const newSearch = `?${newParams.toString()}`;
        // navigating to saved conversation

        navigate({
          pathname: `/next-chat/${dialogId}`,
          search: newSearch,
        });
        // 延迟后清除标志并触发 react-query 缓存失效，确保新的 conversationId 会被重新请求
        const savedConversationId = savedState?.conversationId;
        const savedConversationApi = savedState?.conversationApi ?? '';
        setTimeout(() => {
          navigationPendingRef.current = false;

          try {
            if (savedConversationId) {
              // 只失效目标场景和会话对应的缓存，避免触发所有保活实例的 refetch
              queryClient.invalidateQueries({
                queryKey: [
                  'fetchConversation',
                  savedConversationId,
                  savedConversationApi,
                ],
              });
            }
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[useMultiScenarioRoute] invalidateQueries failed', e);
          }
        }, 100);
      }
    }
  }, [urlScenarioKey, conversationId, rawConversationApi, dialogId, navigate]);

  // 保存当前场景的状态
  const saveCurrentScenarioState = useCallback(
    (conversationList?: Array<{ id: string; is_new?: boolean }>) => {
      // 如果当前是虚拟会话（isNew=true）且真实会话列表无数据，则不保存该虚拟会话
      if (
        isNew === 'true' &&
        (!conversationList || conversationList.length === 0)
      ) {
        // current is virtual session and no real conversations exist, not saving state
        return;
      }

      // 如果当前是虚拟会话（isNew=true），则改为保存会话列表的第一条会话
      let finalConversationId = conversationId;
      let finalIsNew = isNew;

      if (isNew === 'true' && conversationList && conversationList.length > 0) {
        // 找到第一条真实会话（is_new 不为 true）
        const firstRealConversation = conversationList.find(
          (conv) => conv.is_new !== true,
        );
        if (firstRealConversation) {
          finalConversationId = firstRealConversation.id;
          finalIsNew = '';
          // current is virtual session, replacing with first real conversation
        }
      }

      // 只保存当前有效的（非空）conversationId
      // 这样避免保存空状态，导致第二次切换时恢复失败
      if (finalConversationId) {
        const state: ScenarioRouteState = {
          conversationId: finalConversationId,
          isNew: finalIsNew,
          conversationApi,
        };
        // saving state
        scenarioStateMap.set(urlScenarioKey, state);
      } else {
        // 没有会话时，清除该场景的保存状态
        scenarioStateMap.delete(urlScenarioKey);
      }
    },
    [urlScenarioKey, conversationId, isNew, conversationApi],
  );

  // 获取当前场景的完整状态
  const getCurrentScenarioState = useCallback(() => {
    return scenarioStateMap.get(urlScenarioKey) || {};
  }, [urlScenarioKey]);

  // 获取指定场景的状态
  const getScenarioState = useCallback((scenarioKey: string) => {
    return scenarioStateMap.get(scenarioKey) || {};
  }, []);

  return {
    currentScenarioKey: urlScenarioKey,
    conversationApi,
    conversationId,
    isNew,
    dialogId,
    getCurrentScenarioState,
    getScenarioState,
    saveCurrentScenarioState,
    scenarioStateMap,
  };
};
