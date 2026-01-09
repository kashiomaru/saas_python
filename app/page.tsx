'use client'

import { useState } from 'react'
import styles from './page.module.css'

export default function Home() {
  const [logs, setLogs] = useState<string[]>([])

  const handleExecute = () => {
    const timestamp = new Date().toLocaleTimeString('ja-JP')
    const newLog = `[${timestamp}] 実行されました`
    setLogs((prevLogs) => [...prevLogs, newLog])
  }

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <h1 className={styles.title}>簡易実行アプリ</h1>
        
        <div className={styles.buttonContainer}>
          <button className={styles.executeButton} onClick={handleExecute}>
            実行
          </button>
        </div>

        <div className={styles.logContainer}>
          <h2 className={styles.logTitle}>ログ出力</h2>
          <div className={styles.logArea}>
            {logs.length === 0 ? (
              <p className={styles.emptyLog}>ログはまだありません</p>
            ) : (
              <ul className={styles.logList}>
                {logs.map((log, index) => (
                  <li key={index} className={styles.logItem}>
                    {log}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
