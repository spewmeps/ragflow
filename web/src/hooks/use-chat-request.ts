import { FileUploadProps } from '@/components/file-upload';
import message from '@/components/ui/message';
import { ChatSearchParams } from '@/constants/chat';
import {
  IConversation,
  IDialog,
  IExternalChatInfo,
} from '@/interfaces/database/chat';
import { IAskRequestBody } from '@/interfaces/request/chat';
import { IClientConversation } from '@/pages/next-chats/chat/interface';
import { useGetSharedChatSearchParams } from '@/pages/next-chats/hooks/use-send-shared-message';
import { isConversationIdExist } from '@/pages/next-chats/utils';
import chatService from '@/services/next-chat-service';
import { buildMessageListWithUuid, getConversationId } from '@/utils/chat';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDebounce } from 'ahooks';
import { has } from 'lodash';
import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'umi';
import {
  useGetPaginationWithRouter,
  useHandleSearchChange,
} from './logic-hooks';
import { useHandleSearchStrChange } from './logic-hooks/use-change-search';

export const enum ChatApiAction {
  FetchDialogList = 'fetchDialogList',
  RemoveDialog = 'removeDialog',
  SetDialog = 'setDialog',
  FetchDialog = 'fetchDialog',
  FetchConversationList = 'fetchConversationList',
  FetchConversation = 'fetchConversation',
  UpdateConversation = 'updateConversation',
  RemoveConversation = 'removeConversation',
  DeleteMessage = 'deleteMessage',
  FetchMindMap = 'fetchMindMap',
  FetchRelatedQuestions = 'fetchRelatedQuestions',
  UploadAndParse = 'upload_and_parse',
  FetchExternalChatInfo = 'fetchExternalChatInfo',
}

export const useGetChatSearchParams = () => {
  const [currentQueryParameters] = useSearchParams();

  return {
    dialogId: currentQueryParameters.get(ChatSearchParams.DialogId) || '',
    conversationId:
      currentQueryParameters.get(ChatSearchParams.ConversationId) || '',
    isNew: currentQueryParameters.get(ChatSearchParams.isNew) || '',
  };
};

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

export const useFetchDialogList = () => {
  const { searchString, handleInputChange } = useHandleSearchChange();
  const { pagination, setPagination } = useGetPaginationWithRouter();
  const debouncedSearchString = useDebounce(searchString, { wait: 500 });

  const {
    data,
    isFetching: loading,
    refetch,
  } = useQuery<{ dialogs: IDialog[]; total: number }>({
    queryKey: [
      ChatApiAction.FetchDialogList,
      {
        debouncedSearchString,
        ...pagination,
      },
    ],
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data } = await chatService.listDialog(
        {
          params: {
            keywords: debouncedSearchString,
            page_size: pagination.pageSize,
            page: pagination.current,
          },
          data: {},
        },
        true,
      );

      return data?.data ?? { dialogs: [], total: 0 };
    },
  });

  const onInputChange: React.ChangeEventHandler<HTMLInputElement> = useCallback(
    (e) => {
      handleInputChange(e);
    },
    [handleInputChange],
  );

  return {
    data: data || { dialogs: [], total: 0 },
    loading,
    refetch,
    searchString,
    handleInputChange: onInputChange,
    pagination: { ...pagination, total: data?.total ?? 0 },
    setPagination,
  };
};

export const useRemoveDialog = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: [ChatApiAction.RemoveDialog],
    mutationFn: async (dialogIds: string[]) => {
      const { data } = await chatService.removeDialog({ dialogIds });
      if (data.code === 0) {
        queryClient.invalidateQueries({ queryKey: ['fetchDialogList'] });

        message.success(t('message.deleted'));
      }
      return data.code;
    },
  });

  return { data, loading, removeDialog: mutateAsync };
};

export const useSetDialog = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: [ChatApiAction.SetDialog],
    mutationFn: async (params: Partial<IDialog>) => {
      const { data } = await chatService.setDialog(params);
      if (data.code === 0) {
        queryClient.invalidateQueries({
          exact: false,
          queryKey: [ChatApiAction.FetchDialogList],
        });

        queryClient.invalidateQueries({
          queryKey: [ChatApiAction.FetchDialog],
        });

        message.success(
          t(`message.${params.dialog_id ? 'modified' : 'created'}`),
        );
      }
      return data?.code;
    },
  });

  return { data, loading, setDialog: mutateAsync };
};

