import { Authorization } from '@/constants/authorization';
import { cleanupAfterStreamingRequest } from '@/hooks/use-aggressive-memory-cleanup';
import { IReferenceObject } from '@/interfaces/database/chat';
import { BeginQuery } from '@/pages/agent/interface';
import api from '@/utils/api';
import { getAuthorization } from '@/utils/authorization-util';
import { useCallback, useRef, useState } from 'react';

export enum MessageEventType {
  WorkflowStarted = 'workflow_started',
  NodeStarted = 'node_started',
  NodeFinished = 'node_finished',
  Message = 'message',
  MessageEnd = 'message_end',
  WorkflowFinished = 'workflow_finished',
  UserInputs = 'user_inputs',
  NodeLogs = 'node_logs',
}

export interface IAnswerEvent<T> {
  event: MessageEventType;
  message_id: string;
  session_id: string;
  created_at: number;
  task_id: string;
  data: T;
}

export interface INodeData {
  inputs: Record<string, any>;
  outputs: Record<string, any>;
  component_id: string;
  component_name: string;
  component_type: string;
  error: null | string;
  elapsed_time: number;
  created_at: number;
  thoughts: string;
}

export interface IInputData {
  content: string;
  inputs: Record<string, BeginQuery>;
  tips: string;
}
export interface IAttachment {
  doc_id: string;
  format: string;
  file_name: string;
}
export interface IMessageData {
  content: string;
  outputs: any;
  start_to_think?: boolean;
  end_to_think?: boolean;
}

export interface IMessageEndData {
  reference: IReferenceObject;
}

export interface ILogData extends INodeData {
  logs: {
    name: string;
    result: string;
    args: {
      query: string;
      topic: string;
    };
  };
}

export type INodeEvent = IAnswerEvent<INodeData>;

export type IMessageEvent = IAnswerEvent<IMessageData>;

export type IMessageEndEvent = IAnswerEvent<IMessageEndData>;

export type IInputEvent = IAnswerEvent<IInputData>;

export type ILogEvent = IAnswerEvent<ILogData>;

export type IChatEvent = INodeEvent | IMessageEvent | IMessageEndEvent;

export type IEventList = Array<IChatEvent>;

