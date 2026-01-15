import { ChatSearchParams } from '@/constants/chat';
import {
  IConversation,
  IDialog,
  IStats,
  IToken,
} from '@/interfaces/database/chat';
import {
  IAskRequestBody,
  IFeedbackRequestBody,
} from '@/interfaces/request/chat';
import i18n from '@/locales/config';
import { IClientConversation } from '@/pages/chat/interface';
import { useGetSharedChatSearchParams } from '@/pages/chat/shared-hooks';
import chatService from '@/services/chat-service';
import {
  buildMessageListWithUuid,
  getConversationId,
  isConversationIdExist,
} from '@/utils/chat';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { message } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { has, set } from 'lodash';
import { useCallback, useMemo, useState } from 'react';
import { history, useNavigate, useParams, useSearchParams } from 'umi';

//#region logic

export const useClickDialogCard = () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_, setSearchParams] = useSearchParams();

  const newQueryParameters: URLSearchParams = useMemo(() => {
    return new URLSearchParams();
  }, []);

  const handleClickDialog = useCallback(
    (dialogId: string) => {
      newQueryParameters.set(ChatSearchParams.DialogId, dialogId);
      // newQueryParameters.set(
      //   ChatSearchParams.ConversationId,
      //   EmptyConversationId,
      // );
      setSearchParams(newQueryParameters);
    },
    [newQueryParameters, setSearchParams],
  );

  return { handleClickDialog };
};

export const useClickConversationCard = () => {
  const [currentQueryParameters, setSearchParams] = useSearchParams();
  const newQueryParameters: URLSearchParams = useMemo(
    () => new URLSearchParams(currentQueryParameters.toString()),
    [currentQueryParameters],
  );

  const handleClickConversation = useCallback(
    (conversationId: string, isNew: string) => {
      newQueryParameters.set(ChatSearchParams.ConversationId, conversationId);
      newQueryParameters.set(ChatSearchParams.isNew, isNew);
      setSearchParams(newQueryParameters);
    },
    [setSearchParams, newQueryParameters],
  );

  return { handleClickConversation };
};

export const useGetChatSearchParams = () => {
  const [currentQueryParameters] = useSearchParams();

  return {
    dialogId: currentQueryParameters.get(ChatSearchParams.DialogId) || '',
    conversationId:
      currentQueryParameters.get(ChatSearchParams.ConversationId) || '',
    isNew: currentQueryParameters.get(ChatSearchParams.isNew) || '',
  };
};

//#endregion

//#region dialog

export const useFetchNextDialogList = (pureFetch = false) => {
  const { handleClickDialog } = useClickDialogCard();
  const { dialogId } = useGetChatSearchParams();

  const {
    data,
    isFetching: loading,
    refetch,
  } = useQuery<IDialog[]>({
    queryKey: ['fetchDialogList'],
    initialData: [],
    gcTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async (...params) => {
      console.log('🚀 ~ queryFn: ~ params:', params);
      const { data } = await chatService.listDialog();

      if (data.code === 0) {
        const list: IDialog[] = data.data;
        if (!pureFetch) {
          if (list.length > 0) {
            if (list.every((x) => x.id !== dialogId)) {
              handleClickDialog(data.data[0].id);
            }
          } else {
            history.push('/chat');
          }
        }
      }

      return data?.data ?? [];
    },
  });

  return { data, loading, refetch };
};

export const useFetchChatAppList = () => {
  const {
    data,
    isFetching: loading,
    refetch,
  } = useQuery<IDialog[]>({
    queryKey: ['fetchChatAppList'],
    initialData: [],
    gcTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data } = await chatService.listDialog({
        params: {
          keywords: '',
          page_size: 50,
          page: 1,
        },
      });

      return data?.data?.dialogs ?? [];
    },
  });

  return { data, loading, refetch };
};

