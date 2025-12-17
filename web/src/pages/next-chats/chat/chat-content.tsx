/**
 * 原始 Chat 页面内容
 * 由 TripleScenarioKeepAliveContainer 复用
 */

import EmbedDialog from '@/components/embed-dialog';
import { useShowEmbedModal } from '@/components/embed-dialog/use-show-embed-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SharedFrom } from '@/constants/chat';
import { useSetModalState } from '@/hooks/common-hooks';
import {
  useFetchConversation,
  useGetChatSearchParams,
} from '@/hooks/use-chat-request';
import { useMultiScenarioRoute } from '@/hooks/use-multi-scenario-route';
import { Loader2, LogOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'umi';
import { useHandleClickConversationCard } from '../hooks/use-click-card';
import { ChatSettings } from './app-settings/chat-settings';
import { MultipleChatBox } from './chat-box/multiple-chat-box';
import { SingleChatBox } from './chat-box/single-chat-box';
import { Sessions } from './sessions';
import { useAddChatBox } from './use-add-box';
import { useSwitchDebugMode } from './use-switch-debug-mode';

export function ChatContent() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { data: conversation, loading: conversationLoading } =
    useFetchConversation();
  const { saveCurrentScenarioState } = useMultiScenarioRoute();

  const { handleConversationCardClick, controller, stopOutputMessage } =
    useHandleClickConversationCard();
  const { visible: settingVisible, switchVisible: switchSettingVisible } =
    useSetModalState(false);
  const {
    removeChatBox,
    addChatBox,
    chatBoxIds,
    hasSingleChatBox,
    hasThreeChatBox,
  } = useAddChatBox();

  const { hideEmbedModal, embedVisible, beta } = useShowEmbedModal();

  const { conversationId, isNew } = useGetChatSearchParams();
  const searchParams = new URLSearchParams(window.location.search);
  // Normalize conversationApi: 'ask' in URL maps to empty string internally
  const conversationApi = (() => {
    const param = searchParams.get('conversationApi') || '';
    return param === 'ask' ? '' : param;
  })();
  const isDeepinsightMode = conversationApi === 'deepinsightChat';
  const [thinkingPanelVisible, setThinkingPanelVisible] =
    useState(isDeepinsightMode);

  const { isDebugMode, switchDebugMode } = useSwitchDebugMode();

  const debugModeContent = (
    <section className="pt-14 w-full h-full pb-24 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-10 pb-5">
        <span className="text-2xl">
          {t('chat.multipleModels')} ({chatBoxIds.length}/3)
        </span>
        <Button variant={'ghost'} onClick={switchDebugMode}>
          {t('chat.exit')} <LogOut />
        </Button>
      </div>
      <MultipleChatBox
        chatBoxIds={chatBoxIds}
        controller={controller}
        removeChatBox={removeChatBox}
        addChatBox={addChatBox}
        stopOutputMessage={stopOutputMessage}
      ></MultipleChatBox>
    </section>
  );

  const chatContent = (
    <section className="w-full h-full flex flex-col overflow-hidden">
      <div className="flex flex-1 min-h-0">
        <Sessions
          hasSingleChatBox={hasSingleChatBox}
          handleConversationCardClick={handleConversationCardClick}
          switchSettingVisible={switchSettingVisible}
          isDeepinsightMode={isDeepinsightMode}
          thinkingPanelVisible={thinkingPanelVisible}
          onToggleThinkingPanel={() =>
            setThinkingPanelVisible(!thinkingPanelVisible)
          }
        ></Sessions>

        <div className="flex-1 min-w-0 flex gap-0 m-5 border rounded-lg overflow-hidden">
          <Card className="flex-1 min-w-0 bg-transparent border-0 h-full">
            <CardContent className="flex flex-col p-0 h-full min-h-0">
              <Card className="flex flex-col flex-1 bg-transparent border-0 min-w-0 min-h-0">
                {/* <CardHeader
                  className={cn('p-4', { 'border-b': hasSingleChatBox })}
                >
                  <CardTitle className="flex justify-between items-center text-base">
                    <div className="truncate">{conversation.name}</div>
                    <Button
                      variant={'ghost'}
                      onClick={switchDebugMode}
                      disabled={
                        hasThreeChatBox ||
                        isEmpty(conversationId) ||
                        isNew === 'true'
                      }
                    >
                      <ArrowUpRight /> {t('chat.multipleModels')}
                    </Button>
                  </CardTitle>
                </CardHeader> */}
                <CardContent className="flex-1 p-0 min-h-0">
                  {conversationLoading ? (
                    <div className="flex flex-col items-center justify-center h-full gap-4">
                      <Loader2 className="h-10 w-10 animate-spin text-primary" />
                    </div>
                  ) : (
                    <SingleChatBox
                      controller={controller}
                      stopOutputMessage={stopOutputMessage}
                      thinkingPanelVisible={
                        isDeepinsightMode ? thinkingPanelVisible : true
                      }
                    ></SingleChatBox>
                  )}
                </CardContent>
              </Card>
            </CardContent>
          </Card>
          {settingVisible && (
            <ChatSettings
              switchSettingVisible={switchSettingVisible}
            ></ChatSettings>
          )}
        </div>
      </div>
      {embedVisible && (
        <EmbedDialog
          visible={embedVisible}
          hideModal={hideEmbedModal}
          token={id!}
          from={SharedFrom.Chat}
          beta={beta}
          isAgent={false}
        ></EmbedDialog>
      )}
    </section>
  );

  // 🔑 当会话改变时，自动保存当前场景的状态
  // 这样切换回来时能恢复该会话
  useEffect(() => {
    const scenarioName =
      conversationApi === 'deepinsightChat'
        ? 'deepinsight'
        : conversationApi === 'deepinsightConferenceQuestion'
          ? 'conference'
          : 'ask';
    console.log(`[ChatContent-${scenarioName}] 💾 Saving state`, {
      conversationId,
      isNew,
      conversationApi,
    });
    saveCurrentScenarioState();
  }, [conversationId, isNew, conversationApi, saveCurrentScenarioState]);

  return isDebugMode ? debugModeContent : chatContent;
}
