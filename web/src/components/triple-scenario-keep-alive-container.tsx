/**
 * 终极 Keep-Alive 方案：三场景独立保活容器
 *
 * 原理：
 * 1. 三个场景的 Chat 组件始终挂载在内存中
 * 2. 通过 CSS display/visibility 控制显示/隐藏
 * 3. 路由不变，只改变 URL 参数 (conversationApi)
 * 4. React Query 的 staleTime: Infinity 保证数据不过期
 * 5. 所有流式数据、计时器、WebSocket 等状态全部保持
 * 6. 只有登出时才清除缓存
 */

import { ChatContent } from '@/pages/next-chats/chat/chat-content';
import { useMemo } from 'react';
import { useLocation } from 'umi';

interface ScenarioConfig {
  key: string;
  conversationApi?: string; // URL 参数值
  label: string;
}

const SCENARIOS: ScenarioConfig[] = [
  {
    key: 'ask',
    conversationApi: undefined,
    label: '问一问',
  },
  {
    key: 'conference',
    conversationApi: 'deepinsightConferenceQuestion',
    label: '顶会洞察',
  },
  {
    key: 'deepinsight',
    conversationApi: 'deepinsightChat',
    label: '深度研究',
  },
];

export function TripleScenarioKeepAliveContainer() {
  const { search } = useLocation();

  // 判断当前活跃的场景
  const getCurrentScenarioKey = useMemo(() => {
    const params = new URLSearchParams(search);
    const apiParam = params.get('conversationApi');

    // Handle both 'ask' and empty string as Ask scenario
    if (apiParam === 'deepinsightConferenceQuestion') return 'conference';
    if (apiParam === 'deepinsightChat') return 'deepinsight';
    // Default to 'ask' for empty, undefined, or 'ask' parameter
    return 'ask';
  }, [search]);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        display: 'block',
      }}
    >
      {SCENARIOS.map((scenario) => {
        const isActive = scenario.key === getCurrentScenarioKey;
        return (
          <div
            key={scenario.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              width: '100%',
              height: '100%',
              display: isActive ? 'block' : 'none',
              visibility: isActive ? 'visible' : 'hidden',
              pointerEvents: isActive ? 'auto' : 'none',
              zIndex: isActive ? 1 : 0,
              // 关键：inactive 的场景虽然 display:none，但组件仍在内存中
              // React 不会卸载它，所有状态都被保留
              overflow: 'hidden',
            }}
            data-scenario={scenario.key}
          >
            <ChatContent />
          </div>
        );
      })}
    </div>
  );
}