export const useSetNextDialog = () => {
  const queryClient = useQueryClient();

  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: ['setDialog'],
    mutationFn: async (params: IDialog) => {
      const { data } = await chatService.setDialog(params);
      if (data.code === 0) {
        queryClient.invalidateQueries({
          exact: false,
          queryKey: ['fetchDialogList'],
        });

        queryClient.invalidateQueries({
          queryKey: ['fetchDialog'],
        });
        message.success(
          i18n.t(`message.${params.dialog_id ? 'modified' : 'created'}`),
        );
      }
      return data?.code;
    },
  });

  return { data, loading, setDialog: mutateAsync };
};

export const useFetchNextDialog = () => {
  const { dialogId } = useGetChatSearchParams();

  const {
    data,
    isFetching: loading,
    refetch,
  } = useQuery<IDialog>({
    queryKey: ['fetchDialog', dialogId],
    gcTime: 0,
    initialData: {} as IDialog,
    enabled: !!dialogId,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data } = await chatService.getDialog({ dialogId });

      return data?.data ?? ({} as IDialog);
    },
  });

  return { data, loading, refetch };
};

export const useFetchManualDialog = () => {
  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: ['fetchManualDialog'],
    gcTime: 0,
    mutationFn: async (dialogId: string) => {
      const { data } = await chatService.getDialog({ dialogId });

      return data;
    },
  });

  return { data, loading, fetchDialog: mutateAsync };
};

export const useRemoveNextDialog = () => {
  const queryClient = useQueryClient();

  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: ['removeDialog'],
    mutationFn: async (dialogIds: string[]) => {
      const { data } = await chatService.removeDialog({ dialogIds });
      if (data.code === 0) {
        queryClient.invalidateQueries({ queryKey: ['fetchDialogList'] });

        message.success(i18n.t('message.deleted'));
      }
      return data.code;
    },
  });

  return { data, loading, removeDialog: mutateAsync };
};

//#endregion

//#region conversation

export const useFetchNextConversationList = () => {
  const { dialogId } = useGetChatSearchParams();
  const { handleClickConversation } = useClickConversationCard();
  const {
    data,
    isFetching: loading,
    refetch,
  } = useQuery<IConversation[]>({
    queryKey: ['fetchConversationList', dialogId],
    initialData: [],
    gcTime: 0,
    refetchOnWindowFocus: false,
    enabled: !!dialogId,
    queryFn: async () => {
      const { data } = await chatService.listConversation({ dialogId });
      if (data.code === 0) {
        if (data.data.length > 0) {
          handleClickConversation(data.data[0].id, '');
        }
        // 如果列表为空，不做任何自动导航处理
      }
      return data?.data;
    },
  });

  return { data, loading, refetch };
};

export const useFetchNextConversation = () => {
  const { isNew, conversationId } = useGetChatSearchParams();
  const { sharedId } = useGetSharedChatSearchParams();
  const {
    data,
    isFetching: loading,
    refetch,
  } = useQuery<IClientConversation>({
    queryKey: ['fetchConversation', conversationId],
    initialData: {} as IClientConversation,
    // enabled: isConversationIdExist(conversationId),
    gcTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (
        isNew !== 'true' &&
        isConversationIdExist(sharedId || conversationId)
      ) {
        const { data } = await chatService.getConversation({
          conversationId: conversationId || sharedId,
        });

        const conversation = data?.data ?? {};

        const messageList = buildMessageListWithUuid(conversation?.message);

        return { ...conversation, message: messageList };
      }
      return { message: [] };
    },
  });

  return { data, loading, refetch };
};

export const useFetchNextConversationSSE = () => {
  const { isNew } = useGetChatSearchParams();
  const { sharedId } = useGetSharedChatSearchParams();
  const {
    data,
    isFetching: loading,
    refetch,
  } = useQuery<IClientConversation>({
    queryKey: ['fetchConversationSSE', sharedId],
    initialData: {} as IClientConversation,
    gcTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (isNew !== 'true' && isConversationIdExist(sharedId || '')) {
        if (!sharedId) return {};
        const { data } = await chatService.getConversationSSE({}, sharedId);
        const conversation = data?.data ?? {};
        const messageList = buildMessageListWithUuid(conversation?.message);
        return { ...conversation, message: messageList };
      }
      return { message: [] };
    },
  });

  return { data, loading, refetch };
};

