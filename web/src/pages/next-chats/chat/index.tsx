/**
 * /next-chats/chat/:id 路由页面
 * 使用终极三场景 Keep-Alive 方案
 * 三个场景（问一问、顶会洞察、深度研究）始终在内存中
 */

import { TripleScenarioKeepAliveContainer } from '@/components/triple-scenario-keep-alive-container';

export default function Chat() {
  return <TripleScenarioKeepAliveContainer />;
}
