import { Authorization } from '@/constants/authorization';
import api from '@/utils/api';
import { getAuthorization } from '@/utils/authorization-util';
import { downloadFileFromBlob } from '@/utils/file-util';
import { Button } from 'antd';
import { FileDown, FileText } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

interface DeepinsightGenerationButtonsProps {
  conversationId: string;
  onPdfGenerating?: (loading: boolean) => void;
  onPptGenerating?: (loading: boolean) => void;
}

export function DeepinsightGenerationButtons({
  conversationId,
  onPdfGenerating,
  onPptGenerating,
}: DeepinsightGenerationButtonsProps) {
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pptLoading, setPptLoading] = useState(false);

  const handleGeneratePdf = async () => {
    if (pdfLoading) return;
    setPdfLoading(true);
    onPdfGenerating?.(true);

    try {
      const response = await fetch(api.generatePdf, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [Authorization]: getAuthorization(),
        },
        credentials: 'include',
        body: JSON.stringify({
          conversation_id: conversationId,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Get filename from Content-Disposition header
      const contentDisposition = response.headers.get('content-disposition');
      let filename = '会议洞察报告.pdf';
      if (contentDisposition) {
        const matches = contentDisposition.match(/filename="?([^"]+)"?/);
        if (matches) {
          filename = decodeURIComponent(matches[1]);
        }
      }

      const blob = await response.blob();
      downloadFileFromBlob(blob, filename);
      toast.success('PDF 下载成功');
    } catch (error) {
      console.error('PDF generation failed:', error);
      toast.error('PDF 生成失败，请重试');
    } finally {
      setPdfLoading(false);
      onPdfGenerating?.(false);
    }
  };

  const handleGeneratePpt = async () => {
    if (pptLoading) return;
    setPptLoading(true);
    onPptGenerating?.(true);

    try {
      const response = await fetch(api.generatePpt, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [Authorization]: getAuthorization(),
        },
        credentials: 'include',
        body: JSON.stringify({
          conversation_id: conversationId,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Get filename from Content-Disposition header
      const contentDisposition = response.headers.get('content-disposition');
      let filename = '会议洞察报告.pptx';
      if (contentDisposition) {
        const matches = contentDisposition.match(/filename="?([^"]+)"?/);
        if (matches) {
          filename = decodeURIComponent(matches[1]);
        }
      }

      const blob = await response.blob();
      downloadFileFromBlob(blob, filename);
      toast.success('PPT 下载成功');
    } catch (error) {
      console.error('PPT generation failed:', error);
      toast.error('PPT 生成失败，请重试');
    } finally {
      setPptLoading(false);
      onPptGenerating?.(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 mt-3">
      <div className="flex gap-2">
        <Button
          loading={pdfLoading}
          onClick={handleGeneratePdf}
          icon={<FileDown size={16} />}
          type="primary"
        >
          下载 PDF
        </Button>
        <Button
          loading={pptLoading}
          onClick={handleGeneratePpt}
          icon={<FileText size={16} />}
        >
          生成 PPT
        </Button>
      </div>
    </div>
  );
}
