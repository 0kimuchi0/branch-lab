import { FILE_STATE_LABELS, type AreaFile } from '../view/workspace'

interface FileAreaProps {
  readonly files: readonly AreaFile[]
  readonly emptyText: string
}

/** 作業ディレクトリやステージのファイル一覧。ファイル名を押すと内容を表示する。 */
export function FileArea({ files, emptyText }: FileAreaProps) {
  if (files.length === 0) {
    return <p className="area-empty">{emptyText}</p>
  }
  return (
    <ul className="file-list">
      {files.map((file) => (
        <li key={file.path} className={`file file-${file.state}`}>
          <details>
            <summary>
              <span className="file-path">{file.path}</span>
              {file.state !== 'clean' && (
                <span className="file-badge">{FILE_STATE_LABELS[file.state]}</span>
              )}
            </summary>
            <pre className="file-content">
              {file.content === undefined ? '(削除されています)' : file.content || '(空のファイル)'}
            </pre>
          </details>
        </li>
      ))}
    </ul>
  )
}
