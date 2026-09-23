import { imageDimensionsFromData } from 'image-dimensions';

/** 成熟格式库读取 JPEG 尺寸，避免手写段解析器误判浏览器编码的图片。 */
export function validateJpegPreview(input: { base64: string; width: number; height: number }, maxBytes: number) {
  const binary = atob(input.base64);
  if (binary.length > maxBytes) throw new Error('分析图片超过大小限制');
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const dimensions = imageDimensionsFromData(bytes);
  if (!dimensions || dimensions.type !== 'jpeg') throw new Error('分析图片必须是 JPEG');
  if (dimensions.width !== input.width || dimensions.height !== input.height) {
    throw new Error(`JPEG 实际尺寸 ${dimensions.width}×${dimensions.height} 与声明 ${input.width}×${input.height} 不一致`);
  }
  return bytes;
}
