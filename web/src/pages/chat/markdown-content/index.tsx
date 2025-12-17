import Image from '@/components/image';
import SvgIcon from '@/components/svg-icon';
import ToolCallDisplay from '@/components/tool-call-display';
import { IReference, IReferenceChunk } from '@/interfaces/database/chat';
import { getExtension } from '@/utils/document-util';
import { InfoCircleOutlined } from '@ant-design/icons';
import { Button, Flex, Popover, Tag } from 'antd';
import DOMPurify from 'dompurify';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import reactStringReplace from 'react-string-replace';
import SyntaxHighlighter from 'react-syntax-highlighter';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { visitParents } from 'unist-util-visit-parents';

import { useFetchDocumentThumbnailsByIds } from '@/hooks/document-hooks';
import { useTranslation } from 'react-i18next';

import 'katex/dist/katex.min.css'; // `rehype-katex` does not import the CSS for you

import {
  preprocessLaTeX,
  replaceThinkToSection,
  showImage,
} from '@/utils/chat';
import { currentReg, replaceTextByOldReg } from '../utils';

import classNames from 'classnames';
import { omit } from 'lodash';
import { pipe } from 'lodash/fp';
import styles from './index.less';

const getChunkIndex = (match: string) => Number(match);
// TODO: The display of the table is inconsistent with the display previously placed in the MessageItem.
const MarkdownContent = ({
  reference,
  clickDocumentButton,
  content,
  progressSteps,
  progress,
  elapsedTime,
  isDeepinsightConference = false,
  contentArray,
}: {
  content: string;
  loading: boolean;
  reference: IReference;
  progressSteps?: any[];
  progress?: number;
  elapsedTime?: number;
  clickDocumentButton?: (documentId: string, chunk: IReferenceChunk) => void;
  isDeepinsightConference?: boolean;
  contentArray?: any[];
}) => {
  const { t } = useTranslation();
  const { setDocumentIds, data: fileThumbnails } =
    useFetchDocumentThumbnailsByIds();
  const [thinkingExpanded, setThinkingExpanded] = useState(false);

  // 提取进度消息（任何 percentage 的 progress 类型）
  const progressMessage = useMemo(() => {
    if (!isDeepinsightConference || !Array.isArray(contentArray)) {
      return null;
    }
    return contentArray.find(
      (item: any) =>
        typeof item?.percentage === 'number' &&
        item?.process === 'progress' &&
        item?.type === 'content_markdown',
    );
  }, [isDeepinsightConference, contentArray]);

  // 确保 content 是字符串
  const safeContent = useMemo(() => {
    return typeof content === 'string' ? content : '';
  }, [content]);

  // 提取思考部分和主要部分
  const { thinkingPart, mainPart } = useMemo(() => {
    const thinkMatch = safeContent.match(/<think>(.*?)<\/think>/s);
    const thinking = thinkMatch ? thinkMatch[1] : '';
    const main = safeContent.replace(/<think>.*?<\/think>/s, '').trim();
    return { thinkingPart: thinking, mainPart: main };
  }, [safeContent]);

  // 分割内容和工具调用，按顺序返回
  const contentParts = useMemo(() => {
    if (!mainPart) return [];

    const toolCallRegex = /<tool-call>\n(.*?)\n<\/tool-call>/gs;
    const parts: Array<{ type: 'markdown' | 'tool-call'; content: string }> =
      [];
    let lastIndex = 0;
    let match;

    while ((match = toolCallRegex.exec(mainPart)) !== null) {
      // 添加工具调用前的 markdown 内容
      if (match.index > lastIndex) {
        const markdownContent = mainPart.substring(lastIndex, match.index);
        // 只添加有实际内容的 markdown 部分
        if (markdownContent.trim()) {
          parts.push({
            type: 'markdown',
            content: markdownContent,
          });
        }
      }

      // 添加工具调用
      parts.push({
        type: 'tool-call',
        content: match[1],
      });

      lastIndex = toolCallRegex.lastIndex;
    }

    // 添加最后的 markdown 内容
    if (lastIndex < mainPart.length) {
      const finalMarkdown = mainPart.substring(lastIndex);
      if (finalMarkdown.trim()) {
        parts.push({
          type: 'markdown',
          content: finalMarkdown,
        });
      }
    }

    // 如果没有工具调用，就返回整个内容
    if (parts.length === 0) {
      parts.push({
        type: 'markdown',
        content: mainPart,
      });
    }

    return parts;
  }, [mainPart]);

  // 同样提取思考部分中的工具调用
  const thinkingParts = useMemo(() => {
    if (!thinkingPart) return [];

    const toolCallRegex = /<tool-call>\n(.*?)\n<\/tool-call>/gs;
    const parts: Array<{ type: 'markdown' | 'tool-call'; content: string }> =
      [];
    let lastIndex = 0;
    let match;

    while ((match = toolCallRegex.exec(thinkingPart)) !== null) {
      // 添加工具调用前的 markdown 内容
      if (match.index > lastIndex) {
        const markdownContent = thinkingPart.substring(lastIndex, match.index);
        // 只添加有实际内容的 markdown 部分
        if (markdownContent.trim()) {
          parts.push({
            type: 'markdown',
            content: markdownContent,
          });
        }
      }

      // 添加工具调用
      parts.push({
        type: 'tool-call',
        content: match[1],
      });

      lastIndex = toolCallRegex.lastIndex;
    }

    // 添加最后的 markdown 内容
    if (lastIndex < thinkingPart.length) {
      const finalMarkdown = thinkingPart.substring(lastIndex);
      if (finalMarkdown.trim()) {
        parts.push({
          type: 'markdown',
          content: finalMarkdown,
        });
      }
    }

    // 如果没有工具调用，就返回整个内容
    if (parts.length === 0 && thinkingPart) {
      parts.push({
        type: 'markdown',
        content: thinkingPart,
      });
    }

    return parts;
  }, [thinkingPart]);

  const processMarkdownPart = useCallback(
    (text: string) => {
      let processed = DOMPurify.sanitize(text, {
        ADD_TAGS: ['think', 'section'],
        ADD_ATTR: ['class', 'href', 'title', 'alt', 'src'],
        ALLOW_DATA_ATTR: false,
      });

      if (processed === '') {
        processed = t('chat.searching');
      }
      const nextText = replaceTextByOldReg(processed);
      return pipe(replaceThinkToSection, preprocessLaTeX)(nextText);
    },
    [t],
  );

  useEffect(() => {
    const docAggs = reference?.doc_aggs;
    setDocumentIds(Array.isArray(docAggs) ? docAggs.map((x) => x.doc_id) : []);
  }, [reference, setDocumentIds]);

  const handleDocumentButtonClick = useCallback(
    (
      documentId: string,
      chunk: IReferenceChunk,
      isPdf: boolean,
      documentUrl?: string,
    ) =>
      () => {
        if (!isPdf) {
          if (!documentUrl) {
            return;
          }
          window.open(documentUrl, '_blank');
        } else {
          clickDocumentButton?.(documentId, chunk);
        }
      },
    [clickDocumentButton],
  );

  const rehypeWrapReference = () => {
    return function wrapTextTransform(tree: any) {
      visitParents(tree, 'text', (node, ancestors) => {
        const latestAncestor = ancestors.at(-1);
        if (
          latestAncestor.tagName !== 'custom-typography' &&
          latestAncestor.tagName !== 'code'
        ) {
          node.type = 'element';
          node.tagName = 'custom-typography';
          node.properties = {};
          node.children = [{ type: 'text', value: node.value }];
        }
      });
    };
  };

  // 处理 <tool-call> 标记，确保它们能被正确渲染
  const rehypeWrapToolCall = () => {
    return function wrapToolCall(tree: any) {
      visitParents(tree, 'element', (node) => {
        if (node.tagName === 'tool-call') {
          // 确保 tool-call 标记的子内容被正确保留
          node.properties = node.properties || {};
          // 提取文本内容作为 children
          if (node.children && node.children.length > 0) {
            // 保留原有的 children，react-markdown 会处理
          }
        }
      });
    };
  };

  const getReferenceInfo = useCallback(
    (chunkIndex: number) => {
      const chunks = reference?.chunks ?? [];
      const chunkItem = chunks[chunkIndex];
      const document = reference?.doc_aggs?.find(
        (x) => x?.doc_id === chunkItem?.document_id,
      );
      const documentId = document?.doc_id;
      const documentUrl = document?.url;
      const fileThumbnail = documentId ? fileThumbnails[documentId] : '';
      const fileExtension = documentId ? getExtension(document?.doc_name) : '';
      const imageId = chunkItem?.image_id;

      return {
        documentUrl,
        fileThumbnail,
        fileExtension,
        imageId,
        chunkItem,
        documentId,
        document,
      };
    },
    [fileThumbnails, reference],
  );

  const getPopoverContent = useCallback(
    (chunkIndex: number) => {
      const {
        documentUrl,
        fileThumbnail,
        fileExtension,
        imageId,
        chunkItem,
        documentId,
        document,
      } = getReferenceInfo(chunkIndex);

      return (
        <div key={chunkItem?.id} className="flex gap-2">
          {imageId && (
            <Popover
              placement="left"
              content={
                <Image
                  id={imageId}
                  className={styles.referenceImagePreview}
                ></Image>
              }
            >
              <Image
                id={imageId}
                className={styles.referenceChunkImage}
              ></Image>
            </Popover>
          )}
          <div className={'space-y-2 max-w-[40vw]'}>
            <div
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(chunkItem?.content ?? ''),
              }}
              className={classNames(styles.chunkContentText)}
            ></div>
            {documentId && (
              <Flex gap={'small'}>
                {fileThumbnail ? (
                  <img
                    src={fileThumbnail}
                    alt=""
                    className={styles.fileThumbnail}
                  />
                ) : (
                  <SvgIcon
                    name={`file-icon/${fileExtension}`}
                    width={24}
                  ></SvgIcon>
                )}
                <Button
                  type="link"
                  className={classNames(styles.documentLink, 'text-wrap')}
                  onClick={handleDocumentButtonClick(
                    documentId,
                    chunkItem,
                    fileExtension === 'pdf',
                    documentUrl,
                  )}
                >
                  {document?.doc_name}
                </Button>
              </Flex>
            )}
          </div>
        </div>
      );
    },
    [getReferenceInfo, handleDocumentButtonClick],
  );

  const renderReference = useCallback(
    (text: string) => {
      let replacedText = reactStringReplace(text, currentReg, (match, i) => {
        const chunkIndex = getChunkIndex(match);

        const { documentUrl, fileExtension, imageId, chunkItem, documentId } =
          getReferenceInfo(chunkIndex);

        const docType = chunkItem?.doc_type;

        return showImage(docType) ? (
          <Image
            id={imageId}
            className={styles.referenceInnerChunkImage}
            onClick={
              documentId
                ? handleDocumentButtonClick(
                    documentId,
                    chunkItem,
                    fileExtension === 'pdf',
                    documentUrl,
                  )
                : () => {}
            }
          ></Image>
        ) : (
          <Popover content={getPopoverContent(chunkIndex)} key={i}>
            <InfoCircleOutlined className={styles.referenceIcon} />
          </Popover>
        );
      });

      // replacedText = reactStringReplace(replacedText, curReg, (match, i) => (
      //   <span className={styles.cursor} key={i}></span>
      // ));

      return replacedText;
    },
    [getPopoverContent, getReferenceInfo, handleDocumentButtonClick],
  );

  // 渲染工具调用和markdown混合内容
  const renderContentParts = useCallback(
    (parts: Array<{ type: 'markdown' | 'tool-call'; content: string }>) => {
      const toolCalls: any[] = [];
      const markdownParts: React.ReactNode[] = [];

      parts.forEach((part, idx) => {
        if (part.type === 'tool-call') {
          // 收集工具调用
          try {
            const toolCallData = JSON.parse(part.content);
            toolCalls.push({
              key: `tool-${idx}`,
              data: toolCallData,
            });
          } catch (error) {
            console.error('Failed to parse tool call:', error);
          }
        } else if (part.type === 'markdown') {
          // 如果有积累的工具调用，先渲染它们
          if (toolCalls.length > 0) {
            markdownParts.push(
              <div key={`flex-${idx}`} className={styles.toolCallsFlexWrapper}>
                {toolCalls.map((tc) => (
                  <div key={tc.key} className={styles.toolCallContainer}>
                    <ToolCallDisplay {...tc.data} />
                  </div>
                ))}
              </div>,
            );
            toolCalls.length = 0;
          }

          // 渲染 markdown 部分
          if (part.content.trim()) {
            const processedContent = processMarkdownPart(part.content);
            markdownParts.push(
              <Markdown
                key={`md-${idx}`}
                rehypePlugins={[
                  rehypeWrapReference,
                  rehypeWrapToolCall,
                  rehypeKatex,
                  rehypeRaw,
                ]}
                remarkPlugins={[remarkGfm, remarkMath]}
                components={
                  {
                    'custom-typography': ({ children }: { children: string }) =>
                      renderReference(children),
                    img: (props: any) => (
                      <img
                        {...props}
                        style={{
                          maxWidth: '100%',
                          height: 'auto',
                          display: 'block',
                          ...props.style,
                        }}
                        alt={props.alt || ''}
                      />
                    ),
                    table: (props: any) => (
                      <div
                        style={{
                          width: '100%',
                          overflowX: 'auto',
                          boxSizing: 'border-box',
                        }}
                      >
                        <table
                          {...props}
                          style={{
                            minWidth: '100%',
                            ...props.style,
                          }}
                        >
                          {props.children}
                        </table>
                      </div>
                    ),
                    code(props: any) {
                      const { children, className, ...rest } = props;
                      const restProps = omit(rest, 'node');
                      const match = /language-(\w+)/.exec(className || '');
                      return match ? (
                        <div
                          style={{
                            width: '100%',
                            overflowX: 'auto',
                            boxSizing: 'border-box',
                          }}
                        >
                          <SyntaxHighlighter
                            {...restProps}
                            PreTag="div"
                            language={match[1]}
                            wrapLongLines
                            customStyle={{
                              margin: 0,
                              minWidth: 'fit-content',
                            }}
                          >
                            {String(children).replace(/\n$/, '')}
                          </SyntaxHighlighter>
                        </div>
                      ) : (
                        <code
                          {...restProps}
                          className={classNames(className, 'text-wrap')}
                          style={{
                            wordBreak: 'break-all',
                            overflowWrap: 'break-word',
                          }}
                        >
                          {children}
                        </code>
                      );
                    },
                    a: (props: any) => (
                      <a
                        {...props}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          color: '#1890ff',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                          ...props.style,
                        }}
                      >
                        {props.children}
                      </a>
                    ),
                    h1: (props: any) => (
                      <h1
                        style={{
                          marginTop: '16px',
                          marginBottom: '8px',
                          ...props.style,
                        }}
                      >
                        {props.children}
                      </h1>
                    ),
                    h2: (props: any) => (
                      <h2
                        style={{
                          marginTop: '12px',
                          marginBottom: '8px',
                          ...props.style,
                        }}
                      >
                        {props.children}
                      </h2>
                    ),
                    h3: (props: any) => (
                      <h3
                        style={{
                          marginTop: '8px',
                          marginBottom: '6px',
                          ...props.style,
                        }}
                      >
                        {props.children}
                      </h3>
                    ),
                  } as any
                }
              >
                {processedContent}
              </Markdown>,
            );
          }
        }
      });

      // 处理最后剩余的工具调用
      if (toolCalls.length > 0) {
        markdownParts.push(
          <div key="flex-last" className={styles.toolCallsFlexWrapper}>
            {toolCalls.map((tc) => (
              <div key={tc.key} className={styles.toolCallContainer}>
                <ToolCallDisplay {...tc.data} />
              </div>
            ))}
          </div>,
        );
      }

      return markdownParts;
    },
    [processMarkdownPart, renderReference],
  );

  return (
    <div className={styles.markdownContentWrapper}>
      {/* 1. 思考过程 - 可折叠 */}
      {thinkingPart && (
        <div className={styles.thinkingSection}>
          <div
            className={styles.thinkingHeader}
            onClick={() => setThinkingExpanded(!thinkingExpanded)}
          >
            <span>{thinkingExpanded ? '▼' : '▶'} 思考过程</span>
          </div>
          {thinkingExpanded && (
            <div className={styles.thinkingContent}>
              {renderContentParts(thinkingParts)}
            </div>
          )}
        </div>
      )}

      {/* 2. 进度条 */}
      {/* {progress !== undefined && progress > 0 && (
        <ProgressDisplay
          progress={progress}
          progressSteps={progressSteps}
          elapsedTime={elapsedTime}
          showElapsedTime={false}
        />
      )} */}

      {/* 2.5. 处理进度 - 仅在 deepinsightConferenceQuestion 场景下显示进度消息 */}
      {isDeepinsightConference && progressMessage && (
        <div
          style={{
            margin: '12px 0',
            padding: '12px',
            backgroundColor: '#fafafa',
            borderRadius: '4px',
          }}
        >
          <div
            style={{ marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}
          >
            处理进度：
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '8px',
            }}
          >
            <div
              style={{
                flex: 1,
                height: '8px',
                backgroundColor: '#e8e8e8',
                borderRadius: '4px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  backgroundColor: '#52c41a',
                  width: `${progressMessage.percentage}%`,
                  transition: 'width 0.3s',
                  borderRadius: '4px',
                }}
              />
            </div>
            <span
              style={{
                minWidth: '40px',
                textAlign: 'right',
                fontSize: '12px',
              }}
            >
              {progressMessage.percentage}%
            </span>
          </div>
          <div
            style={{ marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}
          >
            提示信息：
          </div>
          <div
            style={{
              paddingLeft: '10px',
              borderLeft: '3px solid #52c41a',
              fontSize: '12px',
              color: '#666',
            }}
          >
            {progressMessage.content}
          </div>
        </div>
      )}

      {/* 3. 提示栏 - 仅在 deepinsightConferenceQuestion 场景下显示 */}
      {isDeepinsightConference &&
        progressSteps &&
        Array.isArray(progressSteps) &&
        progressSteps.length > 0 && (
          <div className={styles.progressTip}>
            <Flex gap="small" wrap="wrap">
              <Tag color="orange">正在分析顶会内容</Tag>
              <span>洞察场景预计 30 分钟，问答场景预计 5 分钟</span>
            </Flex>
          </div>
        )}

      {/* 4. 主要内容 */}
      {renderContentParts(contentParts)}
    </div>
  );
};

export default MarkdownContent;