export const useFetchManualConversation = () => {
  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: ['fetchManualConversation'],
    gcTime: 0,
    mutationFn: async (conversationId: string) => {
      const { data } = await chatService.getConversation({ conversationId });

      return data;
    },
  });

  return { data, loading, fetchConversation: mutateAsync };
};

export const useUpdateNextConversation = () => {
  const queryClient = useQueryClient();
  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: ['updateConversation'],
    mutationFn: async (params: Record<string, any>) => {
      const { data } = await chatService.setConversation({
        ...params,
        conversation_id: params.conversation_id
          ? params.conversation_id
          : getConversationId(),
      });
      if (data.code === 0) {
        queryClient.invalidateQueries({ queryKey: ['fetchConversationList'] });
        message.success(i18n.t(`message.modified`));
      }
      return data;
    },
  });

  return { data, loading, updateConversation: mutateAsync };
};

export const useRemoveNextConversation = () => {
  const queryClient = useQueryClient();
  const { conversationId: currentConversationId } = useGetChatSearchParams();
  const { id: dialogId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: ['removeConversation'],
    mutationFn: async (conversationIds: string[]) => {
      const { data } = await chatService.removeConversation({
        conversationIds,
        dialogId,
      });
      if (data.code === 0) {
        queryClient.invalidateQueries({ queryKey: ['fetchConversationList'] });
      }
      return { code: data.code, conversationIds };
    },
    onSuccess: async (result) => {
      if (result.code === 0) {
        // 检查删除的是否是当前正在查看的会话
        const shouldNavigate = result.conversationIds.includes(
          currentConversationId,
        );
        if (shouldNavigate) {
          // 删除当前会话后，需要导航到其他会话
          // 直接调用 API 获取最新会话列表（不触发 queryFn 的自动导航逻辑）
          try {
            const listResult = await chatService.listConversation(
              { params: { dialog_id: dialogId } },
              true,
            );

            if (
              listResult?.data?.code === 0 &&
              listResult.data.data &&
              listResult.data.data.length > 0
            ) {
              // 导航到列表中的第一个会话
              const firstConversation = listResult.data.data[0];
              const newParams = new URLSearchParams(searchParams.toString());
              newParams.set(
                ChatSearchParams.ConversationId,
                firstConversation.id,
              );
              newParams.delete(ChatSearchParams.isNew);
              navigate({
                pathname: `/chat/${dialogId}`,
                search: `?${newParams.toString()}`,
              });
              // 更新缓存
              queryClient.setQueryData(
                ['fetchConversationList', dialogId],
                listResult.data.data,
              );
            } else {
              // 如果没有其他会话，导航到空会话状态
              const newParams = new URLSearchParams();
              newParams.set(ChatSearchParams.ConversationId, '');
              if (searchParams.has(ChatSearchParams.ConversationApi)) {
                newParams.set(
                  ChatSearchParams.ConversationApi,
                  searchParams.get(ChatSearchParams.ConversationApi)!,
                );
              }
              navigate({
                pathname: `/chat/${dialogId}`,
                search: `?${newParams.toString()}`,
              });
              // 更新缓存
              queryClient.setQueryData(['fetchConversationList', dialogId], []);
            }
          } catch (err) {
            console.error('获取会话列表失败:', err);
          }
        }
      }
    },
  });

  return { data, loading, removeConversation: mutateAsync };
};

export const useDeleteMessage = () => {
  const { conversationId } = useGetChatSearchParams();

  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: ['deleteMessage'],
    mutationFn: async (messageId: string) => {
      const { data } = await chatService.deleteMessage({
        messageId,
        conversationId,
      });

      if (data.code === 0) {
        message.success(i18n.t(`message.deleted`));
      }

      return data.code;
    },
  });

  return { data, loading, deleteMessage: mutateAsync };
};

export const useFeedback = () => {
  const { conversationId } = useGetChatSearchParams();

  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: ['feedback'],
    mutationFn: async (params: IFeedbackRequestBody) => {
      const { data } = await chatService.thumbup({
        ...params,
        conversationId,
      });
      if (data.code === 0) {
        message.success(i18n.t(`message.operated`));
      }
      return data.code;
    },
  });

  return { data, loading, feedback: mutateAsync };
};

