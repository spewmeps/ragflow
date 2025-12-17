/**
 * 多场景路由状态管理
 * 为每个场景独立保存 conversationId、conversationApi 等路由参数
 * 切换场景时自动恢复上次的状态
 */

import { ChatSearchParams } from '@/constants/chat';
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
    console.log(`[useMultiScenarioRoute-${urlScenarioKey}] Hook running`, {
      urlScenarioKey,
      hasRestored: hasRestoredRef.current,
      navigationPending: navigationPendingRef.current,
      conversationId,
      lastRestoredScenarioKey,
    });

    // 如果正在等待导航完成，跳过这次检查
    if (navigationPendingRef.current) {
      console.log(
        `[useMultiScenarioRoute-${urlScenarioKey}] Navigation pending, skipping`,
      );
      return;
    }

    const previousScenario = lastScenarioRef.current;

    // 如果场景改变了
    if (previousScenario !== urlScenarioKey) {
      console.log(
        `[useMultiScenarioRoute-${urlScenarioKey}] 🔄 Scene changed: ${previousScenario} -> ${urlScenarioKey}`,
        {
          currentConversationId: conversationId,
          rawConversationApi,
          savedState: scenarioStateMap.get(urlScenarioKey),
        },
      );

      // 重置恢复标志
      hasRestoredRef.current = false;
      lastScenarioRef.current = urlScenarioKey;

      // 检查是否需要恢复
      // 但只有在这个场景还没有被恢复过的情况下才恢复
      const savedState = scenarioStateMap.get(urlScenarioKey);

      console.log(
        `[useMultiScenarioRoute-${urlScenarioKey}] Checking if restore needed:`,
        {
          hasSavedState: !!savedState,
          savedConversationId: savedState?.conversationId,
          currentConversationId: conversationId,
          needsRestore:
            savedState?.conversationId &&
            savedState.conversationId !== conversationId,
          lastRestoredScenarioKey,
        },
      );

      // 如果有保存的 conversationId 且与当前的不同，就恢复
      // 这确保菜单点击后立即恢复状态
      if (
        savedState?.conversationId &&
        savedState.conversationId !== conversationId
      ) {
        console.log(
          `[useMultiScenarioRoute-${urlScenarioKey}] 🚀 Restoring conversation from "${conversationId}" to "${savedState.conversationId}"`,
        );

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
        console.log(
          `[useMultiScenarioRoute-${urlScenarioKey}] 📍 Navigating to: /next-chat/${dialogId}${newSearch}`,
        );

        navigate({
          pathname: `/next-chat/${dialogId}`,
          search: newSearch,
        });

        // 延迟后清除标志
        setTimeout(() => {
          navigationPendingRef.current = false;
          console.log(
            `[useMultiScenarioRoute-${urlScenarioKey}] Navigation pending cleared`,
          );
        }, 100);
      }
    }
  }, [urlScenarioKey, conversationId, rawConversationApi, dialogId, navigate]);

  // 保存当前场景的状态
  const saveCurrentScenarioState = useCallback(() => {
    // 只保存当前有效的（非空）conversationId
    // 这样避免保存空状态，导致第二次切换时恢复失败
    if (conversationId) {
      const state: ScenarioRouteState = {
        conversationId,
        isNew,
        conversationApi,
      };
      console.log(
        `[useMultiScenarioRoute-${urlScenarioKey}] 💾 Saving state (only if conversationId is not empty):`,
        state,
      );
      scenarioStateMap.set(urlScenarioKey, state);
    } else {
      console.log(
        `[useMultiScenarioRoute-${urlScenarioKey}] ⚠️  Not saving state: conversationId is empty`,
      );
    }
  }, [urlScenarioKey, conversationId, isNew, conversationApi]);

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
