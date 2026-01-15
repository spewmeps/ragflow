'use client';

import { DocumentParserType } from '@/constants/knowledge';
import { useFetchKnowledgeList } from '@/hooks/knowledge-hooks';
import { cn } from '@/lib/utils';
import { UserOutlined } from '@ant-design/icons';
import { Avatar as AntAvatar, Checkbox, Input } from 'antd';
import { ChevronDown, Globe, Library } from 'lucide-react';
import React, { useMemo, useRef, useState } from 'react';

interface KbWebSearchSelectorProps {
  selectedKbs?: string[];
  webSearch?: boolean;
  onKbChange?: (kbIds: string[]) => void;
  onWebSearchChange?: (value: boolean) => void;
  conversationApi?: string; // 'deepinsightChat' or 'deepinsightConferenceQuestion'
}

type MenuType = 'kb' | 'web' | null;

export function KbWebSearchSelector({
  selectedKbs = [],
  webSearch = false,
  onKbChange,
  onWebSearchChange,
  conversationApi = 'deepinsightChat',
}: KbWebSearchSelectorProps) {
  const { list: knowledgeList } = useFetchKnowledgeList(true);
  const [openMenu, setOpenMenu] = useState<MenuType>(null);
  const [searchText, setSearchText] = useState('');
  const [menuDirection, setMenuDirection] = useState<'down' | 'up'>('down');
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // 根据场景判断是否显示网络菜单
  const isDeepinsightConference =
    conversationApi === 'deepinsightConferenceQuestion';
  const showWebSearch = !isDeepinsightConference;

  const filteredKnowledgeList = useMemo(
    () =>
      knowledgeList
        .filter((x) => x.parser_id !== DocumentParserType.Tag)
        .filter((x) =>
          searchText.trim() === ''
            ? true
            : x.name.toLowerCase().includes(searchText.toLowerCase()),
        ),
    [knowledgeList, searchText],
  );

  // 判断是否有选中内容
  const hasSelection = selectedKbs.length > 0 || webSearch;
  const isSelected = (kbId: string) => selectedKbs.includes(kbId);

  // 固定显示"搜索范围"
  const displayText = '搜索范围';

  const handleKbToggle = (kbId: string) => {
    if (!onKbChange) return;
    const newKbs = isSelected(kbId)
      ? selectedKbs.filter((id) => id !== kbId)
      : [...selectedKbs, kbId];
    onKbChange(newKbs);
  };

  const handleSelectAll = () => {
    if (!onKbChange) return;
    const allIds = filteredKnowledgeList.map((x) => x.id);
    const isAllSelected = allIds.every((id) => isSelected(id));
    if (isAllSelected) {
      onKbChange(selectedKbs.filter((id) => !allIds.includes(id)));
    } else {
      const newKbs = Array.from(new Set([...selectedKbs, ...allIds]));
      onKbChange(newKbs);
    }
  };

  const handleWebSearchToggle = () => {
    onWebSearchChange?.(!webSearch);
  };

  const handleClickOutside = (e: MouseEvent) => {
    if (
      containerRef.current &&
      !containerRef.current.contains(e.target as Node)
    ) {
      setOpenMenu(null);
      setSearchText('');
    }
  };

  // 检测菜单方向
  const checkMenuDirection = () => {
    if (!buttonRef.current) return;

    const rect = buttonRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const menuHeight = 350; // 菜单大约的高度

    // 如果下方空间不足且上方有足够空间，则向上展开
    if (spaceBelow < menuHeight && spaceAbove > menuHeight) {
      setMenuDirection('up');
    } else {
      setMenuDirection('down');
    }
  };

  React.useEffect(() => {
    if (openMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      // 延迟计算方向以确保DOM已渲染
      setTimeout(checkMenuDirection, 0);
      window.addEventListener('scroll', checkMenuDirection);
      window.addEventListener('resize', checkMenuDirection);

      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        window.removeEventListener('scroll', checkMenuDirection);
        window.removeEventListener('resize', checkMenuDirection);
      };
    }
  }, [openMenu]);

  const kbContent = (
    <div className="w-64 bg-white rounded-lg">
      <div className="p-3 border-b border-gray-200">
        <Input
          placeholder="搜索知识库"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          size="small"
          allowClear
        />
      </div>
      <div className="max-h-64 overflow-y-auto">
        {filteredKnowledgeList.length > 0 ? (
          filteredKnowledgeList.map((kb) => (
            <label
              key={kb.id}
              className="flex items-center gap-2 cursor-pointer px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition-colors"
            >
              <Checkbox
                checked={isSelected(kb.id)}
                onChange={() => handleKbToggle(kb.id)}
              />
              <AntAvatar size={20} icon={<UserOutlined />} src={kb.avatar} />
              <span className="text-sm flex-1 truncate">{kb.name}</span>
            </label>
          ))
        ) : (
          <div className="text-center py-4 text-gray-400 text-sm">
            暂无知识库
          </div>
        )}
      </div>
    </div>
  );

  const webContent = (
    <div className="w-48 bg-white rounded-lg p-3">
      <label className="flex items-center gap-2 cursor-pointer py-2 px-2 hover:bg-gray-50 rounded transition-colors">
        <Checkbox checked={webSearch} onChange={handleWebSearchToggle} />
        <span className="text-sm">启用联网搜索</span>
      </label>
    </div>
  );

  return (
    <div className="relative inline-block" ref={containerRef}>
      {/* 主菜单按钮 */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setOpenMenu(openMenu ? null : 'kb');
        }}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded border transition-all duration-200 whitespace-nowrap',
          {
            'border-blue-500 text-blue-600 bg-blue-50': hasSelection,
            'border-gray-200 text-gray-700 hover:border-gray-300':
              !hasSelection,
          },
        )}
      >
        <span className="text-sm font-medium">{displayText}</span>
        <div className="w-px h-4 bg-gray-300"></div>
        <span className="flex items-center gap-1.5">
          <Library
            size={16}
            className={
              selectedKbs.length > 0 ? 'text-blue-600' : 'text-gray-600'
            }
          />
          {showWebSearch && (
            <Globe
              size={16}
              className={webSearch ? 'text-blue-600' : 'text-gray-600'}
            />
          )}
          <ChevronDown
            size={16}
            className={cn('transition-transform', {
              'text-blue-600 rotate-180': openMenu,
              'text-gray-600': !openMenu,
            })}
          />
        </span>
      </button>

      {/* 下拉菜单 */}
      {openMenu && (
        <div
          className={cn(
            'absolute left-0 z-50 flex gap-0 bg-white rounded-lg overflow-hidden shadow-xl border border-gray-200',
            {
              'top-full mt-2': menuDirection === 'down',
              'bottom-full mb-2': menuDirection === 'up',
            },
          )}
        >
          {/* 一级菜单 */}
          <div className="border-r border-gray-200 min-w-40">
            <button
              type="button"
              onClick={() => setOpenMenu(openMenu === 'kb' ? null : 'kb')}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 transition-colors',
                {
                  'bg-blue-50 text-blue-600 border-l-2 border-blue-600':
                    openMenu === 'kb',
                },
              )}
            >
              <Checkbox
                checked={
                  selectedKbs.length > 0 &&
                  filteredKnowledgeList.length > 0 &&
                  filteredKnowledgeList.every((x) => isSelected(x.id))
                }
                onChange={handleSelectAll}
                onClick={(e) => e.stopPropagation()}
              />
              <span>知识库</span>
            </button>
            {showWebSearch && (
              <button
                type="button"
                onClick={() => setOpenMenu(openMenu === 'web' ? null : 'web')}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 border-t border-gray-200 transition-colors',
                  {
                    'bg-blue-50 text-blue-600 border-l-2 border-blue-600':
                      openMenu === 'web',
                  },
                )}
              >
                <Checkbox
                  checked={webSearch}
                  onChange={handleWebSearchToggle}
                  onClick={(e) => e.stopPropagation()}
                />
                <span>网络</span>
              </button>
            )}
          </div>
          {/* 二级菜单 */}
          <div className="min-w-48">
            {openMenu === 'kb' && kbContent}
            {openMenu === 'web' && webContent}
          </div>
        </div>
      )}
    </div>
  );
}
