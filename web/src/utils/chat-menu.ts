/**
 * Utility functions for chat menu generation
 */

import { IDialog } from '@/interfaces/database/chat';
import { Routes } from '@/routes';

export interface IMenuTag {
  path: string;
  name: string;
  icon?: React.ComponentType<any>;
  dialogId?: string;
  conversationApi?: string;
}

// Special dialog names
export const SPECIAL_DIALOG_NAMES = {
  ASK: '问一问',
  CONFERENCE: '顶会洞察',
  DEEPINSIGHT: '深度研究',
};

/**
 * Get the conversation API for a special dialog
 */
export const getConversationApiForDialog = (dialogName: string): string => {
  switch (dialogName) {
    case SPECIAL_DIALOG_NAMES.ASK:
      return '';
    case SPECIAL_DIALOG_NAMES.CONFERENCE:
      return 'deepinsightConferenceQuestion';
    case SPECIAL_DIALOG_NAMES.DEEPINSIGHT:
      return 'deepinsightChat';
    default:
      return '';
  }
};

/**
 * Generate chat menu items from dialog list
 * Returns menu items in a fixed order: 问一问, 顶会洞察, 深度研究
 */
export const generateChatMenuItems = (
  dialogs: IDialog[],
  icon: React.ComponentType<any>,
): IMenuTag[] => {
  const orderedNames = [
    SPECIAL_DIALOG_NAMES.ASK,
    SPECIAL_DIALOG_NAMES.CONFERENCE,
    SPECIAL_DIALOG_NAMES.DEEPINSIGHT,
  ];

  const menuItems: IMenuTag[] = [];

  // Add special dialogs in fixed order
  for (const dialogName of orderedNames) {
    const dialog = dialogs.find((d) => d.name === dialogName);
    if (dialog) {
      const conversationApi = getConversationApiForDialog(dialogName);
      // For Ask scenario, use 'ask' as conversationApi to preserve it in URL
      // For others, use their respective API identifiers
      const apiParam = conversationApi === '' ? 'ask' : conversationApi;
      const path = `${Routes.Chat}/${dialog.id}?conversationApi=${apiParam}`;

      menuItems.push({
        path,
        name: dialog.name,
        icon,
        dialogId: dialog.id,
        conversationApi,
      });
    }
  }

  return menuItems;
};

/**
 * Check if pathname matches a menu item
 * This function handles the case where pathname might have query parameters
 */
export const isPathActive = (pathname: string, menuPath: string): boolean => {
  // Remove query parameters from pathname for comparison
  const pathnameBase = pathname.split('?')[0];
  const menuPathBase = menuPath.split('?')[0];

  if (pathnameBase !== menuPathBase) {
    return false;
  }

  // If menu path has query parameters, also match them
  if (menuPath.includes('?')) {
    const pathnameParams = new URLSearchParams(pathname.split('?')[1] || '');
    const menuParams = new URLSearchParams(menuPath.split('?')[1]);

    for (const [key, value] of menuParams.entries()) {
      if (pathnameParams.get(key) !== value) {
        return false;
      }
    }
  }

  return true;
};
