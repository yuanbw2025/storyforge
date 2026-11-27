import { useEffect, useMemo, useRef, useState } from 'react'
import { extractTextFromFile, textLayerReportLineV1, type ExtractResult } from '../../../lib/doc-parser'
import type { CsvGridV1 } from '../../../lib/import/csv-grid'
import { publishCsvGridViewV1 } from './ImportDocOverview'
import { chunkDocument, type ChunkPlan } from '../../../lib/import/chunker'
import { detectVolumeStructure, type VolumeDetectResult } from '../../../lib/import/volume-detector'

import { isLargeImportTextFileV1, openImportBlobTextSourceV1, type ImportBlobTextSourceV1 } from '../../../lib/import/blob-text-source'

const DEFAULT_CHUNK_SIZE = 50000

/** 032-L1-a：准备阶段遇到"没有可复制文本"时的显式状态。
 * 只拦截进入分块/候选/adopt，不改抽取文本、不改上限、不碰原件存档路径。 */
export interface TextLayerBlockedV1 { filename: string; sizeBytes: number; pageCount?: number; status: ExtractResult['status']; warnings: ExtractResult['warnings'] }

export default function useImportDocumentPreparation() {
  const [blobTextSource, setBlobTextSource] = useState<ImportBlobTextSourceV1 | null>(null)
  const readController = useRef<AbortController | null>(null)
  const [filename, setFilename] = useState('')
  const [rawText, setRawText] = useState('')
  const [fileError, setFileError] = useState<string | null>(null)
  const [loadingFile, setLoadingFile] = useState(false)
  const [extractInfo, setExtractInfo] = useState<string | null>(null)
  const [plans, setPlans] = useState<ChunkPlan[] | null>(null)
  const [chunkSize, setChunkSize] = useState(DEFAULT_CHUNK_SIZE)
  const [automaticChunking, setAutomaticChunking] = useState(true)
  const [showConfirm, setShowConfirm] = useState(false)
  const [volumeDetect, setVolumeDetect] = useState<VolumeDetectResult | null>(null)
  const [textLayerBlocked, setTextLayerBlocked] = useState<TextLayerBlockedV1 | null>(null)
  /** 032-L1-c：仅 csv 成功抽取后出现的只读侧车快照，不进 AI/adopt/persistence。 */
  const [csvGrid, setCsvGrid] = useState<CsvGridV1 | null>(null)
  const lastUploadedFile = useRef<File | null>(null)
  const sourceReadSequence = useRef(0)
  useEffect(() => () => { sourceReadSequence.current++; readController.current?.abort() }, [])

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    readController.current?.abort()
    const controller = new AbortController()
    readController.current = controller
    const request = ++sourceReadSequence.current
    setBlobTextSource(null)
    setFileError(null)
    setExtractInfo(null)
    setFilename(file.name)
    setRawText('')
    setPlans(null)
    setShowConfirm(false)
    setVolumeDetect(null)
    setAutomaticChunking(true)
    setTextLayerBlocked(null)
    setCsvGrid(null)
    publishCsvGridViewV1(null)
    setLoadingFile(true)
    lastUploadedFile.current = file
    try {
      if (isLargeImportTextFileV1(file)) {
        let lastPercent = -1
        const streamed = await openImportBlobTextSourceV1(file, { signal: controller.signal, onProgress: (read, total) => {
          const percent = Math.floor(read / total * 100)
          if (request === sourceReadSequence.current && percent !== lastPercent) {
            lastPercent = percent; setExtractInfo(`正在读取原文 ${percent}%`)
          }
        } })
        if (request !== sourceReadSequence.current) return
        setBlobTextSource(streamed)
        setRawText(streamed.preview)
        setExtractInfo(`文件 ${(file.size / 1024 / 1024).toFixed(2)} MB · 共 ${streamed.totalChars.toLocaleString()} 字符 · 仅显示开头预览，解析使用完整原文件`)
        if (!streamed.hasText) setFileError('原文件没有可解析的正文。')
        return
      }
      const result = await extractTextFromFile(file)
      if (request !== sourceReadSequence.current) return
      if (result.status === 'empty') {
        // 不进入分块/候选/adopt，也不清掉已选文件：原件仍可由既有 saveBlob 路径存档。
        setTextLayerBlocked({ filename: file.name, sizeBytes: file.size, pageCount: result.pageCount, status: result.status, warnings: result.warnings })
        setFileError(textLayerReportLineV1({ filename: file.name, sizeBytes: file.size, pageCount: result.pageCount, status: result.status }))
        setCsvGrid(null)
        publishCsvGridViewV1(null)
        setRawText('')
        return
      }
      setCsvGrid(result.csvGrid ?? null)
      publishCsvGridViewV1(result.csvGrid ?? null)
      setRawText(result.text)
      const parts = [
        `文件 ${(file.size / 1024 / 1024).toFixed(2)} MB`,
        `抽取 ${result.rawChars.toLocaleString()} 字符`,
      ]
      if (result.pageCount) parts.push(`${result.pageCount} 页`)
      if (result.warnings.includes('pdf-text-layer-sparse')) parts.push('部分页面文字极少')
      setExtractInfo(parts.join(' · '))
    } catch (error) {
      if (request !== sourceReadSequence.current) return
      setFilename('')
      lastUploadedFile.current = null
      setFileError(error instanceof Error ? error.message : String(error))
    } finally {
      if (request === sourceReadSequence.current) setLoadingFile(false)
    }
  }

  const handleRawTextChange = (text: string) => {
    sourceReadSequence.current++
    readController.current?.abort()
    setBlobTextSource(null)
    setLoadingFile(false)
    setFilename('')
    setExtractInfo(null)
    setTextLayerBlocked(null); setFileError(null); setCsvGrid(null); publishCsvGridViewV1(null)
    setRawText(text)
    setPlans(null)
    setShowConfirm(false)
    setVolumeDetect(null)
    setAutomaticChunking(true)
    lastUploadedFile.current = null
  }

  const totalChars = blobTextSource?.totalChars ?? rawText.length
  const hasSourceText = blobTextSource?.hasText ?? !!rawText.trim()
  const preview = () => [{ index: 0, startChar: 0, endChar: totalChars, charCount: totalChars, label: '开始前自动分块', text: rawText }]
  const manualPreview = (size: number) => blobTextSource ? Array.from({ length: Math.ceil(totalChars / size) }, (_, index) => {
    const startChar = index * size, endChar = Math.min(totalChars, startChar + size)
    return { index, startChar, endChar, charCount: endChar - startChar, label: `预计区段 ${index + 1}`, text: '' }
  }) : chunkDocument(rawText, { targetChars: size })
  const prepareConfirmation = () => {
    // 没有可复制文本时，作者手动补文字前不允许进入确认/解析。
    if (textLayerBlocked || !hasSourceText) return
    setPlans(automaticChunking ? preview() : manualPreview(chunkSize))
    setVolumeDetect(blobTextSource ? null : detectVolumeStructure(rawText))
    setShowConfirm(true)
  }

  const handleChunkSizeChange = (size: number) => {
    setAutomaticChunking(false)
    setChunkSize(size)
    if (hasSourceText) setPlans(manualPreview(size))
  }
  const handleAutomaticChunkingChange = (automatic: boolean) => {
    setAutomaticChunking(automatic)
    if (hasSourceText) setPlans(automatic ? preview() : manualPreview(chunkSize))
  }

  const sourceBlob = () => ({
    blob: lastUploadedFile.current ?? new Blob([rawText], { type: 'text/plain;charset=utf-8' }),
    filename: lastUploadedFile.current?.name || filename || '粘贴内容.txt',
  })

  const previewPlans = useMemo(() => {
    if (blobTextSource || automaticChunking || !rawText.trim()) return null
    return plans || chunkDocument(rawText, { targetChars: chunkSize })
  }, [blobTextSource, automaticChunking, chunkSize, plans, rawText])

  return {
    filename,
    rawText,
    blobTextSource, totalChars, hasSourceText,
    cancelFileRead: () => handleRawTextChange(''),
    fileError,
    loadingFile,
    extractInfo,
    plans,
    chunkSize,
    automaticChunking,
    handleAutomaticChunkingChange,
    showConfirm,
    volumeDetect,
    previewPlans,
    textLayerBlocked,
    csvGrid,
    handleFile,
    handleRawTextChange,
    prepareConfirmation,
    handleChunkSizeChange,
    closeConfirm: () => setShowConfirm(false),
    sourceBlob,
  }
}
