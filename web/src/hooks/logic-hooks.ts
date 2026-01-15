import { Authorization } from '@/constants/authorization';
import { MessageType } from '@/constants/chat';
import { LanguageTranslationMap } from '@/constants/common';
import { cleanupAfterStreamingRequest } from '@/hooks/use-aggressive-memory-cleanup';
import { ResponseType } from '@/interfaces/database/base';
import { IAnswer, Message } from '@/interfaces/database/chat';
import { IKnowledgeFile } from '@/interfaces/database/knowledge';
import { IClientConversation, IMessage } from '@/pages/chat/interface';
import api from '@/utils/api';
import { getAuthorization } from '@/utils/authorization-util';
import { buildMessageUuid } from '@/utils/chat';
import { parseDeepinsightData } from '@/utils/deepinsight-stream-parser';
import { PaginationProps, message } from 'antd';
import { FormInstance } from 'antd/lib';
import axios from 'axios';
import { EventSourceParserStream } from 'eventsource-parser/stream';
import { has, omit } from 'lodash';
import {
  ChangeEventHandler,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { v4 as uuid } from 'uuid';
import { useTranslate } from './common-hooks';
import { useSetPaginationParams } from './route-hook';
import { useFetchTenantInfo, useSaveSetting } from './user-setting-hooks';

export function usePrevious<T>(value: T) {
  const ref = useRef<T>();
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}

export const useSetSelectedRecord = <T = IKnowledgeFile>() => {
  const [currentRecord, setCurrentRecord] = useState<T>({} as T);

  const setRecord = (record: T) => {
    setCurrentRecord(record);
  };

  return { currentRecord, setRecord };
};

export const useChangeLanguage = () => {
  const { i18n } = useTranslation();
  const { saveSetting } = useSaveSetting();

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(
      LanguageTranslationMap[lng as keyof typeof LanguageTranslationMap],
    );
    saveSetting({ language: lng });
  };

  return changeLanguage;
};

export const useGetPaginationWithRouter = () => {
  const { t } = useTranslate('common');
  const {
    setPaginationParams,
    page,
    size: pageSize,
  } = useSetPaginationParams();

  const onPageChange: PaginationProps['onChange'] = useCallback(
    (pageNumber: number, pageSize: number) => {
      setPaginationParams(pageNumber, pageSize);
    },
    [setPaginationParams],
  );

  const setCurrentPagination = useCallback(
    (pagination: { page: number; pageSize?: number }) => {
      if (pagination.pageSize !== pageSize) {
        pagination.page = 1; // Reset to first page if pageSize changes
      }
      setPaginationParams(pagination.page, pagination.pageSize);
    },
    [setPaginationParams, pageSize],
  );

  const pagination: PaginationProps = useMemo(() => {
    return {
      showQuickJumper: true,
      total: 0,
      showSizeChanger: true,
      current: page,
      pageSize: pageSize,
      pageSizeOptions: [1, 2, 10, 20, 50, 100],
      onChange: onPageChange,
      showTotal: (total) => `${t('total')} ${total}`,
    };
  }, [t, onPageChange, page, pageSize]);

  return {
    pagination,
    setPagination: setCurrentPagination,
  };
};

export const useHandleSearchChange = () => {
  const [searchString, setSearchString] = useState('');
  const { setPagination } = useGetPaginationWithRouter();
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = e.target.value;
      setSearchString(value);
      setPagination({ page: 1 });
    },
    [setPagination],
  );

  return { handleInputChange, searchString };
};

export const useGetPagination = () => {
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10 });
  const { t } = useTranslate('common');

  const onPageChange: PaginationProps['onChange'] = useCallback(
    (pageNumber: number, pageSize: number) => {
      setPagination({ page: pageNumber, pageSize });
    },
    [],
  );

  const currentPagination: PaginationProps = useMemo(() => {
    return {
      showQuickJumper: true,
      total: 0,
      showSizeChanger: true,
      current: pagination.page,
      pageSize: pagination.pageSize,
      pageSizeOptions: [1, 2, 10, 20, 50, 100],
      onChange: onPageChange,
      showTotal: (total) => `${t('total')} ${total}`,
    };
  }, [t, onPageChange, pagination]);

  return {
    pagination: currentPagination,
  };
};

