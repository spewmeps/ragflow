/**
 * /next-chats/chat/:id 路由的三场景 Keep-Alive 包装
 * 替换原来的 Chat 页面，提供终极 Keep-Alive 方案
 */

import { TripleScenarioKeepAliveContainer } from '@/components/triple-scenario-keep-alive-container';

export default function ChatWithKeepAlive() {
  return <TripleScenarioKeepAliveContainer />;
}
