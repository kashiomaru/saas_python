'use client'

import { useState, useRef, useEffect } from 'react'
import styles from './page.module.css'

interface StopHighResult {
  銘柄コード: string
  銘柄名: string
  市場: string
  ストップ高回数: number
  最新ストップ高日: string
  最新ストップ高価格: number | null
  最新終値: number | null
  直前取引日もストップ高: string
  ストップ高で終了: string
  寄り付きストップ高: string
}

interface LogEntry {
  message: string
  type: 'log' | 'error'
}

export default function Home() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [results, setResults] = useState<StopHighResult[]>([])
  const logAreaRef = useRef<HTMLDivElement>(null)

  const addLog = (message: string, type: 'log' | 'error' = 'log') => {
    const timestamp = new Date().toLocaleTimeString('ja-JP')
    const newLog: LogEntry = {
      message: `[${timestamp}] ${message}`,
      type,
    }
    setLogs((prevLogs) => [...prevLogs, newLog])
  }

  // ログが追加されたときに自動スクロール
  useEffect(() => {
    if (logAreaRef.current) {
      logAreaRef.current.scrollTop = logAreaRef.current.scrollHeight
    }
  }, [logs])

  const handleExecute = async () => {
    setIsLoading(true)
    setLogs([])
    setResults([])

    try {
      const response = await fetch('/api/detect-stop-high', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          minPrice: 100,
          maxPrice: 600,
          delay: 600, // 0.6秒
        }),
      })

      if (!response.ok) {
        throw new Error('リクエストに失敗しました')
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        throw new Error('ストリームの読み取りに失敗しました')
      }

      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.trim()) {
            try {
              const data = JSON.parse(line)

              if (data.type === 'log' || data.type === 'error') {
                addLog(data.message, data.type)
              } else if (data.type === 'result' && data.data) {
                const resultData = data.data

                if (resultData.success) {
                  if (resultData.results && resultData.results.length > 0) {
                    setResults(resultData.results)
                  }
                }
              }
            } catch (e) {
              // JSON解析エラーは無視
            }
          }
        }
      }

      // 残りのバッファを処理
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer)
          if (data.type === 'log' || data.type === 'error') {
            addLog(data.message, data.type)
          } else if (data.type === 'result' && data.data) {
            const resultData = data.data
            if (resultData.success && resultData.results && resultData.results.length > 0) {
              setResults(resultData.results)
            }
          }
        } catch (e) {
          // JSON解析エラーは無視
        }
      }
    } catch (error: any) {
      addLog(`エラー: ${error.message}`)
      console.error('エラー:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <h1 className={styles.title}>ストップ高検出アプリ</h1>
        
        <div className={styles.buttonContainer}>
          <button
            className={styles.executeButton}
            onClick={handleExecute}
            disabled={isLoading}
          >
            {isLoading ? '処理中...' : '実行'}
          </button>
        </div>

        <div className={styles.logContainer}>
          <h2 className={styles.logTitle}>ログ出力</h2>
          <div className={styles.logArea} ref={logAreaRef}>
            {logs.length === 0 ? (
              <p className={styles.emptyLog}>ログはまだありません</p>
            ) : (
              <ul className={styles.logList}>
                {logs.map((log, index) => (
                  <li
                    key={index}
                    className={`${styles.logItem} ${
                      log.type === 'error' ? styles.logItemError : ''
                    }`}
                  >
                    {log.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {results.length > 0 && (
          <div className={styles.resultsContainer}>
            <h2 className={styles.logTitle}>検出結果</h2>
            <div className={styles.resultsArea}>
              <table className={styles.resultsTable}>
                <thead>
                  <tr>
                    <th>銘柄コード</th>
                    <th>銘柄名</th>
                    <th>市場</th>
                    <th>ストップ高回数</th>
                    <th>最新ストップ高日</th>
                    <th>最新ストップ高価格</th>
                    <th>最新終値</th>
                    <th>直前取引日もストップ高</th>
                    <th>ストップ高で終了</th>
                    <th>寄り付きストップ高</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((result, index) => (
                    <tr key={index}>
                      <td>{result.銘柄コード}</td>
                      <td>{result.銘柄名}</td>
                      <td>{result.市場}</td>
                      <td>{result.ストップ高回数}</td>
                      <td>{result.最新ストップ高日}</td>
                      <td>
                        {result.最新ストップ高価格
                          ? result.最新ストップ高価格.toLocaleString()
                          : '-'}
                      </td>
                      <td>
                        {result.最新終値
                          ? result.最新終値.toLocaleString()
                          : '-'}
                      </td>
                      <td>{result.直前取引日もストップ高}</td>
                      <td>{result.ストップ高で終了}</td>
                      <td>{result.寄り付きストップ高}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
