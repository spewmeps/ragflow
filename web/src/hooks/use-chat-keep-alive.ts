import {
  ChatKeepAliveContext,
  IChatKeepAliveManager,
} from '@/contexts/chat-keep-alive-context';
import { useContext } from 'react';

export const useChatKeepAlive = (): IChatKeepAliveManager => {
  const manager = useContext(ChatKeepAliveContext);
  if (!manager) {
    throw new Error(
      'useChatKeepAlive must be used within ChatKeepAliveProvider',
    );
  }
  return manager;
};