export const useSendMessageBySSE = (url: string = api.completeConversation) => {
  const [answerList, setAnswerList] = useState<IEventList>([]);
  const [done, setDone] = useState(true);
  const timer = useRef<any>();
  const sseRef = useRef<AbortController>();
  const readerRef = useRef<ReadableStreamDefaultReader | null>(null);

  const initializeSseRef = useCallback(() => {
    sseRef.current = new AbortController();
  }, []);

  const resetAnswerList = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => {
      setAnswerList((prev) => {
        // 限制答案列表大小：超过300条时，只保留最近150条
        if (prev.length > 300) {
          const trimmed = prev.slice(-150);
          console.debug(
            '[SSE] Trimmed answerList from',
            prev.length,
            'to',
            trimmed.length,
          );
          return trimmed;
        }
        return prev;
      });
      clearTimeout(timer.current);
    }, 1000);
  }, []);

  /**
   * 清理Reader资源
   */
  const cleanupReader = useCallback(async () => {
    if (readerRef.current) {
      try {
        await readerRef.current.cancel();
        console.debug('[SSE] Reader cancelled');
      } catch (e) {
        console.debug('[SSE] Error cancelling reader:', e);
      }
      readerRef.current = null;
    }
  }, []);

  const send = useCallback(
    async (
      body: any,
      controller?: AbortController,
    ): Promise<{ response: Response; data: ResponseType } | undefined> => {
      initializeSseRef();
      // 立即清理旧的reader
      await cleanupReader();
      // 重置答案列表
      setAnswerList([]);

      let reader: ReadableStreamDefaultReader | null = null;
      let buffer = '';

      try {
        setDone(false);
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            [Authorization]: getAuthorization(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller?.signal || sseRef.current?.signal,
        });

        // 检查 HTTP 响应状态码
        if (!response.ok) {
          const errorText = `HTTP Error: ${response.status} ${response.statusText}`;
          console.error('Stream request failed:', errorText);
          setDone(true);
          return {
            data: { code: response.status, message: errorText } as any,
            response,
          };
        }

        const res = response.clone().json();

        // 避免EventSourceParserStream的内存积累，改用手动解析
        const stream = response.body?.pipeThrough(new TextDecoderStream());
        if (!stream) {
          throw new Error('Failed to create stream');
        }

        reader = stream.getReader();
        if (!reader) {
          throw new Error('Failed to create reader');
        }

        readerRef.current = reader;

        while (true) {
          try {
            const x = await reader?.read();
            if (x) {
              const { done, value } = x;
              if (done) {
                // 处理最后的缓冲区
                if (buffer.trim()) {
                  try {
                    const line = buffer.trim();
                    if (line.startsWith('data: ')) {
                      // 移除 'data: ' 前缀并处理额外空格
                      const jsonStr = line.replace(/^data:\s*/, '').trim();
                      if (!jsonStr) continue;
                      const val = JSON.parse(jsonStr);
                      // 检查错误响应 - 只跳过服务器错误
                      if (
                        !(val.code === 500 || (val.code && val.code >= 500))
                      ) {
                        setAnswerList((list) => {
                          const nextList =
                            list.length > 200
                              ? list.slice(-100)
                              : [...list, val];
                          return nextList;
                        });
                      }
                    }
                  } catch (e) {
                    console.debug('Error processing final line:', e);
                  }
                }
                buffer = '';
                resetAnswerList();
                break;
              }

              try {
                // 手动解析SSE格式
                buffer += value;
                const lines = buffer.split('\n');
                buffer = lines[lines.length - 1];

                for (let i = 0; i < lines.length - 1; i++) {
                  const line = lines[i].trim();
                  if (!line || line.startsWith(':')) continue;

                  if (line.startsWith('data: ')) {
                    try {
                      // 移除 'data: ' 前缀并处理额外空格
                      const jsonStr = line.replace(/^data:\s*/, '').trim();
                      if (!jsonStr) continue;
                      const val = JSON.parse(jsonStr);

                      // 检查错误响应 - 只跳过服务器错误（500+）
                      if (val.code === 500 || (val.code && val.code >= 500)) {
                        continue;
                      }

                      // 记录非成功的状态码但继续处理消息
                      if (val.code !== 0 && val.code) {
                        console.warn(
                          'Stream response error:',
                          val.code,
                          val.message,
                        );
                      }

                      // 添加所有有效的消息到列表（包括系统消息）
                      setAnswerList((list) => {
                        // 严格限制：超过200立即修剪到100
                        if (list.length >= 200) {
                          const trimmed = list.slice(-100);
                          console.warn('[SSE] List at 200, trimmed to 100');
                          return [...trimmed, val];
                        }
                        return [...list, val];
                      });
                    } catch (parseErr) {
                      console.error(
                        '[SSE] JSON parse error:',
                        parseErr,
                        'line (first 150 chars):',
                        line.slice(0, 150),
                        'length:',
                        line.length,
                      );
                    }
                  }
                }
              } catch (e) {
                console.debug('Error parsing stream data:', e);
              }
            }
          } catch (e) {
            if (e instanceof DOMException && e.name === 'AbortError') {
              console.log('Request was aborted by user or logic.');
              break;
            }
            console.error('Stream read error:', e);
            setDone(true);
            break;
          }
        }
        console.info('Stream completed');
        setDone(true);
        resetAnswerList();
        return { data: await res, response };
      } catch (e) {
        setDone(true);
        resetAnswerList();

        if (e instanceof DOMException && e.name === 'AbortError') {
          console.error('Request timeout or aborted');
        } else if (e instanceof TypeError && e.message === 'Failed to fetch') {
          console.error('Network fetch error:', e);
        } else {
          console.warn('Unexpected error in stream request2:', e);
        }
      } finally {
        // 彻底清理所有资源
        buffer = '';
        try {
          if (reader) {
            await reader.cancel();
            console.debug('[Memory] Stream reader cleaned up');
          }
        } catch (e) {
          console.debug('[Memory] Error cancelling reader:', e);
        }
        readerRef.current = null;
        // 清理reader资源
        await cleanupReader();
        // 流式请求完成后的激进清理
        await cleanupAfterStreamingRequest(300);
      }
    },
    [initializeSseRef, url, resetAnswerList, cleanupReader],
  );

  const stopOutputMessage = useCallback(() => {
    sseRef.current?.abort();
  }, []);

  return {
    send,
    answerList,
    done,
    setDone,
    resetAnswerList,
    stopOutputMessage,
  };
};