export interface AppConf {
  appName: string;
}

export const useFetchAppConf = () => {
  const [appConf, setAppConf] = useState<AppConf>({} as AppConf);
  const fetchAppConf = useCallback(async () => {
    const ret = await axios.get('/conf.json');

    setAppConf(ret.data);
  }, []);

  useEffect(() => {
    fetchAppConf();
  }, [fetchAppConf]);

  return appConf;
};

function useSetDoneRecord() {
  const [doneRecord, setDoneRecord] = useState<Record<string, boolean>>({});

  const clearDoneRecord = useCallback(() => {
    setDoneRecord({});
  }, []);

  const setDoneRecordById = useCallback((id: string, val: boolean) => {
    setDoneRecord((prev) => ({ ...prev, [id]: val }));
  }, []);

  const allDone = useMemo(() => {
    const values = Object.values(doneRecord);
    return values.length > 0 && values.every((val) => val);
  }, [doneRecord]);

  useEffect(() => {
    if (allDone) {
      clearDoneRecord();
    }
  }, [allDone, clearDoneRecord]);

  return {
    doneRecord,
    setDoneRecord,
    setDoneRecordById,
    clearDoneRecord,
    allDone,
  };
}

export const useSendMessageWithSse = (
  url: string = api.completeConversation,
) => {
  const [answer, setAnswer] = useState<IAnswer>({} as IAnswer);
  const [done, setDone] = useState(true);
  const { doneRecord, clearDoneRecord, setDoneRecordById, allDone } =
    useSetDoneRecord();
  const timer = useRef<any>();
  const sseRef = useRef<AbortController>();
  const answerRef = useRef<IAnswer>({} as IAnswer);
  const lastSetAnswerTimeRef = useRef<number>(0);

  // 判断是否为 deepinsight 类型的 API
  const isDeepinsightApi = useMemo(() => {
    return (
      url === api.deepinsightConferenceQuestion || url === api.deepinsightChat
    );
  }, [url]);

  const initializeSseRef = useCallback(() => {
    sseRef.current = new AbortController();
  }, []);

  const resetAnswer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => {
      setAnswer({} as IAnswer);
      clearTimeout(timer.current);
    }, 1000);
  }, []);

  const setDoneValue = useCallback(
    (body: any, value: boolean) => {
      if (has(body, 'chatBoxId')) {
        setDoneRecordById(body.chatBoxId, value);
      } else {
        setDone(value);
      }
    },
    [setDoneRecordById],
  );

  const send = useCallback(
    async (
      body: any,
      controller?: AbortController,
    ): Promise<{ response: Response; data: ResponseType } | undefined> => {
      initializeSseRef();
      try {
        setDoneValue(body, false);
        // 重置 ref 缓存
        answerRef.current = {} as IAnswer;
        lastSetAnswerTimeRef.current = 0;

        // 为 deepinsight API 设置更长的超时时间（默认 5 分钟，deepinsight 可能需要 1 小时）
        const timeoutMs = isDeepinsightApi ? 3600000 : 300000; // 3600s = 1 hour, 300s = 5 min
        const abortController = controller || sseRef.current;
        const timeoutId = setTimeout(() => abortController?.abort(), timeoutMs);

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            [Authorization]: getAuthorization(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(omit(body, 'chatBoxId')),
          signal: abortController?.signal,
        });

        // 请求成功，清除超时计时器
        clearTimeout(timeoutId);

        // 检查 HTTP 响应状态码
        if (!response.ok) {
          const errorText = `HTTP Error: ${response.status} ${response.statusText}`;
          console.error('Stream request failed:', errorText);
          // message.error(
          //   i18n.t('message.networkAnomaly') || 'Network error occurred',
          // );
          setDoneValue(body, true);
          return {
            data: { code: response.status, message: errorText } as any,
            response,
          };
        }

        const reader = response?.body
          ?.pipeThrough(new TextDecoderStream())
          .pipeThrough(new EventSourceParserStream())
          .getReader();

        try {
          while (true) {
            try {
              const x = await reader?.read();
              if (x) {
                const { done, value } = x;
                if (done) {
                  // 流读取完成，设置最后一次的 answer
                  if (
                    answerRef.current &&
                    Object.keys(answerRef.current).length > 0
                  ) {
                    setAnswer(answerRef.current);
                  }
                  resetAnswer();
                  break;
                }
                try {
                  const val = JSON.parse(value?.data || '');
                  const d = val?.data;

                  // 检查是否有错误响应码
                  if (val?.code && val.code !== 0) {
                    console.error('Stream data error:', val.code, val.message);
                    if (val.code === 500 || val.code >= 500) {
                      // 只跳过服务器错误
                      continue;
                    }
                  }

                  if (typeof d !== 'boolean') {
                    // 根据 API 类型选择解析器
                    let parsedAnswer: IAnswer;
                    if (isDeepinsightApi) {
                      parsedAnswer = parseDeepinsightData(
                        d,
                        body?.conversation_id,
                        body.chatBoxId,
                      );
                    } else {
                      parsedAnswer = {
                        ...d,
                        conversationId: body?.conversation_id,
                        chatBoxId: body.chatBoxId,
                      };
                    }
                    // 缓存最新的 answer 到 ref，使用节流避免频繁的状态更新
                    answerRef.current = parsedAnswer;
                    const now = Date.now();
                    // 每 100ms 最多更新一次 state，减少重新渲染次数
                    if (now - lastSetAnswerTimeRef.current >= 100) {
                      setAnswer(parsedAnswer);
                      lastSetAnswerTimeRef.current = now;
                    }
                  }
                } catch (e) {
                  console.error('Error parsing stream data:', e);
                  // Continue processing other chunks
                }
              }
            } catch (e) {
              if (e instanceof DOMException && e.name === 'AbortError') {
                console.log('Request was aborted by user or logic.');
                break;
              }
              // 流读取错误可能表示连接断开
              console.error('Stream read error:', e);
              setDoneValue(body, true);
              break;
            }
          }
        } finally {
          // 确保清理Reader资源，释放内存
          try {
            if (reader) {
              await reader.cancel();
              console.debug('[Memory] Reader cancelled to release resources');
            }
          } catch (e) {
            console.debug('[Memory] Error cancelling reader:', e);
          }
          // 流式请求完成后立即清理内存
          await cleanupAfterStreamingRequest(100);
        }
        setDoneValue(body, true);
        resetAnswer();
        return { data: { code: 0, message: 'Success' } as any, response };
      } catch (e) {
        setDoneValue(body, true);
        resetAnswer();

        // 处理超时和其他错误
        if (e instanceof DOMException && e.name === 'AbortError') {
          const timeoutMsg = isDeepinsightApi
            ? 'DeepInsight API (1 hour timeout)'
            : 'Standard API (5 min timeout)';
          console.error('Request timeout or aborted:', timeoutMsg);
          // message.error(i18n.t('message.requestTimeout') || 'Request timeout');
        } else if (e instanceof TypeError && e.message === 'Failed to fetch') {
          // 网络错误或CORS问题
          console.error('Network fetch error:', e);
          // message.error(
          //   i18n.t('message.networkAnomalyDescription') ||
          //     'Network connection failed',
          // );
        } else {
          // 其他未知错误
          console.error('Unexpected error in stream request1:', e);
          // message.error(i18n.t('message.requestError') || 'An error occurred');
        }
      }
    },
    [initializeSseRef, setDoneValue, resetAnswer, isDeepinsightApi, url],
  );

  const stopOutputMessage = useCallback(() => {
    sseRef.current?.abort();
  }, []);

  return {
    send,
    answer,
    done,
    doneRecord,
    allDone,
    setDone,
    resetAnswer,
    stopOutputMessage,
    clearDoneRecord,
  };
};

