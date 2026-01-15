import { useTranslate } from '@/hooks/common-hooks';
import { CheckOutlined, CopyOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';
import { useRef, useState } from 'react';
import { CopyToClipboard as Clipboard, Props } from 'react-copy-to-clipboard';

const CopyToClipboard = ({ text }: Props) => {
  const [copied, setCopied] = useState(false);
  const { t } = useTranslate('common');
  const clipboardRef = useRef<HTMLSpanElement>(null);

  const handleCopy = () => {
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  return (
    <span ref={clipboardRef}>
      <Tooltip title={copied ? t('copied') : t('copy')}>
        <Clipboard text={text} onCopy={handleCopy}>
          {copied ? <CheckOutlined /> : <CopyOutlined />}
        </Clipboard>
      </Tooltip>
    </span>
  );
};

export default CopyToClipboard;
