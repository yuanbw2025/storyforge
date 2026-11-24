import { useMemo, useRef, useState } from 'react'
import { extractTextFromFile, textLayerReportLineV1, type ExtractResult } from '../../../lib/doc-parser'
import { chunkDocument, type ChunkPlan } from '../../../lib/import/chunker'
import { detectVolumeStructure, type VolumeDetectResult } from '../../../lib/import/volume-detector'

const DEFAULT_CHUNK_SIZE = 50000

/** 032-L1-a：准备阶段遇到"没有可复制文本"时的显式状态。
 * 只拦截进入分块/候选/adopt，不改抽取文本、不改上限、不碰原件存档路径。 */
export interface TextLayerBlockedV1 { filename: string; sizeBytes: number; pageCount?: number; status: ExtractResult['status']; warnings: ExtractResult['warnings'] }

export default function useImportDocumentPreparation() {
  const [filename, setFilename] = useState('')
  const [rawText, setRawText] = useState('')
  const [fileError, setFileError] = useState<string | null>(null)
  const [loadingFile, setLoadingFile] = useState(false)
  const [extractInfo, setExtractInfo] = useState<string | null>(null)
  const [plans, setPlans] = useState<ChunkPlan[] | null>(null)
  const [chunkSize, setChunkSize] = useState(DEFAULT_CHUNK_SIZE)
  const [showConfirm, setShowConfirm] = useState(false)
  const [volumeDetect, setVolumeDetect] = useState<VolumeDetectResult | null>(null)
  const [textLayerBlocked, setTextLayerBlocked] = useState<TextLayerBlockedV1 | null>(null)
  const lastUploadedFile = useRef<File | null>(null)

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setFileError(null)
    setExtractInfo(null)
    setFilename(file.name)
    setRawText('')
    setPlans(null)
    setTextLayerBlocked(null)
    setLoadingFile(true)
    lastUploadedFile.current = file
    try {
      const result = await extractTextFromFile(file)
      if (result.status === 'empty') {
        // 不进入分块/候选/adopt，也不清掉已选文件：原件仍可由既有 saveBlob 路径存档。
        setTextLayerBlocked({ filename: file.name, sizeBytes: file.size, pageCount: result.pageCount, status: result.status, warnings: result.warnings })
        setFileError(textLayerReportLineV1({ filename: file.name, sizeBytes: file.size, pageCount: result.pageCount, status: result.status }))
        setRawText('')
        return
      }
      setRawText(result.text)
      const parts = [
        `文件 ${(file.size / 1024 / 1024).toFixed(2)} MB`,
        `抽取 ${result.rawChars.toLocaleString()} 字符`,
      ]
      if (result.pageCount) parts.push(`${result.pageCount} 页`)
      if (result.warnings.includes('pdf-text-layer-sparse')) parts.push('部分页面文字极少')
      setExtractInfo(parts.join(' · '))
    } catch (error) {
      setFilename('')
      lastUploadedFile.current = null
      setFileError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingFile(false)
    }
  }

  const handleRawTextChange = (text: string) => {
    if (text.trim()) { setTextLayerBlocked(null); setFileError(null) }
    setRawText(text)
    setPlans(null)
    lastUploadedFile.current = null
  }

  const prepareConfirmation = () => {
    // 没有可复制文本时，作者手动补文字前不允许进入确认/解析。
    if (textLayerBlocked || !rawText.trim()) return
    setPlans(chunkDocument(rawText, { targetChars: chunkSize }))
    setVolumeDetect(detectVolumeStructure(rawText))
    setShowConfirm(true)
  }

  const handleChunkSizeChange = (size: number) => {
    setChunkSize(size)
    if (rawText.trim()) setPlans(chunkDocument(rawText, { targetChars: size }))
  }

  const sourceBlob = () => ({
    blob: lastUploadedFile.current ?? new Blob([rawText], { type: 'text/plain;charset=utf-8' }),
    filename: lastUploadedFile.current?.name || filename || '粘贴内容.txt',
  })

  const previewPlans = useMemo(() => {
    if (!rawText.trim()) return null
    return plans || chunkDocument(rawText, { targetChars: chunkSize })
  }, [chunkSize, plans, rawText])

  return {
    filename,
    rawText,
    fileError,
    loadingFile,
    extractInfo,
    plans,
    chunkSize,
    showConfirm,
    volumeDetect,
    previewPlans,
    textLayerBlocked,
    handleFile,
    handleRawTextChange,
    prepareConfirmation,
    handleChunkSizeChange,
    closeConfirm: () => setShowConfirm(false),
    sourceBlob,
  }
}