export const useSpeechWithSse = (url: string = api.tts) => {
  const read = useCallback(
    async (body: any) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          [Authorization]: getAuthorization(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      try {
        const res = await response.clone().json();
        if (res?.code !== 0) {
          message.error(res?.message);
        }
      } catch (error) {
        // Swallow errors silently
      }
      return response;
    },
    [url],
  );

  return { read };
};

//#region chat hooks

export const useScrollToBottom = (
  messages?: unknown,
  containerRef?: React.RefObject<HTMLDivElement>,
) => {
  const ref = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);

  useEffect(() => {
    isAtBottomRef.current = isAtBottom;
  }, [isAtBottom]);

  const checkIfUserAtBottom = useCallback(() => {
    if (!containerRef?.current) return true;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    return Math.abs(scrollTop + clientHeight - scrollHeight) < 25;
  }, [containerRef]);

  useEffect(() => {
    if (!containerRef?.current) return;
    const container = containerRef.current;

    const handleScroll = () => {
      setIsAtBottom(checkIfUserAtBottom());
    };

    container.addEventListener('scroll', handleScroll);
    handleScroll();
    return () => container.removeEventListener('scroll', handleScroll);
  }, [containerRef, checkIfUserAtBottom]);

  // Imperative scroll function
  const scrollToBottom = useCallback(() => {
    if (containerRef?.current) {
      const container = containerRef.current;
      container.scrollTo({
        top: container.scrollHeight - container.clientHeight,
        behavior: 'smooth',
      });
    }
  }, [containerRef]);

  useEffect(() => {
    if (!messages) return;
    if (!containerRef?.current) return;
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (isAtBottomRef.current) {
          scrollToBottom();
        }
      }, 100);
    });
  }, [messages, containerRef, scrollToBottom]);

  return { scrollRef: ref, isAtBottom, scrollToBottom };
};

