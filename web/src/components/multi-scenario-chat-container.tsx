/**
 * 三场景聊天容器
 * 在 /next-chats/chat/:id 级别，维护三个场景的 Chat 实例始终在内存中
 * 通过路由参数的 conversationApi 来判断显示哪个场景
 */
import { useChatKeepAlive } from '@/hooks/use-chat-keep-alive';
import ChatPage from '@/pages/next-chats/chat';
import { useEffect, useRef } from 'react';
import { useLocation, useParams } from 'umi';

interface ScenarioConfig {
  key: string;
  apiParam?: string; // conversationApi 参数值，空字符串表示默认场景
  name: string;
}

const SCENARIOS: ScenarioConfig[] = [
  { key: 'ask', apiParam: '', name: '问一问' },
  {
    key: 'conference',
    apiParam: 'deepinsightConferenceQuestion',
    name: '顶会洞察',
  },
  { key: 'deepinsight', apiParam: 'deepinsightChat', name: '深度研究' },
];

export function MultiScenarioChatContainer() {
  const { search } = useLocation();
  const { id: dialogId } = useParams();
  const manager = useChatKeepAlive();
  const containerRef = useRef<HTMLDivElement>(null);

  // 获取当前活跃的场景
  const getCurrentScenario = (): ScenarioConfig => {
    const params = new URLSearchParams(search);
    const apiParam = params.get('conversationApi') || '';
    const scenario = SCENARIOS.find((s) => s.apiParam === apiParam);
    return scenario || SCENARIOS[0]; // 默认返回 ask 场景
  };

  const currentScenario = getCurrentScenario();

  // 在挂载时，为每个场景创建一个容器（实际会通过路由参数控制显示）
  useEffect(() => {
    // 注册当前场景
    manager.registerChatInstance(currentScenario.key, containerRef);
  }, [currentScenario.key, manager]);

  // 清理退出登录时的数据
  useEffect(() => {
    const handleLogout = () => {
      // 登出时会清除缓存，这里可以做额外的清理
    };

    return () => {
      // 组件卸载时的清理（但在我们的设计中不会卸载）
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
      }}
    >
      <ChatPage />
    </div>
  );
}