export const useFetchDialog = () => {
  const { id } = useParams();

  const {
    data,
    isFetching: loading,
    refetch,
  } = useQuery<IDialog>({
    queryKey: [ChatApiAction.FetchDialog, id],
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
    enabled: !!id,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data } = await chatService.getDialog(
        { params: { dialogId: id } },
        true,
      );

      return data?.data ?? ({} as IDialog);
    },
  });

  return { data: data || ({} as IDialog), loading, refetch };
};

//#region Conversation

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
      // 🔑 保留现有的 conversationApi 参数，不要删除
      // 这样可以确保不同场景（问一问、顶会洞察、深度研究）之间切换时
      // 能够保持场景的一致性
      setSearchParams(newQueryParameters);
    },
    [setSearchParams, newQueryParameters],
  );

  return { handleClickConversation };
};

export const useFetchConversationList = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  // Normalize conversationApi: 'ask' in URL maps to empty string internally
  const conversationApi = (() => {
    const param = searchParams.get('conversationApi') || '';
    return param === 'ask' ? '' : param;
  })();
  const { conversationId } = useGetChatSearchParams();
  const { handleClickConversation } = useClickConversationCard();

  const { searchString, handleInputChange } = useHandleSearchStrChange();

  const {
    data,
    isFetching: loading,
    refetch,
  } = useQuery<IConversation[]>({
    // 🔑 关键：queryKey 中不包含 conversationApi，因为会话列表与 API 无关
    // 同一个对话框的不同场景共享同一个会话列表
    // 这样确保 conversationApi 改变时不会重新拉取会话列表
    queryKey: [ChatApiAction.FetchConversationList, id],
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    enabled: !!id,
    select(data) {
      return searchString
        ? data.filter((x) => x.name.includes(searchString))
        : data;
    },
    queryFn: async () => {
      const { data } = await chatService.listConversation(
        { params: { dialog_id: id } },
        true,
      );
      if (data.code === 0) {
        if (data.data.length > 0) {
          // 🔑 只有在没有 conversationId 时才自动跳转
          if (!conversationId) {
            handleClickConversation(data.data[0].id, '');
          }
        }
        // 如果列表为空，不做任何自动导航处理
        // 让用户主动创建新会话或保持当前状态
      }
      return data?.data;
    },
  });

  return {
    data: data || [],
    loading,
    refetch,
    searchString,
    handleInputChange,
  };
};

export const useFetchConversation = () => {
  const { isNew, conversationId } = useGetChatSearchParams();
  const [searchParams] = useSearchParams();
  // Normalize conversationApi: 'ask' in URL maps to empty string internally
  const conversationApi = (() => {
    const param = searchParams.get('conversationApi') || '';
    return param === 'ask' ? '' : param;
  })();
  const { sharedId } = useGetSharedChatSearchParams();
  // Hook init (no debug logs)

  const {
    data,
    isFetching: loading,
    refetch,
  } = useQuery<IClientConversation>({
    // 🔑 queryKey 包含 conversationApi
    // 不同场景的同一个 conversationId 对应不同的数据
    // 必须分别缓存，否则切换场景后看不到数据
    queryKey: [
      ChatApiAction.FetchConversation,
      conversationId,
      conversationApi,
    ],
    // enabled: isConversationIdExist(conversationId),
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      // queryFn invoked (no debug logs)

      if (
        isNew !== 'true' &&
        isConversationIdExist(sharedId || conversationId)
      ) {
        const { data } = await chatService.getConversation(
          {
            params: {
              conversationId: conversationId || sharedId,
            },
          },
          true,
        );

        const conversation = data?.data ?? {};

        const messageList = buildMessageListWithUuid(conversation?.message);

        return { ...conversation, message: messageList };
      }
      return { message: [] };
    },
  });

  return {
    data: data || ({ message: [] } as IClientConversation),
    loading,
    refetch,
  };
};