export const useHandleMessageInputChange = () => {
  const [value, setValue] = useState('');

  const handleInputChange: ChangeEventHandler<HTMLTextAreaElement> = (e) => {
    const value = e.target.value;
    const nextValue = value.replaceAll('\\n', '\n').replaceAll('\\t', '\t');
    setValue(nextValue);
  };

  return {
    handleInputChange,
    value,
    setValue,
  };
};

export const useSelectDerivedMessages = () => {
  const [derivedMessages, setDerivedMessages] = useState<IMessage[]>([]);

  const messageContainerRef = useRef<HTMLDivElement>(null);

  const { scrollRef, scrollToBottom } = useScrollToBottom(
    derivedMessages,
    messageContainerRef,
  );

  const addNewestQuestion = useCallback(
    (message: Message, answer: string = '') => {
      setDerivedMessages((pre) => {
        // 确保用户消息有 ID（如果没有则生成）
        const userMessage = {
          ...message,
          id: message.id || uuid(),
        };

        // 为占位符消息生成完全独立且唯一的 ID
        let placeholderId = `placeholder_${Date.now()}_${uuid()}`;
        let attempts = 0;
        const existingIds = new Set(pre?.map((msg) => msg.id) ?? []);

        // 确保占位符 ID 不会与任何现有消息冲突
        while (existingIds.has(placeholderId) && attempts < 10) {
          placeholderId = `placeholder_${Date.now()}_${uuid()}`;
          attempts++;
        }

        const placeholderMessage = {
          role: MessageType.Assistant,
          content: answer,
          id: placeholderId,
        };

        return [...pre, userMessage, placeholderMessage];
      });
    },
    [],
  );

  const addNewestOneQuestion = useCallback((message: Message) => {
    setDerivedMessages((pre) => {
      return [
        ...pre,
        {
          ...message,
          id: buildMessageUuid(message), // The message id is generated on the front end,
          // and the message id returned by the back end is the same as the question id,
          //  so that the pair of messages can be deleted together when deleting the message
        },
      ];
    });
  }, []);

  // Add the streaming message to the last item in the message list
  // 简化版本：占位符消息使用独立的 ID 前缀，永远不会冲突
  const addNewestAnswer = useCallback((answer: IAnswer) => {
    setDerivedMessages((pre) => {
      if (!pre || pre.length === 0) {
        return [
          {
            role: MessageType.Assistant,
            content: answer.answer,
            reference: answer.reference,
            id: `answer_${answer.id}`, // 答案 ID 加上前缀，确保与用户消息区别
            prompt: answer.prompt,
            audio_binary: answer.audio_binary,
            data: omit(answer, [
              'answer',
              'reference',
              'prompt',
              'audio_binary',
            ]),
          },
        ];
      }

      // 答案消息的最终 ID：添加前缀以确保与用户消息区别
      const finalMessageId = `answer_${answer.id}`;

      // 首先检查是否已经存在这个答案 ID 的消息（流更新的情况）
      const existingAnswerIdx = pre.findIndex(
        (msg) => msg.id === finalMessageId,
      );

      if (existingAnswerIdx !== -1) {
        // 情况1：已存在相同 ID 的答案消息，直接更新它（流更新）
        const newMessages = pre.map((msg, idx) => {
          if (idx === existingAnswerIdx) {
            return {
              ...msg,
              content: answer.answer,
              reference: answer.reference,
              prompt: answer.prompt,
              audio_binary: answer.audio_binary,
              data: omit(answer, [
                'answer',
                'reference',
                'prompt',
                'audio_binary',
              ]),
            };
          }
          return msg;
        });

        if (newMessages.length > 200) {
          const trimmed = newMessages.slice(-100);
          console.debug(
            '[Memory] Trimmed messages from',
            newMessages.length,
            'to',
            trimmed.length,
          );
          return trimmed;
        }

        return newMessages;
      }

      // 获取当前最后一条消息
      const lastMessage = pre[pre.length - 1];

      // 检查最后一条消息是否是占位符消息（特征：ID 以 placeholder_ 开头）
      const isLastMessagePlaceholder =
        lastMessage?.role === MessageType.Assistant &&
        typeof lastMessage?.id === 'string' &&
        lastMessage.id.startsWith('placeholder_');

      if (isLastMessagePlaceholder) {
        // 情况2：最后一条消息是占位符消息，直接替换它
        const newMessages = [
          ...pre.slice(0, -1),
          {
            role: MessageType.Assistant,
            content: answer.answer,
            reference: answer.reference,
            id: finalMessageId,
            prompt: answer.prompt,
            audio_binary: answer.audio_binary,
            data: omit(answer, [
              'answer',
              'reference',
              'prompt',
              'audio_binary',
            ]),
          },
        ];

        if (newMessages.length > 200) {
          const trimmed = newMessages.slice(-100);
          console.debug(
            '[Memory] Trimmed messages from',
            newMessages.length,
            'to',
            trimmed.length,
          );
          return trimmed;
        }

        return newMessages;
      }

      // 情况3：最后一条消息不是占位符
      // 检查倒数第二条是否是占位符（标准模式下可能是这样）
      if (pre.length >= 2) {
        const secondLast = pre[pre.length - 2];
        const isSecondLastPlaceholder =
          secondLast?.role === MessageType.Assistant &&
          typeof secondLast?.id === 'string' &&
          secondLast.id.startsWith('placeholder_');

        if (isSecondLastPlaceholder) {
          // 替换倒数第二条（占位符），保留最后一条（用户消息）
          const newMessages = [
            ...pre.slice(0, -2),
            {
              role: MessageType.Assistant,
              content: answer.answer,
              reference: answer.reference,
              id: finalMessageId,
              prompt: answer.prompt,
              audio_binary: answer.audio_binary,
              data: omit(answer, [
                'answer',
                'reference',
                'prompt',
                'audio_binary',
              ]),
            },
            pre[pre.length - 1],
          ];

          if (newMessages.length > 200) {
            const trimmed = newMessages.slice(-100);
            console.debug(
              '[Memory] Trimmed messages from',
              newMessages.length,
              'to',
              trimmed.length,
            );
            return trimmed;
          }

          return newMessages;
        }
      }

      // 情况4：没有占位符，直接追加新的答案消息
      const newMessages = [
        ...pre,
        {
          role: MessageType.Assistant,
          content: answer.answer,
          reference: answer.reference,
          id: finalMessageId,
          prompt: answer.prompt,
          audio_binary: answer.audio_binary,
          data: omit(answer, ['answer', 'reference', 'prompt', 'audio_binary']),
        },
      ];

      if (newMessages.length > 200) {
        const trimmed = newMessages.slice(-100);
        console.debug(
          '[Memory] Trimmed messages from',
          newMessages.length,
          'to',
          trimmed.length,
        );
        return trimmed;
      }

      return newMessages;
    });
  }, []);

  // Add the streaming message to the last item in the message list
  const addNewestOneAnswer = useCallback((answer: IAnswer) => {
    setDerivedMessages((pre) => {
      const idx = pre.findIndex((x) => x.id === answer.id);

      let newMessages: any[];
      if (idx !== -1) {
        newMessages = pre.map((x) => {
          if (x.id === answer.id) {
            return {
              ...x,
              content: answer.answer,
              reference: answer.reference,
              prompt: answer.prompt,
              audio_binary: answer.audio_binary,
              data: omit(answer, [
                'answer',
                'reference',
                'prompt',
                'audio_binary',
              ]),
            };
          }
          return x;
        });
      } else {
        newMessages = [
          ...(pre ?? []),
          {
            role: MessageType.Assistant,
            content: answer.answer,
            reference: answer.reference,
            id: buildMessageUuid({
              id: answer.id,
              role: MessageType.Assistant,
            }),
            prompt: answer.prompt,
            audio_binary: answer.audio_binary,
            data: omit(answer, [
              'answer',
              'reference',
              'prompt',
              'audio_binary',
            ]),
          },
        ];
      }

      // 限制消息数量：超过200条时，只保留最近100条
      if (newMessages.length > 200) {
        const trimmed = newMessages.slice(-100);
        console.debug(
          '[Memory] Trimmed messages from',
          newMessages.length,
          'to',
          trimmed.length,
        );
        return trimmed;
      }

      return newMessages;
    });
  }, []);

  const removeLatestMessage = useCallback(() => {
    setDerivedMessages((pre) => {
      const nextMessages = pre?.slice(0, -2) ?? [];
      return nextMessages;
    });
  }, []);

  const removeMessageById = useCallback(
    (messageId: string) => {
      setDerivedMessages((pre) => {
        const nextMessages = pre?.filter((x) => x.id !== messageId) ?? [];
        return nextMessages;
      });
    },
    [setDerivedMessages],
  );

  const removeMessagesAfterCurrentMessage = useCallback(
    (messageId: string) => {
      setDerivedMessages((pre) => {
        const index = pre.findIndex((x) => x.id === messageId);
        if (index !== -1) {
          let nextMessages = pre.slice(0, index + 2) ?? [];
          const latestMessage = nextMessages.at(-1);
          nextMessages = latestMessage
            ? [
                ...nextMessages.slice(0, -1),
                {
                  ...latestMessage,
                  content: '',
                  reference: undefined,
                  prompt: undefined,
                },
              ]
            : nextMessages;
          return nextMessages;
        }
        return pre;
      });
    },
    [setDerivedMessages],
  );

  const removeAllMessages = useCallback(() => {
    setDerivedMessages([]);
  }, [setDerivedMessages]);

  const removeAllMessagesExceptFirst = useCallback(() => {
    setDerivedMessages((list) => {
      if (list.length <= 1) {
        return list;
      }
      return list.slice(0, 1);
    });
  }, [setDerivedMessages]);

  return {
    scrollRef,
    messageContainerRef,
    derivedMessages,
    setDerivedMessages,
    addNewestQuestion,
    addNewestAnswer,
    removeLatestMessage,
    removeMessageById,
    addNewestOneQuestion,
    addNewestOneAnswer,
    removeMessagesAfterCurrentMessage,
    removeAllMessages,
    scrollToBottom,
    removeAllMessagesExceptFirst,
  };
};

