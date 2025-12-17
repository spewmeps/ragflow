/**
 * 获取当前聊天场景信息的 Hook
 */

import {
  ChatScenario,
  SCENARIO_CONFIG_MAP,
} from '@/contexts/chat-scenario-context';
import { useSearchParams } from 'umi';

export const useChatScenarioConfig = () => {
  const [searchParams] = useSearchParams();
  const conversationApi = searchParams.get('conversationApi') || '';

  // 根据 conversationApi 参数确定当前场景
  let currentScenario = ChatScenario.Ask;
  if (conversationApi === 'deepinsightConferenceQuestion') {
    currentScenario = ChatScenario.Conference;
  } else if (conversationApi === 'deepinsightChat') {
    currentScenario = ChatScenario.DeepInsight;
  }

  const config = SCENARIO_CONFIG_MAP[currentScenario];

  return {
    scenario: currentScenario,
    config,
    conversationApi,
    isDeepinsightMode: conversationApi === 'deepinsightChat',
    isConferenceMode: conversationApi === 'deepinsightConferenceQuestion',
  };
};
