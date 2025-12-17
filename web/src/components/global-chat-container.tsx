/**
 * 全局 Chat 容器
 * 维护三个场景的 Chat 组件始终在内存中
 * 通过 display: none 隐藏非活跃场景，确保所有数据和状态保持
 */
import React, { useMemo } from 'react';
import { useLocation, useParams } from 'umi';

interface GlobalChatContainerProps {
  ChatComponent: React.ComponentType<any>;
}

export function GlobalChatContainer({
  ChatComponent,
}: GlobalChatContainerProps) {
  const { pathname, search } = useLocation();
  const { id: currentDialogId } = useParams();

  // 三个场景的 dialogId 需要从配置或全局状态获取
  // 这里假设它们已经被加载
  const scenarios = useMemo(
    () => [
      { key: 'ask', name: '问一问', displayName: 'Ask' },
      { key: 'conference', name: '顶会洞察', displayName: 'Conference' },
      { key: 'deepinsight', name: '深度研究', displayName: 'DeepInsight' },
    ],
    [],
  );

  // 判断当前活跃的场景
  const isActivePath = (scenarioKey: string) => {
    const apiParam = new URLSearchParams(search).get('conversationApi');
    if (scenarioKey === 'ask') {
      return !apiParam; // ask 场景没有 conversationApi 参数
    }
    if (scenarioKey === 'conference') {
      return apiParam === 'deepinsightConferenceQuestion';
    }
    if (scenarioKey === 'deepinsight') {
      return apiParam === 'deepinsightChat';
    }
    return false;
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {scenarios.map((scenario) => (
        <div
          key={scenario.key}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: isActivePath(scenario.key) ? 'block' : 'none',
            visibility: isActivePath(scenario.key) ? 'visible' : 'hidden',
            pointerEvents: isActivePath(scenario.key) ? 'auto' : 'none',
            zIndex: isActivePath(scenario.key) ? 10 : -1,
          }}
          data-scenario={scenario.key}
        >
          <ChatComponent scenario={scenario.key} />
        </div>
      ))}
    </div>
  );
}