export interface IRemoveMessageById {
  removeMessageById(messageId: string): void;
}

export const useRemoveMessagesAfterCurrentMessage = (
  setCurrentConversation: (
    callback: (state: IClientConversation) => IClientConversation,
  ) => void,
) => {
  const removeMessagesAfterCurrentMessage = useCallback(
    (messageId: string) => {
      setCurrentConversation((pre) => {
        const index = pre.message?.findIndex((x) => x.id === messageId);
        if (index !== -1) {
          let nextMessages = pre.message?.slice(0, index + 2) ?? [];
          const latestMessage = nextMessages.at(-1);
          nextMessages = latestMessage
            ? [
                ...nextMessages.slice(0, -1),
                {
                  ...latestMessage,
                  content: '',
                  reference: undefined,
                  prompt: undefined,
                },
              ]
            : nextMessages;
          return {
            ...pre,
            message: nextMessages,
          };
        }
        return pre;
      });
    },
    [setCurrentConversation],
  );

  return { removeMessagesAfterCurrentMessage };
};

export interface IRegenerateMessage {
  regenerateMessage?: (message: Message) => void;
}

export const useRegenerateMessage = ({
  removeMessagesAfterCurrentMessage,
  sendMessage,
  messages,
}: {
  removeMessagesAfterCurrentMessage(messageId: string): void;
  sendMessage({
    message,
  }: {
    message: Message;
    messages?: Message[];
  }): void | Promise<any>;
  messages: Message[];
}) => {
  const regenerateMessage = useCallback(
    async (message: Message) => {
      if (message.id) {
        removeMessagesAfterCurrentMessage(message.id);
        const index = messages.findIndex((x) => x.id === message.id);
        let nextMessages;
        if (index !== -1) {
          nextMessages = messages.slice(0, index);
        }
        sendMessage({
          message: { ...message, id: uuid() },
          messages: nextMessages,
        });
      }
    },
    [removeMessagesAfterCurrentMessage, sendMessage, messages],
  );

  return { regenerateMessage };
};