//#endregion

// #region API provided for external calls

export const useCreateNextToken = () => {
  const queryClient = useQueryClient();
  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: ['createToken'],
    mutationFn: async (params: Record<string, any>) => {
      const { data } = await chatService.createToken(params);
      if (data.code === 0) {
        queryClient.invalidateQueries({ queryKey: ['fetchTokenList'] });
      }
      return data?.data ?? [];
    },
  });

  return { data, loading, createToken: mutateAsync };
};

export const useFetchTokenList = (params: Record<string, any>) => {
  const {
    data,
    isFetching: loading,
    refetch,
  } = useQuery<IToken[]>({
    queryKey: ['fetchTokenList', params],
    initialData: [],
    gcTime: 0,
    queryFn: async () => {
      const { data } = await chatService.listToken(params);

      return data?.data ?? [];
    },
  });

  return { data, loading, refetch };
};

export const useRemoveNextToken = () => {
  const queryClient = useQueryClient();
  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: ['removeToken'],
    mutationFn: async (params: {
      tenantId: string;
      dialogId?: string;
      tokens: string[];
    }) => {
      const { data } = await chatService.removeToken(params);
      if (data.code === 0) {
        queryClient.invalidateQueries({ queryKey: ['fetchTokenList'] });
      }
      return data?.data ?? [];
    },
  });

  return { data, loading, removeToken: mutateAsync };
};

type RangeValue = [Dayjs | null, Dayjs | null] | null;

const getDay = (date?: Dayjs) => date?.format('YYYY-MM-DD');

export const useFetchNextStats = () => {
  const [pickerValue, setPickerValue] = useState<RangeValue>([
    dayjs().subtract(7, 'day'),
    dayjs(),
  ]);
  const { data, isFetching: loading } = useQuery<IStats>({
    queryKey: ['fetchStats', pickerValue],
    initialData: {} as IStats,
    gcTime: 0,
    queryFn: async () => {
      if (Array.isArray(pickerValue) && pickerValue[0]) {
        const { data } = await chatService.getStats({
          fromDate: getDay(pickerValue[0]),
          toDate: getDay(pickerValue[1] ?? dayjs()),
        });
        return data?.data ?? {};
      }
      return {};
    },
  });

  return { data, loading, pickerValue, setPickerValue };
};

//#endregion

//#region shared chat

export const useCreateNextSharedConversation = () => {
  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: ['createSharedConversation'],
    mutationFn: async (userId?: string) => {
      const { data } = await chatService.createExternalConversation({ userId });

      return data;
    },
  });

  return { data, loading, createSharedConversation: mutateAsync };
};

// deprecated
export const useFetchNextSharedConversation = (
  conversationId?: string | null,
) => {
  const { data, isPending: loading } = useQuery({
    queryKey: ['fetchSharedConversation'],
    enabled: !!conversationId,
    queryFn: async () => {
      if (!conversationId) {
        return {};
      }
      const { data } = await chatService.getExternalConversation(
        null,
        conversationId,
      );

      const messageList = buildMessageListWithUuid(data?.data?.message);

      set(data, 'data.message', messageList);

      return data;
    },
  });

  return { data, loading };
};

//#endregion

//#region search page

export const useFetchMindMap = () => {
  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: ['fetchMindMap'],
    gcTime: 0,
    mutationFn: async (params: IAskRequestBody) => {
      try {
        const ret = await chatService.getMindMap(params);
        return ret?.data?.data ?? {};
      } catch (error: any) {
        if (has(error, 'message')) {
          message.error(error.message);
        }

        return [];
      }
    },
  });

  return { data, loading, fetchMindMap: mutateAsync };
};

export const useFetchRelatedQuestions = () => {
  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: ['fetchRelatedQuestions'],
    gcTime: 0,
    mutationFn: async (question: string): Promise<string[]> => {
      const { data } = await chatService.getRelatedQuestions({ question });

      return data?.data ?? [];
    },
  });

  return { data, loading, fetchRelatedQuestions: mutateAsync };
};
//#endregion