export const useUpdateConversation = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: [ChatApiAction.UpdateConversation],
    mutationFn: async (params: Record<string, any>) => {
      const { data } = await chatService.setConversation({
        ...params,
        conversation_id: params.conversation_id
          ? params.conversation_id
          : getConversationId(),
      });
      if (data.code === 0) {
        queryClient.invalidateQueries({
          queryKey: [ChatApiAction.FetchConversationList],
        });
        message.success(t(`message.modified`));
      }
      return data;
    },
  });

  return { data, loading, updateConversation: mutateAsync };
};

export const useRemoveConversation = () => {
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
    mutationKey: [ChatApiAction.RemoveConversation],
    mutationFn: async (conversationIds: string[]) => {
      const { data } = await chatService.removeConversation({
        conversationIds,
        dialogId,
      });
      if (data.code === 0) {
        queryClient.invalidateQueries({
          queryKey: [ChatApiAction.FetchConversationList],
        });
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
                pathname: `/next-chat/${dialogId}`,
                search: `?${newParams.toString()}`,
              });
              // 更新缓存
              queryClient.setQueryData(
                [ChatApiAction.FetchConversationList, dialogId],
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
                pathname: `/next-chat/${dialogId}`,
                search: `?${newParams.toString()}`,
              });
              // 更新缓存
              queryClient.setQueryData(
                [ChatApiAction.FetchConversationList, dialogId],
                [],
              );
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
  const { t } = useTranslation();

  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: [ChatApiAction.DeleteMessage],
    mutationFn: async (messageId: string) => {
      const { data } = await chatService.deleteMessage({
        messageId,
        conversationId,
      });

      if (data.code === 0) {
        message.success(t(`message.deleted`));
      }

      return data.code;
    },
  });

  return { data, loading, deleteMessage: mutateAsync };
};

type UploadParameters = Parameters<NonNullable<FileUploadProps['onUpload']>>;

type X = {
  file: UploadParameters[0][0];
  options: UploadParameters[1];
  conversationId?: string;
};

export function useUploadAndParseFile() {
  const { conversationId: id } = useGetChatSearchParams();
  const { t } = useTranslation();
  const controller = useRef(new AbortController());

  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: [ChatApiAction.UploadAndParse],
    mutationFn: async ({
      file,
      options: { onProgress, onSuccess, onError },
      conversationId,
    }: X) => {
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('conversation_id', conversationId || id);

        const { data } = await chatService.uploadAndParse(
          {
            signal: controller.current.signal,
            data: formData,
            onUploadProgress: ({ progress }) => {
              onProgress(file, (progress || 0) * 100 - 1);
            },
          },
          true,
        );

        onProgress(file, 100);

        if (data.code === 0) {
          onSuccess(file);
          message.success(t(`message.uploaded`));
        } else {
          onError(file, new Error(data.message));
        }

        return data;
      } catch (error) {
        onError(file, error as Error);
      }
    },
  });

  const cancel = useCallback(() => {
    controller.current.abort();
    controller.current = new AbortController();
  }, [controller]);

  return { data, loading, uploadAndParseFile: mutateAsync, cancel };
}

export const useFetchExternalChatInfo = () => {
  const { sharedId: id } = useGetSharedChatSearchParams();

  const {
    data,
    isFetching: loading,
    refetch,
  } = useQuery<IExternalChatInfo>({
    queryKey: [ChatApiAction.FetchExternalChatInfo, id],
    gcTime: 0,
    initialData: {} as IExternalChatInfo,
    enabled: !!id,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data } = await chatService.fetchExternalChatInfo(id!);

      return data?.data;
    },
  });

  return { data, loading, refetch };
};

//#endregion

//#region search page

export const useFetchMindMap = () => {
  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: [ChatApiAction.FetchMindMap],
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
    mutationKey: [ChatApiAction.FetchRelatedQuestions],
    gcTime: 0,
    mutationFn: async (question: string): Promise<string[]> => {
      const { data } = await chatService.getRelatedQuestions({ question });

      return data?.data ?? [];
    },
  });

  return { data, loading, fetchRelatedQuestions: mutateAsync };
};
//#endregion
