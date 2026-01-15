/**
 * SSE (Server-Sent Events) 数据解析工具
 * 安全处理流数据中的各种格式问题
 */

/**
 * 安全地解析 SSE 流数据
 * 处理各种格式问题：data: 前缀、双重编码、空数据等
 *
 * @param rawData - 原始的 SSE 数据字符串
 * @returns 解析后的 JSON 对象，或 null 如果解析失败
 */
export function parseSSEData(rawData: string): any | null {
  if (!rawData || rawData.trim().length === 0) {
    return null;
  }

  let cleanedData = rawData.trim();

  // 移除 SSE "data:" 前缀（如果存在）
  if (cleanedData.startsWith('data:')) {
    cleanedData = cleanedData.substring(5).trim();
  }

  // 移除多余的引号包装（处理双重编码的情况）
  if (cleanedData.startsWith('"') && cleanedData.endsWith('"')) {
    try {
      cleanedData = JSON.parse(cleanedData);
    } catch {
      // 继续使用原始的 cleanedData
    }
  }

  try {
    return JSON.parse(cleanedData);
  } catch (parseErr) {
    console.warn('Failed to parse SSE data:', {
      original: rawData.substring(0, 150),
      cleaned: cleanedData.substring(0, 150),
      error: parseErr instanceof Error ? parseErr.message : String(parseErr),
    });
    return null;
  }
}