// #endregion

/**
 *
 * @param defaultId
 * used to switch between different items, similar to radio
 * @returns
 */
export const useSelectItem = (defaultId?: string) => {
  const [selectedId, setSelectedId] = useState('');

  const handleItemClick = useCallback(
    (id: string) => () => {
      setSelectedId(id);
    },
    [],
  );

  useEffect(() => {
    if (defaultId) {
      setSelectedId(defaultId);
    }
  }, [defaultId]);

  return { selectedId, handleItemClick };
};

export const useFetchModelId = () => {
  const { data: tenantInfo } = useFetchTenantInfo(true);

  return tenantInfo?.llm_id ?? '';
};

const ChunkTokenNumMap = {
  naive: 128,
  knowledge_graph: 8192,
};

export const useHandleChunkMethodSelectChange = (form: FormInstance) => {
  // const form = Form.useFormInstance();
  const handleChange = useCallback(
    (value: string) => {
      if (value in ChunkTokenNumMap) {
        form.setFieldValue(
          ['parser_config', 'chunk_token_num'],
          ChunkTokenNumMap[value as keyof typeof ChunkTokenNumMap],
        );
      }
    },
    [form],
  );

  return handleChange;
};

// reset form fields when modal is form, closed
export const useResetFormOnCloseModal = ({
  form,
  visible,
}: {
  form: FormInstance;
  visible?: boolean;
}) => {
  const prevOpenRef = useRef<boolean>();
  useEffect(() => {
    prevOpenRef.current = visible;
  }, [visible]);
  const prevOpen = prevOpenRef.current;

  useEffect(() => {
    if (!visible && prevOpen) {
      form.resetFields();
    }
  }, [form, prevOpen, visible]);
};
